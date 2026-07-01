export interface ParsedLineItem {
  description: string;
  quantity: number;
  unitValue: number;
  totalItemValue: number;
}

export interface ParsedResult {
  cnpj: string;
  establishmentName: string;
  issuedDate: string; // YYYY-MM-DD
  issuedTime: string; // HH:mm
  items: ParsedLineItem[];
  totalAmount: number;
}

export type NfceParserFn = (rawText: string) => ParsedResult | { error: string };

export interface UfEntry {
  code: string;
  name: string;
  parser: NfceParserFn;
}
