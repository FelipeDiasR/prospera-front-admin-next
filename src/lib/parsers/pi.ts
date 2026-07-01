import { NfceParserFn, ParsedLineItem, ParsedResult } from "./types";

/**
 * Parser para NFC-e do estado do Piauí.
 *
 * Formato esperado (texto colado do site da SEFAZ-PI):
 * - Header com "NFC-e Nota Fiscal do Consumidor Eletrônica" + texto institucional
 * - Estabelecimento antes de "CNPJ:"
 * - CNPJ com pontuação: "CNPJ: XX.XXX.XXX/XXXX-XX"
 * - Itens em formato tabular: CódigoDescriçãoQtdeUnVl UnitVl Total
 *   seguido por linhas: COD DESCRICAO QTD UN VLUNIT VLTOTAL
 * - Data: "Data de Emissão: DD/MM/YYYY HH:MM:SS"
 */
export const parsePI: NfceParserFn = (rawText: string): ParsedResult | { error: string } => {
  // Normalize: remove line breaks, collapse multiple spaces
  const text = rawText.replace(/[\r\n]+/g, "").replace(/\s{2,}/g, " ").trim();

  if (!text.includes("CNPJ:")) {
    return { error: "Texto não reconhecido como NFC-e do Piauí. CNPJ não encontrado." };
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
      /(?:Imprimir|DANFE\s*NFC-e|NFC-e\s*Nota Fiscal do Consumidor Eletr[oô]nica|NFC-e|DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETR[OÔÖ]NICA|Nota Fiscal de Consumidor Eletr[oô]nica\s*\(NFC-e\)|Consulta NFCeChave de acesso[^A-Z]*?(?=\p{Lu}{2,}))/giu
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
    // PI has extra text like "Consulta NFCeChave de acesso...contribuintes." before the name
    // Remove everything up to and including the last sentence-ending period followed by uppercase
    const consultaEnd = nameText.match(/contribuintes\.\s*/i);
    if (consultaEnd && consultaEnd.index != null) {
      nameText = nameText.substring(consultaEnd.index + consultaEnd[0].length).trim();
    }
    establishmentName = nameText;
  }

  // Extract date/time - "Data de Emissão: DD/MM/YYYY HH:MM:SS"
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

  // Extract items - PI format is tabular with no separators:
  // Pattern per item: CODE(digits) DESCRIPTION QTY UNIT UNITVALUE(3 decimals) TOTAL(2 decimals)
  // Example: 1936BETERRABA ORG *SP* KG1,466KG39,99058,63
  // Unit value always has 3 decimal places, total always has 2
  const items: ParsedLineItem[] = [];

  // Find the items section between the table header and "Qtd. Total"
  const tableHeaderMatch = text.match(/C[oó]digo\s*Descri[cç][aã]o\s*Qtde?\s*Un\s*Vl\s*Unit\s*Vl\s*Total/i);
  const totalMarkerMatch = text.match(/Qtd\.?\s*Total\s*de\s*Itens/i);

  if (tableHeaderMatch && totalMarkerMatch && tableHeaderMatch.index != null && totalMarkerMatch.index != null) {
    const itemsSection = text.substring(
      tableHeaderMatch.index + tableHeaderMatch[0].length,
      totalMarkerMatch.index
    );

    // Each item: CODE(digits) + DESCRIPTION(text) + QTY(number) + UNIT(2-3 letters) + UNITVALUE(X,XXX format 3 dec) + TOTAL(X,XX format 2 dec)
    // Spaces between fields are optional (text may come glued or with spaces/newlines)
    const itemRegex = /(\d+)\s*([A-ZÀ-Ü][A-ZÀ-Ü *\/\-\.\(\)]+?)\s*([\d]+(?:,\d+)?)\s*(KG|UN|MC|LT|CX|DZ|PC|PT|GF|ML|L|UND)\s*([\d]+,\d{3})\s*([\d]+,\d{2})/gi;

    let match;
    while ((match = itemRegex.exec(itemsSection)) !== null) {
      const description = match[2].trim();
      const quantity = parseFloat(match[3].replace(",", "."));
      const unitValue = parseFloat(match[5].replace(",", "."));
      const totalItemValue = parseFloat(match[6].replace(",", "."));

      if (!description || isNaN(quantity) || isNaN(unitValue) || isNaN(totalItemValue)) continue;

      items.push({
        description,
        quantity,
        unitValue: Math.round(unitValue * 100) / 100,
        totalItemValue: Math.round(totalItemValue * 100) / 100,
      });
    }
  }

  if (items.length === 0) {
    return { error: "Nenhum item encontrado no texto. Verifique se o formato é de PI." };
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
