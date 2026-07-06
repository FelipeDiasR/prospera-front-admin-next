import { NfceParserFn, ParsedLineItem, ParsedResult } from "./types";

/**
 * Parser para NFC-e do estado do Maranhão.
 *
 * Formato esperado (texto colado do site da SEFAZ-MA):
 * - Header com texto institucional (Módulos disponíveis, NOTA FISCAL DE CONSUMIDOR ELETRÔNICA NFC-e, etc.)
 * - Estabelecimento antes de "CNPJ:"
 * - CNPJ com pontuação
 * - Itens em formato tabular: CódigoDescriçãoQtdeUnVl UnitVl TributoVl Total
 *   seguido por: CODE + DESCRIPTION + QTY + UNIT + VLUNIT + VLTRIBUTO(2dec) + VLTOTAL(2dec)
 * - Data: "Data de Emissão: DD/MM/YYYY HH:MM:SS"
 */
export const parseMA: NfceParserFn = (rawText: string): ParsedResult | { error: string } => {
  // Normalize: remove line breaks to handle text pasted from browser
  const text = rawText.replace(/[\r\n]+/g, "").replace(/\s{2,}/g, " ").trim();

  if (!text.includes("CNPJ:")) {
    return { error: "Texto não reconhecido como NFC-e do Maranhão. CNPJ não encontrado." };
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
    // Find the last known header pattern and take everything after it
    const headerMatch = nameText.match(
      /(?:Imprimir|DANFE\s*NFC-e|NFC-e|DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETR[OÔÖ]NICA|NOTA FISCAL DE CONSUMIDOR ELETR[OÔÖ]NICA\s*NFC-e|Nota Fiscal de Consumidor Eletr[oô]nica\s*\(NFC-e\)|AMBIENTE DE PRODU[CÇ][AÃ]O|Consulta Completa de NFCe|Página Inicial|Módulos dispon[ií]veis)/gi
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

  // Extract items - MA format is tabular with optional Tributo column:
  // Header: "CódigoDescriçãoQtdeUnVl UnitVl [Tributo] Vl Total"
  // The values (vlUnit, tributo, total) are glued together making regex parsing unreliable
  // Strategy: find each item boundary using UNIT keywords, extract total from the end,
  // and compute unitValue = total / qty
  const items: ParsedLineItem[] = [];

  const tableHeaderMatch = text.match(/C[oó]digo\s*Descri[cç][aã]o\s*Qtde?\s*Un\s*Vl\s*Unit\s*(?:Vl\s*Tributo\s*)?Vl\s*Total/i);
  const totalMarkerMatch = text.match(/Qtd\.?\s*Total\s*de\s*Itens/i);

  if (tableHeaderMatch && totalMarkerMatch && tableHeaderMatch.index != null && totalMarkerMatch.index != null) {
    const itemsSection = text.substring(
      tableHeaderMatch.index + tableHeaderMatch[0].length,
      totalMarkerMatch.index
    );

    // Find items by looking for: CODE(digits) + DESC + QTY + UNIT + VALUES...TOTAL(,XX)
    // Split itemsSection into individual items by finding UNIT keywords between digits
    const unitKeywords = "UNID|UND|UN|KG|MC|LT|CX|DZ|PC|PT|GF|ML|M2|M";
    // Find all positions where a UNIT keyword appears between digits (qty before, value after)
    const unitRegex = new RegExp(`(\\d)(${unitKeywords})(\\d)`, "gi");
    const unitPositions: { pos: number; unit: string; endPos: number }[] = [];
    let uMatch;
    while ((uMatch = unitRegex.exec(itemsSection)) !== null) {
      unitPositions.push({
        pos: uMatch.index + 1, // start of unit keyword (after the digit)
        unit: uMatch[2],
        endPos: uMatch.index + 1 + uMatch[2].length, // position after unit keyword
      });
    }

    for (let i = 0; i < unitPositions.length; i++) {
      const { pos, unit, endPos } = unitPositions[i];

      // Everything after UNIT until next item (or end) contains the values
      const nextItemStart = i + 1 < unitPositions.length
        ? findItemCodeStart(itemsSection, unitPositions[i + 1].pos)
        : itemsSection.length;

      const valuesStr = itemsSection.substring(endPos, nextItemStart);

      // Total is the LAST \d+,\d{2} in the values string
      const allValues = [...valuesStr.matchAll(/(\d+,\d{2})/g)];
      const totalStr = allValues.length > 0 ? allValues[allValues.length - 1][1] : null;
      if (!totalStr) continue;

      const totalItemValue = parseFloat(totalStr.replace(",", "."));

      // Before UNIT: ...DESCRIPTION + QTY
      const beforeUnit = itemsSection.substring(
        i === 0 ? 0 : findItemCodeStart(itemsSection, pos),
        pos
      );

      // QTY is the last number (with possible dot decimal) before the unit
      const qtyMatch = beforeUnit.match(/([\d]+(?:[.,]\d+)?)\s*$/);
      if (!qtyMatch) continue;

      const quantity = parseFloat(qtyMatch[1].replace(",", "."));
      const unitValue = quantity > 0 ? Math.round((totalItemValue / quantity) * 100) / 100 : totalItemValue;

      // Description: between code and qty
      const descSection = beforeUnit.substring(0, beforeUnit.length - qtyMatch[0].length);
      const codeMatch = descSection.match(/^\s*(\d+)\s*/);
      const description = codeMatch
        ? descSection.substring(codeMatch[0].length).trim()
        : descSection.trim();

      if (!description || isNaN(quantity) || isNaN(totalItemValue)) continue;

      items.push({
        description,
        quantity,
        unitValue,
        totalItemValue: Math.round(totalItemValue * 100) / 100,
      });
    }
  }

  function findItemCodeStart(section: string, beforePos: number): number {
    // Walk backwards from beforePos to find where the item's CODE starts
    // Items start with a code (sequence of digits) that follows the previous item's total
    // Find the last ,\d\d boundary before this position
    const sub = section.substring(0, beforePos);
    const lastValueEnd = sub.match(/.*,\d{2}/s);
    if (lastValueEnd) {
      return lastValueEnd[0].length;
    }
    return 0;
  }

  if (items.length === 0) {
    return { error: "Nenhum item encontrado no texto. Verifique se o formato é de MA." };
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
