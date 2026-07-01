import { UfEntry } from "./types";
import { parseDF } from "./df";
import { parseMG } from "./mg";
import { parsePE } from "./pe";
import { parsePI } from "./pi";
import { parsePR } from "./pr";
import { parseRJ } from "./rj";

export type { ParsedResult, ParsedLineItem, NfceParserFn, UfEntry } from "./types";

/**
 * Registry de parsers por UF.
 * Para adicionar um novo estado, basta:
 * 1. Criar o arquivo src/lib/parsers/XX.ts com export const parseXX: NfceParserFn
 * 2. Importar aqui e adicionar uma entrada no array abaixo
 *
 * O State Selector do front exibe automaticamente os estados registrados aqui.
 */
export const parserRegistry: UfEntry[] = [
  { code: "DF", name: "Distrito Federal", parser: parseDF },
  { code: "MG", name: "Minas Gerais", parser: parseMG },
  { code: "PE", name: "Pernambuco", parser: parsePE },
  { code: "PI", name: "Piauí", parser: parsePI },
  { code: "PR", name: "Paraná", parser: parsePR },
  { code: "RJ", name: "Rio de Janeiro", parser: parseRJ },
].sort((a, b) => a.code.localeCompare(b.code));

export function getParserByUf(uf: string) {
  return parserRegistry.find((entry) => entry.code === uf)?.parser ?? null;
}
