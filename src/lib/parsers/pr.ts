import { NfceParserFn, ParsedLineItem, ParsedResult } from "./types";

/**
 * Parser para NFC-e do estado do Paraná.
 *
 * Formato esperado (texto colado do site da SEFAZ-PR):
 * - Header opcional: "DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA"
 * - Estabelecimento antes de "CNPJ:"
 * - CNPJ com pontuação: "CNPJ: XX.XXX.XXX/XXXX-XX"
 * - Itens: DESCRIÇÃO (Código: XXX) Qtde.:QTD UN: XXX Vl. Unit.: VALOR Vl. Total TOTAL
 * - Data: "Emissão: DD/MM/YYYY HH:MM:SS"
 */
export const parsePR: NfceParserFn = (rawText: string): ParsedResult | { error: string } => {
  // Normalize: remove line breaks to handle text pasted from browser
  const text = rawText.replace(/[\r\n]+/g, "").trim();

  if (!text.includes("CNPJ:") || !text.includes("(Código:")) {
    return { error: "Texto não reconhecido como NFC-e do Paraná. Verifique se contém CNPJ e itens com código." };
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
      // Find position of the last header occurrence and take text after it
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

  // Extract date/time - PR uses "Emissão: DD/MM/YYYY HH:MM:SS"
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

  // Extract items using split approach
  const items: ParsedLineItem[] = [];
  const codeSplits = text.split(/\(Código:\s*\d+\s*\)/i);
  const codeMatches = [...text.matchAll(/\(Código:\s*\d+\s*\)/gi)];

  for (let i = 0; i < codeMatches.length; i++) {
    const prevSegment = codeSplits[i];
    const nextSegment = codeSplits[i + 1] ?? "";

    // Extract description from end of previous segment
    let description = prevSegment;
    const vlTotalIdx = description.lastIndexOf("Vl. Total");
    if (vlTotalIdx !== -1) {
      const afterVlTotal = description.substring(vlTotalIdx);
      const valueMatch = afterVlTotal.match(/Vl\.\s*Total\s*[\d.,]+\s*/i);
      if (valueMatch) {
        description = description.substring(vlTotalIdx + valueMatch[0].length);
      }
    } else {
      // First item: text after address (after state abbreviation like ", PR")
      const allUfMatches = [...description.matchAll(/,\s*[A-Z]{2}/g)];
      const lastUf = allUfMatches.pop();
      if (lastUf && lastUf.index != null) {
        description = description.substring(lastUf.index + lastUf[0].length);
      }
    }
    description = description.trim();

    // Extract qty, unit value, and total from next segment
    const detailMatch = nextSegment.match(/^\s*Qtde?\.?:\s*([\d.,]+)\s*UN:\s*\w+\s*Vl\.\s*Unit\.?:\s*([\d.,]+)\s*Vl\.\s*Total\s*([\d.,]+)/i);
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
    return { error: "Nenhum item encontrado no texto. Verifique se o formato é de PR." };
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
