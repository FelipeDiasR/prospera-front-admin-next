import { NfceParserFn, ParsedLineItem, ParsedResult } from "./types";

/**
 * Parser para NFC-e do estado de Minas Gerais.
 *
 * Formato esperado (texto colado do site da SEFAZ-MG):
 * - Header: "Nota Fiscal de Consumidor Eletrônica (NFC-e)"
 * - Estabelecimento entre o header e "CNPJ:"
 * - CNPJ após "CNPJ:"
 * - Itens: DESCRIÇÃO (Código: XXX)Qtde total de ítens: QTDEUn: UNValor total R$: R$ VALOR
 * - Data: "Data Emissão" seguido de números + DD/MM/YYYY HH:MM:SS
 */
export const parseMG: NfceParserFn = (rawText: string): ParsedResult | { error: string } => {
  // Normalize: remove line breaks to handle text pasted from browser
  const text = rawText.replace(/[\r\n]+/g, "").trim();

  if (!text.includes("CNPJ:") || !text.includes("(Código:")) {
    return { error: "Texto não reconhecido como NFC-e de Minas Gerais. Verifique se contém CNPJ e itens com código." };
  }

  // Extract CNPJ
  const cnpjMatch = text.match(/CNPJ:\s*([^\s,]+)/);
  const cnpjRaw = cnpjMatch ? cnpjMatch[1].replace(/\D/g, "") : "";
  if (cnpjRaw.length !== 14) {
    return { error: `CNPJ inválido encontrado: "${cnpjMatch?.[1] ?? ""}". Esperado 14 dígitos.` };
  }

  // Extract establishment name
  let establishmentName = "";
  const headerMarker = "Nota Fiscal de Consumidor Eletrônica (NFC-e)";
  const headerIdx = text.indexOf(headerMarker);
  const cnpjIdx = text.indexOf("CNPJ:");
  if (headerIdx !== -1 && cnpjIdx > headerIdx) {
    establishmentName = text.substring(headerIdx + headerMarker.length, cnpjIdx).trim();
  } else if (cnpjIdx > 0) {
    // Fallback: take text before CNPJ
    establishmentName = text.substring(0, cnpjIdx).trim();
  }

  // Extract date/time from "Data Emissão" section
  let issuedDate = "";
  let issuedTime = "";
  const dateMatch = text.match(/Data\s*Emiss[aã]o[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2}:\d{2})?/i);
  if (dateMatch) {
    const [dd, mm, yyyy] = dateMatch[1].split("/");
    issuedDate = `${yyyy}-${mm}-${dd}`;
    if (dateMatch[2]) {
      issuedTime = dateMatch[2].substring(0, 5); // HH:mm
    }
  }

  // Extract items using split approach to isolate descriptions correctly
  const items: ParsedLineItem[] = [];
  const codeSplits = text.split(/\(Código:\s*\d+\)/i);
  const codeMatches = [...text.matchAll(/\(Código:\s*\d+\)/gi)];

  for (let i = 0; i < codeMatches.length; i++) {
    const prevSegment = codeSplits[i];
    const nextSegment = codeSplits[i + 1] ?? "";

    // Extract description from end of previous segment
    let description = prevSegment;
    const valorTotalIdx = description.lastIndexOf("Valor total R$:");
    if (valorTotalIdx !== -1) {
      // Skip past "Valor total R$: R$ XX.XX"
      const afterValor = description.substring(valorTotalIdx);
      const valueMatch = afterValor.match(/Valor total R\$:\s*R\$\s*[\d.,]+\s*/i);
      if (valueMatch) {
        description = description.substring(valorTotalIdx + valueMatch[0].length);
      }
    } else {
      // First item: text after address (after UF abbreviation like ", MG")
      const ufPattern = /,\s*[A-Z]{2}\s*$/;
      const ufMatch = description.match(ufPattern);
      if (ufMatch && ufMatch.index != null) {
        description = "";
      } else {
        // Try to find last occurrence of state abbreviation pattern
        const allUfMatches = [...description.matchAll(/,\s*[A-Z]{2}/g)];
        const lastUf = allUfMatches.pop();
        if (lastUf && lastUf.index != null) {
          description = description.substring(lastUf.index + lastUf[0].length);
        }
      }
    }
    description = description.trim();

    // Extract qty and value from next segment
    const detailMatch = nextSegment.match(/^\s*Qtde total de [ií]tens:\s*([\d.,]+)\s*UN:\s*\w+\s*Valor total R\$:\s*R\$\s*([\d.,]+)/i);
    if (!detailMatch || !description) continue;

    const quantity = parseFloat(detailMatch[1].replace(",", "."));
    const totalItemValue = parseFloat(detailMatch[2].replace(",", "."));

    if (isNaN(quantity) || isNaN(totalItemValue)) continue;

    const unitValue = quantity > 0 ? Math.round((totalItemValue / quantity) * 100) / 100 : totalItemValue;

    items.push({
      description,
      quantity,
      unitValue,
      totalItemValue,
    });
  }

  if (items.length === 0) {
    return { error: "Nenhum item encontrado no texto. Verifique se o formato é de MG." };
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
