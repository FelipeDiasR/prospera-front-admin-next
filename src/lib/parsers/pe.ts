import { NfceParserFn, ParsedLineItem, ParsedResult } from "./types";

/**
 * Parser para NFC-e do estado de Pernambuco.
 *
 * Formato esperado (texto colado do site da SEFAZ-PE):
 * - Estabelecimento antes de "CNPJ:"
 * - CNPJ com pontuação: "CNPJ: XX.XXX.XXX/XXXX-XX"
 * - Itens: DESCRIÇÃO(Código: XXX)Qtde.: QTDEUn: UNVl. Unit.: VALORVl. TotalTOTAL
 * - Data: "Data de Emissão: DD/MM/YYYY HH:MM:SS"
 */
export const parsePE: NfceParserFn = (rawText: string): ParsedResult | { error: string } => {
  // Normalize: remove line breaks to handle text pasted from browser
  const text = rawText.replace(/[\r\n]+/g, "").trim();

  if (!text.includes("CNPJ:") || !text.includes("(Código:")) {
    return { error: "Texto não reconhecido como NFC-e de Pernambuco. Verifique se contém CNPJ e itens com código." };
  }

  // Extract CNPJ
  const cnpjMatch = text.match(/CNPJ:\s*([^\r\n]+?)(?=\s*(?:RUA|AV|AVENIDA|ROD|RODOVIA|EST|ESTRADA|TV|TRAVESSA|AL|ALAMEDA|R\.|Rua|Av|Inscrição|IE|I\.E)|\s{2,})/i);
  let cnpjRaw = "";
  if (cnpjMatch) {
    cnpjRaw = cnpjMatch[1].replace(/\D/g, "");
  } else {
    // Fallback: grab digits after CNPJ:
    const fallback = text.match(/CNPJ:\s*([\d.\/\-\s]+)/);
    if (fallback) {
      cnpjRaw = fallback[1].replace(/\D/g, "");
    }
  }

  if (cnpjRaw.length !== 14) {
    return { error: `CNPJ inválido encontrado. Esperado 14 dígitos, encontrado ${cnpjRaw.length}.` };
  }

  // Extract establishment name (before CNPJ:)
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

  // Extract date/time
  let issuedDate = "";
  let issuedTime = "";
  const dateMatch = text.match(/Data de Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2}:\d{2})?/i);
  if (dateMatch) {
    const [dd, mm, yyyy] = dateMatch[1].split("/");
    issuedDate = `${yyyy}-${mm}-${dd}`;
    if (dateMatch[2]) {
      issuedTime = dateMatch[2].substring(0, 5);
    }
  }

  // Extract items using split approach to isolate descriptions correctly
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
      // First item: text after address (after state abbreviation like ", PE")
      const allUfMatches = [...description.matchAll(/,\s{0,3}[A-Z]{2}/g)];
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
    return { error: "Nenhum item encontrado no texto. Verifique se o formato é de PE." };
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
