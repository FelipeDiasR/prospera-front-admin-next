import { NfceParserFn, ParsedLineItem, ParsedResult } from "./types";

/**
 * Parser para NFC-e do estado do Rio de Janeiro.
 *
 * Formato esperado (texto colado do site da SEFAZ-RJ):
 * - Header opcional: "DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA"
 * - Estabelecimento antes de "CNPJ:"
 * - CNPJ com pontuação: "CNPJ: XX.XXX.XXX/XXXX-XX"
 * - Itens: DESCRIÇÃO (Código: XXX ) Qtde.:QTD UN: XX Vl. Unit.: VALOR Vl. Total TOTAL
 * - Data: "Emissão: DD/MM/YYYY HH:MM:SS"
 */
export const parseRJ: NfceParserFn = (rawText: string): ParsedResult | { error: string } => {
  // Normalize: remove line breaks to handle text pasted from browser
  const text = rawText.replace(/[\r\n]+/g, "").trim();

  if (!text.includes("CNPJ:") || !text.includes("(Código:")) {
    return { error: "Texto não reconhecido como NFC-e do Rio de Janeiro. Verifique se contém CNPJ e itens com código." };
  }

  // Extract CNPJ
  const cnpjMatch = text.match(/CNPJ:\s*([\d.\/\-]+)/);
  const cnpjRaw = cnpjMatch ? cnpjMatch[1].replace(/\D/g, "") : "";
  if (cnpjRaw.length !== 14) {
    return { error: `CNPJ inválido encontrado: "${cnpjMatch?.[1] ?? ""}". Esperado 14 dígitos.` };
  }

  // Extract establishment name (between header and CNPJ:)
  let establishmentName = "";
  const cnpjIdx = text.indexOf("CNPJ:");
  if (cnpjIdx > 0) {
    let nameText = text.substring(0, cnpjIdx).trim();
    // Find the last known header pattern and take everything after it
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

  // Extract date/time - RJ uses "Emissão: DD/MM/YYYY HH:MM:SS" (with or without timezone offset)
  let issuedDate = "";
  let issuedTime = "";
  const dateMatch = text.match(/Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2}:\d{2})?/i);
  if (dateMatch) {
    const [dd, mm, yyyy] = dateMatch[1].split("/");
    issuedDate = `${yyyy}-${mm}-${dd}`;
    if (dateMatch[2]) {
      issuedTime = dateMatch[2].substring(0, 5); // HH:mm
    }
  }

  // Extract items
  // Split text by "(Código:" to isolate each item block, then parse each one
  const items: ParsedLineItem[] = [];

  // Find all item blocks using a split approach
  const codeSplits = text.split(/\(Código:\s*\d+\s*\)/i);
  const codeMatches = [...text.matchAll(/\(Código:\s*\d+\s*\)/gi)];

  for (let i = 0; i < codeMatches.length; i++) {
    // Description comes from the end of the previous split segment
    const prevSegment = codeSplits[i];
    // After each (Código:) there's the qty/unit/value info in codeSplits[i+1]
    const nextSegment = codeSplits[i + 1] ?? "";

    // Extract description: take the last meaningful part of prevSegment
    // (after a previous "Vl. Total XX.XX" or after address/header)
    let description = prevSegment;
    const vlTotalIdx = description.lastIndexOf("Vl. Total");
    if (vlTotalIdx !== -1) {
      // Skip past the "Vl. Total XX.XX" value
      const afterVlTotal = description.substring(vlTotalIdx);
      const valueMatch = afterVlTotal.match(/Vl\.\s*Total\s*[\d.,]+\s*/i);
      if (valueMatch) {
        description = description.substring(vlTotalIdx + valueMatch[0].length);
      }
    } else {
      // First item: take text after last comma+UF pattern (end of address)
      const ufMatch = description.match(/,\s*[A-Z]{2}\s*$/);
      if (ufMatch && ufMatch.index != null) {
        description = "";
      } else {
        // Try to find end of address (state abbreviation followed by item)
        const lastUfMatch = [...description.matchAll(/,\s*[A-Z]{2}/g)].pop();
        if (lastUfMatch && lastUfMatch.index != null) {
          description = description.substring(lastUfMatch.index + lastUfMatch[0].length);
        }
      }
    }
    description = description.trim();

    // Extract qty, unit, unitValue, totalItemValue from next segment
    const detailMatch = nextSegment.match(/^\s*Qtde\.?:\s*([\d.,]+)\s*UN:\s*\w+\s*Vl\.\s*Unit\.?:\s*([\d.,]+)\s*Vl\.\s*Total\s*([\d.,]+)/i);
    if (!detailMatch || !description) continue;

    const quantity = parseFloat(detailMatch[1].replace(",", "."));
    const unitValue = parseFloat(detailMatch[2].replace(",", "."));
    const totalItemValue = parseFloat(detailMatch[3].replace(",", "."));

    if (isNaN(quantity) || isNaN(unitValue) || isNaN(totalItemValue)) continue;

    items.push({
      description,
      quantity,
      unitValue: Math.round(unitValue * 100) / 100,
      totalItemValue: Math.round(totalItemValue * 100) / 100,
    });
  }

  if (items.length === 0) {
    return { error: "Nenhum item encontrado no texto. Verifique se o formato é de RJ." };
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
