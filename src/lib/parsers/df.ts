import { NfceParserFn, ParsedLineItem, ParsedResult } from "./types";

/**
 * Parser para NFC-e do Distrito Federal.
 *
 * Formato esperado (texto colado do site da SEFAZ-DF):
 * - Header opcional: "DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA"
 * - Estabelecimento antes de "CNPJ:"
 * - CNPJ com pontuação: "CNPJ: XX.XXX.XXX/XXXX-XX"
 * - Itens: DESCRIÇÃO (Cód: XXX) Vl. Total Qtde.: QTY UN: UNIT Vl. Unit.: UNITVALUE TOTALVALUE
 *   Note: "Vl. Total" label comes BEFORE Qtde, and unitValue+totalValue are glued
 * - Data: "Emissão: DD/MM/YYYY HH:MM:SS"
 */
export const parseDF: NfceParserFn = (rawText: string): ParsedResult | { error: string } => {
  // Normalize: remove line breaks to handle text pasted from browser
  const text = rawText.replace(/[\r\n]+/g, "").trim();

  if (!text.includes("CNPJ:") || !text.includes("(Cód:")) {
    return { error: "Texto não reconhecido como NFC-e do Distrito Federal. Verifique se contém CNPJ e itens com código." };
  }

  // Extract CNPJ
  const cnpjMatch = text.match(/CNPJ:\s*([\d.\/\-]+)/);
  const cnpjRaw = cnpjMatch ? cnpjMatch[1].replace(/\D/g, "") : "";
  if (cnpjRaw.length !== 14) {
    return { error: `CNPJ inválido encontrado: "${cnpjMatch?.[1] ?? ""}". Esperado 14 dígitos.` };
  }

  // Extract establishment name
  let establishmentName = "";
  const cnpjIdx = text.indexOf("CNPJ:");
  if (cnpjIdx > 0) {
    let nameText = text.substring(0, cnpjIdx).trim();
    const headerMatch = nameText.match(
      /(?:Imprimir|DANFE\s*NFC-e|NFC-e|DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETR[OÔÖ]NICA|Nota Fiscal de Consumidor Eletr[oô]nica\s*\(NFC-e\))/gi
    );
    if (headerMatch) {
      let lastHeaderEnd = 0;
      for (const h of headerMatch) {
        const idx = nameText.indexOf(h, lastHeaderEnd);
        if (idx !== -1) {
          lastHeaderEnd = idx + h.length;
        }
      }
      nameText = nameText.substring(lastHeaderEnd).trim();
    }
    establishmentName = nameText;
  }

  // Extract date/time - "Emissão: DD/MM/YYYY HH:MM:SS"
  let issuedDate = "";
  let issuedTime = "";
  const dateMatch = text.match(/Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2}:\d{2})?/i);
  if (dateMatch) {
    const [dd, mm, yyyy] = dateMatch[1].split("/");
    issuedDate = `${yyyy}-${mm}-${dd}`;
    if (dateMatch[2]) {
      issuedTime = dateMatch[2].substring(0, 5);
    }
  }

  // Extract items using split by (Cód: XX)
  // DF format: DESCRIPTION (Cód: XX) Vl. Total Qtde.: QTY UN: UNIT Vl. Unit.: UNITVALUE TOTALVALUE
  // unitValue and totalValue are glued: e.g. "6,9913,98" = unit 6,99 + total 13,98
  const items: ParsedLineItem[] = [];
  const codeSplits = text.split(/\(Cód:\s*\d+\s*\)/i);
  const codeMatches = [...text.matchAll(/\(Cód:\s*\d+\s*\)/gi)];

  for (let i = 0; i < codeMatches.length; i++) {
    const prevSegment = codeSplits[i];
    const nextSegment = codeSplits[i + 1] ?? "";

    // Extract description from end of previous segment
    let description = prevSegment;
    // After previous item's total value (which is after "Vl. Unit.: X,XXY,YY")
    // Look for the last occurrence of a number pattern that ends the previous item
    const vlUnitIdx = description.lastIndexOf("Vl. Unit.:");
    if (vlUnitIdx !== -1) {
      // Skip past "Vl. Unit.: X,XXY,YY" - find the end of the glued values
      const afterVlUnit = description.substring(vlUnitIdx);
      const valueMatch = afterVlUnit.match(/Vl\.\s*Unit\.?:\s*[\d.,]+/i);
      if (valueMatch) {
        description = description.substring(vlUnitIdx + valueMatch[0].length);
      }
    } else {
      // First item: text after address (after state abbreviation like ", DF")
      const allUfMatches = [...description.matchAll(/,\s{0,3}[A-Z]{2}/g)];
      const lastUf = allUfMatches.pop();
      if (lastUf && lastUf.index != null) {
        description = description.substring(lastUf.index + lastUf[0].length);
      }
    }
    description = description.trim();

    // Extract qty, unit, and values from next segment
    // Format: "Vl. TotalQtde.: 2.0000 UN: UNID Vl. Unit.: 6,9913,98"
    const detailMatch = nextSegment.match(
      /Vl\.\s*Total\s*Qtde?\.?:\s*([\d.]+)\s*UN:\s*\w+\s*Vl\.\s*Unit\.?:\s*([\d,]+)/i
    );
    if (!detailMatch || !description) continue;

    const quantity = parseFloat(detailMatch[1].replace(",", "."));
    const valuesStr = detailMatch[2]; // e.g. "6,9913,98" or "59,999,48"

    // Split the glued values: unitValue,XX + totalValue,XX
    // Strategy: find the second comma - everything before it (first X,XX) is unit, rest is total
    const commaPositions: number[] = [];
    for (let j = 0; j < valuesStr.length; j++) {
      if (valuesStr[j] === ",") commaPositions.push(j);
    }

    let unitValue: number;
    let totalItemValue: number;

    if (commaPositions.length >= 2) {
      // Split at the second comma
      const splitAt = commaPositions[1];
      const unitStr = valuesStr.substring(0, splitAt);
      const totalStr = valuesStr.substring(splitAt);
      // But wait - unitStr ends with 2 digits after first comma, totalStr starts with comma
      // Actually: "6,9913,98" -> first comma at 1, second comma at 5
      // unit = "6,99", total = "13,98"
      // We need to split so that unit has exactly 2 decimal digits after its comma
      const firstComma = commaPositions[0];
      const unitEnd = firstComma + 3; // comma + 2 digits
      const unitPart = valuesStr.substring(0, unitEnd);
      const totalPart = valuesStr.substring(unitEnd);

      unitValue = parseFloat(unitPart.replace(",", "."));
      totalItemValue = parseFloat(totalPart.replace(",", "."));
    } else {
      // Single value (no total glued - unlikely but fallback)
      unitValue = parseFloat(valuesStr.replace(",", "."));
      totalItemValue = unitValue * quantity;
    }

    if (isNaN(quantity) || isNaN(unitValue) || isNaN(totalItemValue)) continue;

    items.push({
      description,
      quantity,
      unitValue: Math.round(unitValue * 100) / 100,
      totalItemValue: Math.round(totalItemValue * 100) / 100,
    });
  }

  if (items.length === 0) {
    return { error: "Nenhum item encontrado no texto. Verifique se o formato é de DF." };
  }

  const totalAmount = Math.round(items.reduce((acc, i) => acc + i.totalItemValue, 0) * 100) / 100;

  return {
    cnpj: cnpjRaw,
    establishmentName,
    issuedDate,
    issuedTime,
    items,
    totalAmount,
  };
};
