import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import path from "path";
import * as XLSX from "xlsx";

// Forçar Node.js runtime (pdfkit precisa de APIs do Node)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Dados da conta ──────────────────────────────────────────────────────────

const CONTA = {
  nome: "PROSPERA SOLUCOES E TECNOLOGIA S.A.",
  banco: "401",
  agencia: "0001",
  contaCorrente: "2651698-0",
  documento: "31.648.992/0001-91",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface TransacaoIugo {
  data: string;
  saldoInicial: number;
  valor: number;
  saldoFinal: number;
  historico: string;
  tipoMovimentacao: string;
  codigo: string;
  referencia: string;
  email: string;
  nomeCliente: string;
  tipo: "entrada" | "saida";
}

interface ResumoFinanceiro {
  totalEntradas: number;
  totalSaidas: number;
  quantidadeEntradas: number;
  quantidadeSaidas: number;
  periodo: { inicio: string; fim: string };
  saldoInicial: number;
  saldoFinal: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Corrige mojibake do tipo UTF-8 interpretado como Latin-1 (ex.: "TransferÃªncia"
// -> "Transferência"). Reverte o processo: cada caractere volta a ser tratado
// como byte e a sequência é redecodificada como UTF-8.
function corrigirMojibakeUTF8(texto: string): string {
  // Só age quando há indício do padrão (Ã ou Â seguidos de outro caractere),
  // evitando corromper texto que já está correto.
  if (!/[ÃÂ][\x80-\xbf\u0080-\u00ff]/.test(texto)) return texto;
  try {
    const bytes = Uint8Array.from(Array.from(texto, (c) => c.charCodeAt(0) & 0xff));
    const decodificado = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Se a decodificação introduziu o caractere de substituição, mantém o original.
    if (decodificado.includes("\uFFFD")) return texto;
    return decodificado;
  } catch {
    return texto;
  }
}

function corrigirEncoding(texto: string): string {
  // 1) Corrupção estilo Mac Roman (ex.: "√™" -> "ê")
  const substituicoes: Record<string, string> = {
    "√≥": "ó", "√£": "ã", "√©": "é", "√™": "ê",
    "√≠": "í", "√°": "ð", "√¡": "á", "√∫": "ú",
    "√ß": "ç", "√¥": "õ", "√≤": "ò", "√∞": "à",
    "√â": "â", "√ä": "ä", "√ü": "ü",
  };
  let resultado = texto;
  for (const [errado, correto] of Object.entries(substituicoes)) {
    resultado = resultado.split(errado).join(correto);
  }
  // 2) Mojibake UTF-8 -> Latin-1 (ex.: "TransferÃªncia" -> "Transferência")
  resultado = corrigirMojibakeUTF8(resultado);
  return resultado;
}

// Converte string com formato BR (2.936,47) ou ponto decimal (-4.25) em número.
function parseNumeroBR(texto: string): number {
  const limpo = texto.trim().replace(/\s/g, "");
  if (!limpo) return 0;
  // Se tem vírgula, assume formato BR: ponto = milhar, vírgula = decimal
  if (limpo.includes(",")) {
    const n = parseFloat(limpo.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(limpo);
  return isNaN(n) ? 0 : n;
}

// Normaliza data de formatos variados para AAAA-MM-DD.
function normalizarDataCSV(texto: string): string {
  const t = texto.trim();
  // DD/MM/AAAA
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, d, m, a] = br;
    return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Já em AAAA-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return t;
}

// Detecta se o cabeçalho CSV/Excel é o formato resumido (6 colunas):
// Data, Tipo de Movimentação, Valor, Quantidade, Movimento, Saldo
function isFormatoResumido(headersNorm: string[]): boolean {
  return (
    headersNorm.includes("tipo de movimentacao") &&
    headersNorm.includes("quantidade") &&
    headersNorm.includes("saldo")
  );
}

// Linhas marcadoras que não são transações reais
function isLinhaMarker(tipoMov: string): boolean {
  const lower = tipoMov.toLowerCase().trim();
  return lower === "saldo inicial" || lower === "saldo final";
}

function parsearCSVIugo(conteudo: string): TransacaoIugo[] {
  let texto = corrigirEncoding(conteudo.trim());
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);

  // Detectar separador: tab ou vírgula
  const primeiraLinha = texto.split("\n")[0] || "";
  const separador = primeiraLinha.includes("\t") ? "\t" : ",";

  const linhas = texto.split("\n");
  let headerLine = linhas[0];
  let dataLines: string[];

  if (linhas.length > 3) {
    dataLines = linhas.slice(1).filter((l) => l.trim());
  } else {
    // Fallback para CSVs "achatados" (poucas linhas com tudo grudado)
    const fullText = linhas.join("");
    const datePattern = separador === "\t"
      ? /(?=\d{1,2}\/\d{1,2}\/\d{4}\t)/
      : /(?=\d{4}-\d{2}-\d{2},)/;
    const headerMatch = fullText.match(
      new RegExp(`^(.+?)${datePattern.source}`)
    );
    if (headerMatch) {
      headerLine = headerMatch[1].trim();
      const restante = fullText.slice(headerMatch[0].length);
      dataLines = restante.split(datePattern).filter((r) => r.trim());
    } else {
      return [];
    }
  }

  const headers = headerLine.split(separador);
  const headersNorm = headers.map((h) =>
    corrigirEncoding(h)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
  );

  const transacoes: TransacaoIugo[] = [];

  // ─── Formato resumido (6 colunas) ───
  if (isFormatoResumido(headersNorm)) {
    const idx = (nomes: string[], fb: number) => {
      for (const n of nomes) {
        const p = headersNorm.indexOf(n);
        if (p !== -1) return p;
      }
      return fb;
    };
    const cData = idx(["data"], 0);
    const cTipoMov = idx(["tipo de movimentacao"], 1);
    const cValor = idx(["valor"], 2);
    const cQtd = idx(["quantidade"], 3);
    const cMovimento = idx(["movimento"], 4);
    const cSaldo = idx(["saldo"], 5);

    for (const linha of dataLines) {
      if (!linha.trim()) continue;
      const campos = linha.split(separador);
      if (campos.length < 4) continue;

      const tipoMovimentacao = corrigirEncoding(campos[cTipoMov]?.trim() || "");
      // Pular linhas marcadoras
      if (isLinhaMarker(tipoMovimentacao)) continue;

      const data = normalizarDataCSV(campos[cData]?.trim() || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;

      const valor = parseNumeroBR(campos[cValor]?.trim() || "");
      const saldo = parseNumeroBR(campos[cSaldo]?.trim() || "");
      const movimento = parseNumeroBR(campos[cMovimento]?.trim() || "");
      const quantidade = parseNumeroBR(campos[cQtd]?.trim() || "");

      // No formato resumido, usamos "Tipo de Movimentação" como histórico também,
      // pois não há coluna separada de histórico.
      const tipo: "entrada" | "saida" = valor >= 0 ? "entrada" : "saida";
      transacoes.push({
        data,
        saldoInicial: saldo - movimento, // saldo antes da transação
        valor: Math.abs(valor),
        saldoFinal: saldo,
        historico: tipoMovimentacao,
        tipoMovimentacao,
        codigo: "",
        referencia: quantidade > 0 ? `${quantidade}x` : "",
        email: "",
        nomeCliente: "",
        tipo,
      });
    }
    return transacoes;
  }

  // ─── Formato original (10 colunas) ───
  const numColunas = headers.length;

  for (const linha of dataLines) {
    if (!linha.trim()) continue;
    const campos = linha.split(separador);
    if (campos.length < 6) continue;

    const data = normalizarDataCSV(campos[0]?.trim() || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;

    const saldoInicial = parseNumeroBR(campos[1]?.trim() || "");
    const valor = parseNumeroBR(campos[2]?.trim() || "");
    const saldoFinal = parseNumeroBR(campos[3]?.trim() || "");

    let historico = "", tipoMovimentacao = "", codigo = "";
    let referencia = "", email = "", nomeCliente = "";

    if (campos.length >= numColunas) {
      nomeCliente = corrigirEncoding(campos[campos.length - 1]?.trim() || "");
      email = campos[campos.length - 2]?.trim() || "";
      referencia = campos[campos.length - 3]?.trim() || "";
      codigo = campos[campos.length - 4]?.trim() || "";
      tipoMovimentacao = corrigirEncoding(campos[campos.length - 5]?.trim() || "");
      historico = corrigirEncoding(campos.slice(4, campos.length - 5).join(",").trim());
    } else {
      historico = corrigirEncoding(campos[4]?.trim() || "");
      tipoMovimentacao = corrigirEncoding(campos[5]?.trim() || "");
      codigo = campos[6]?.trim() || "";
      referencia = campos[7]?.trim() || "";
      email = campos[8]?.trim() || "";
      nomeCliente = corrigirEncoding(campos[9]?.trim() || "");
    }

    // Pular linhas marcadoras no formato original também
    if (isLinhaMarker(tipoMovimentacao) || isLinhaMarker(historico)) continue;

    const tipo: "entrada" | "saida" = valor >= 0 ? "entrada" : "saida";
    transacoes.push({
      data, saldoInicial, valor: Math.abs(valor), saldoFinal,
      historico, tipoMovimentacao, codigo, referencia,
      email, nomeCliente, tipo,
    });
  }
  return transacoes;
}

// ─── Parser Excel (.xlsx / .xls) ──────────────────────────────────────────────

// Normaliza data para o formato AAAA-MM-DD usado pelo restante do código.
// Aceita: Date (célula de data do Excel), "DD/MM/AAAA" (BR) ou "AAAA-MM-DD".
function normalizarDataExcel(valor: unknown): string {
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    const ano = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  const texto = String(valor ?? "").trim();
  if (!texto) return "";

  // Formato BR: DD/MM/AAAA
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, dia, mes, ano] = br;
    return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  }

  // Já está em AAAA-MM-DD (com hora opcional)
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return texto;
}

// Converte um valor de célula (number ou string com vírgula/ponto) em número.
function parseNumeroExcel(valor: unknown): number {
  if (typeof valor === "number") return valor;
  const texto = String(valor ?? "").trim();
  if (!texto) return 0;
  // Remove separador de milhar e usa ponto como decimal.
  // Ex.: "1.234,56" -> "1234.56" ; "-4.25" permanece "-4.25"
  let normalizado = texto.replace(/\s/g, "");
  if (normalizado.includes(",")) {
    normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(normalizado);
  return isNaN(n) ? 0 : n;
}

function normalizarChave(texto: unknown): string {
  return corrigirEncoding(String(texto ?? ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parsearExcelIugo(buffer: ArrayBuffer): TransacaoIugo[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const primeiraAba = workbook.SheetNames[0];
  if (!primeiraAba) return [];

  const sheet = workbook.Sheets[primeiraAba];
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: true,
  });
  if (linhas.length < 2) return [];

  // Localiza a linha de cabeçalho procurando pelas colunas conhecidas.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(linhas.length, 5); i++) {
    const chaves = (linhas[i] || []).map(normalizarChave);
    if (
      chaves.includes("data") &&
      (chaves.some((c) => c.startsWith("saldo")) || chaves.includes("valor"))
    ) {
      headerIdx = i;
      break;
    }
  }

  const header = (linhas[headerIdx] || []).map(normalizarChave);

  // Mapeia índices por nome de coluna, com fallback para posição fixa.
  const idx = (nomes: string[], fallback: number) => {
    for (const nome of nomes) {
      const pos = header.indexOf(nome);
      if (pos !== -1) return pos;
    }
    return fallback;
  };

  const resumido = isFormatoResumido(header);
  const transacoes: TransacaoIugo[] = [];

  if (resumido) {
    // ─── Formato resumido (6 colunas) ───
    const cData = idx(["data"], 0);
    const cTipoMov = idx(["tipo de movimentacao"], 1);
    const cValor = idx(["valor"], 2);
    const cQtd = idx(["quantidade"], 3);
    const cMovimento = idx(["movimento"], 4);
    const cSaldo = idx(["saldo"], 5);

    for (let i = headerIdx + 1; i < linhas.length; i++) {
      const linha = linhas[i] || [];
      const tipoMovimentacao = corrigirEncoding(String(linha[cTipoMov] ?? "").trim());
      if (isLinhaMarker(tipoMovimentacao)) continue;

      const data = normalizarDataExcel(linha[cData]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;

      const valor = parseNumeroExcel(linha[cValor]);
      const saldo = parseNumeroExcel(linha[cSaldo]);
      const movimento = parseNumeroExcel(linha[cMovimento]);
      const quantidade = parseNumeroExcel(linha[cQtd]);

      const tipo: "entrada" | "saida" = valor >= 0 ? "entrada" : "saida";
      transacoes.push({
        data,
        saldoInicial: saldo - movimento,
        valor: Math.abs(valor),
        saldoFinal: saldo,
        historico: tipoMovimentacao,
        tipoMovimentacao,
        codigo: "",
        referencia: quantidade > 0 ? `${quantidade}x` : "",
        email: "",
        nomeCliente: "",
        tipo,
      });
    }
  } else {
    // ─── Formato original (10 colunas) ───
    const cData = idx(["data"], 0);
    const cSaldoInicial = idx(["saldo inicial"], 1);
    const cValor = idx(["valor"], 2);
    const cSaldoFinal = idx(["saldo final"], 3);
    const cHistorico = idx(["historico"], 4);
    const cTipoMov = idx(["tipo de movimentacao", "tipo movimentacao"], 5);
    const cCodigo = idx(["codigo"], 6);
    const cReferencia = idx(["referencia"], 7);
    const cEmail = idx(["e-mail", "email"], 8);
    const cCliente = idx(["nome cliente", "nome do cliente", "cliente"], 9);

    for (let i = headerIdx + 1; i < linhas.length; i++) {
      const linha = linhas[i] || [];
      const data = normalizarDataExcel(linha[cData]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;

      const saldoInicial = parseNumeroExcel(linha[cSaldoInicial]);
      const valor = parseNumeroExcel(linha[cValor]);
      const saldoFinal = parseNumeroExcel(linha[cSaldoFinal]);

      const historico = corrigirEncoding(String(linha[cHistorico] ?? "").trim());
      const tipoMovimentacao = corrigirEncoding(String(linha[cTipoMov] ?? "").trim());

      // Pular linhas marcadoras
      if (isLinhaMarker(tipoMovimentacao) || isLinhaMarker(historico)) continue;

      const codigo = String(linha[cCodigo] ?? "").trim();
      const referencia = String(linha[cReferencia] ?? "").trim();
      const email = String(linha[cEmail] ?? "").trim();
      const nomeCliente = corrigirEncoding(String(linha[cCliente] ?? "").trim());

      const tipo: "entrada" | "saida" = valor >= 0 ? "entrada" : "saida";
      transacoes.push({
        data,
        saldoInicial,
        valor: Math.abs(valor),
        saldoFinal,
        historico,
        tipoMovimentacao,
        codigo,
        referencia,
        email,
        nomeCliente,
        tipo,
      });
    }
  }

  return transacoes;
}

function calcularResumo(transacoes: TransacaoIugo[]): ResumoFinanceiro {
  const entradas = transacoes.filter((t) => t.tipo === "entrada");
  const saidas = transacoes.filter((t) => t.tipo === "saida");
  return {
    totalEntradas: entradas.reduce((acc, t) => acc + t.valor, 0),
    totalSaidas: saidas.reduce((acc, t) => acc + t.valor, 0),
    quantidadeEntradas: entradas.length,
    quantidadeSaidas: saidas.length,
    periodo: {
      inicio: transacoes[0]?.data || "N/A",
      fim: transacoes[transacoes.length - 1]?.data || "N/A",
    },
    saldoInicial: transacoes[0]?.saldoInicial || 0,
    saldoFinal: transacoes[transacoes.length - 1]?.saldoFinal || 0,
  };
}

function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(data: string): string {
  const partes = data.split("-");
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return data;
}

function getDataHoraAtual(): string {
  const now = new Date();
  return now.toLocaleDateString("pt-BR") + " " +
    now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ─── Geração do PDF ──────────────────────────────────────────────────────────

function gerarPDF(
  transacoes: TransacaoIugo[],
  resumo: ResumoFinanceiro
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 30, bottom: 30, left: 40, right: 40 },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 80;
    const logoPath = path.join(process.cwd(), "public", "logo-prospera.png");

    // ─── Função para desenhar o cabeçalho ───
    function drawHeader() {
      const headerY = 30;

      // Logo à esquerda
      try {
        doc.image(logoPath, 40, headerY, { height: 40 });
      } catch {
        // Se a logo não carregar, usa texto
        doc.fontSize(16).font("Helvetica-Bold").fillColor("#e65100")
          .text("PROSPERA", 40, headerY + 10);
      }

      // Dados da conta no centro
      const centerX = 180;
      doc.fontSize(14).font("Helvetica-Bold").fillColor("#000000")
        .text(`Extrato da conta ${CONTA.contaCorrente}`, centerX, headerY);
      doc.fontSize(9).font("Helvetica").fillColor("#333333")
        .text(CONTA.nome, centerX, headerY + 18);
      doc.fontSize(9).font("Helvetica").fillColor("#333333")
        .text(`CNPJ: ${CONTA.documento}`, centerX, headerY + 30);

      // Data à direita
      const rightX = pageWidth - 60;
      doc.fontSize(9).font("Helvetica").fillColor("#333333")
        .text(`Data: ${new Date().toLocaleDateString("pt-BR")}`, rightX, headerY, {
          width: 140, align: "right",
        });
      doc.fontSize(7).font("Helvetica").fillColor("#666666")
        .text(`Emitido em ${getDataHoraAtual()}`, rightX, headerY + 30, {
          width: 140, align: "right",
        });

      // Linha separadora
      doc.strokeColor("#e67e22").lineWidth(1.5)
        .moveTo(40, headerY + 48).lineTo(40 + pageWidth, headerY + 48).stroke();

      // Info banco/agência abaixo da linha
      doc.fontSize(8).font("Helvetica").fillColor("#555")
        .text(
          `Banco: ${CONTA.banco}  |  Agência: ${CONTA.agencia}  |  Conta: ${CONTA.contaCorrente}  |  Período: ${formatarData(resumo.periodo.inicio)} a ${formatarData(resumo.periodo.fim)}`,
          40, headerY + 54
        );

      doc.y = headerY + 72;
    }

    drawHeader();

    // ─── Resumo ───
    doc.moveDown(0.3);
    const cardY = doc.y;
    const cardWidth = pageWidth / 4 - 8;

    // Saldo Inicial
    doc.rect(40, cardY, cardWidth, 45).fillAndStroke("#f5f5f5", "#ccc");
    doc.fontSize(7).font("Helvetica").fillColor("#666")
      .text("SALDO INICIAL", 48, cardY + 6, { width: cardWidth - 16 });
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#333")
      .text(formatarMoeda(resumo.saldoInicial), 48, cardY + 18, { width: cardWidth - 16 });
    doc.fontSize(7).font("Helvetica").fillColor("#888")
      .text(formatarData(resumo.periodo.inicio), 48, cardY + 33, { width: cardWidth - 16 });

    // Entradas
    const c2X = 40 + cardWidth + 11;
    doc.rect(c2X, cardY, cardWidth, 45).fillAndStroke("#e8f5e9", "#4caf50");
    doc.fontSize(7).font("Helvetica").fillColor("#2e7d32")
      .text("ENTRADAS", c2X + 8, cardY + 6, { width: cardWidth - 16 });
    doc.fontSize(11).font("Helvetica-Bold")
      .text(formatarMoeda(resumo.totalEntradas), c2X + 8, cardY + 18, { width: cardWidth - 16 });
    doc.fontSize(7).font("Helvetica")
      .text(`${resumo.quantidadeEntradas} transações`, c2X + 8, cardY + 33, { width: cardWidth - 16 });

    // Saídas
    const c3X = c2X + cardWidth + 11;
    doc.rect(c3X, cardY, cardWidth, 45).fillAndStroke("#ffebee", "#f44336");
    doc.fontSize(7).font("Helvetica").fillColor("#c62828")
      .text("SAÍDAS", c3X + 8, cardY + 6, { width: cardWidth - 16 });
    doc.fontSize(11).font("Helvetica-Bold")
      .text(formatarMoeda(resumo.totalSaidas), c3X + 8, cardY + 18, { width: cardWidth - 16 });
    doc.fontSize(7).font("Helvetica")
      .text(`${resumo.quantidadeSaidas} transações`, c3X + 8, cardY + 33, { width: cardWidth - 16 });

    // Saldo Final
    const c4X = c3X + cardWidth + 11;
    doc.rect(c4X, cardY, cardWidth, 45).fillAndStroke("#e3f2fd", "#1976d2");
    doc.fontSize(7).font("Helvetica").fillColor("#0d47a1")
      .text("SALDO FINAL", c4X + 8, cardY + 6, { width: cardWidth - 16 });
    doc.fontSize(11).font("Helvetica-Bold")
      .text(formatarMoeda(resumo.saldoFinal), c4X + 8, cardY + 18, { width: cardWidth - 16 });
    doc.fontSize(7).font("Helvetica")
      .text(formatarData(resumo.periodo.fim), c4X + 8, cardY + 33, { width: cardWidth - 16 });

    doc.y = cardY + 55;
    doc.moveDown(0.4);

    // ─── Tabela ───
    const colWidths = {
      data: 58,
      historico: pageWidth - 58 - 95 - 68 - 68 - 85,
      tipo: 95,
      valor: 68,
      saldo: 68,
      cliente: 85,
    };

    function drawTableHeader(y: number) {
      doc.rect(40, y, pageWidth, 16).fill("#333333");
      doc.fontSize(7).font("Helvetica-Bold").fillColor("#ffffff");
      let x = 44;
      doc.text("DATA", x, y + 4, { width: colWidths.data });
      x += colWidths.data;
      doc.text("HISTÓRICO", x, y + 4, { width: colWidths.historico });
      x += colWidths.historico;
      doc.text("MOVIMENTAÇÃO", x, y + 4, { width: colWidths.tipo });
      x += colWidths.tipo;
      doc.text("VALOR", x, y + 4, { width: colWidths.valor, align: "right" });
      x += colWidths.valor;
      doc.text("SALDO", x, y + 4, { width: colWidths.saldo, align: "right" });
      x += colWidths.saldo;
      doc.text("CLIENTE", x, y + 4, { width: colWidths.cliente });
      return y + 20;
    }

    let rowY = drawTableHeader(doc.y);

    transacoes.forEach((t, i) => {
      if (rowY > doc.page.height - 50) {
        doc.addPage();
        drawHeader();
        rowY = drawTableHeader(doc.y);
      }
      if (i % 2 === 0) {
        doc.rect(40, rowY - 1, pageWidth, 14).fill("#fafafa");
      }
      doc.fontSize(7).font("Helvetica").fillColor("#333");

      let x = 44;
      doc.text(formatarData(t.data), x, rowY, { width: colWidths.data });
      x += colWidths.data;

      const hist = t.historico.length > 48
        ? t.historico.substring(0, 45) + "..."
        : t.historico;
      doc.text(hist, x, rowY, { width: colWidths.historico });
      x += colWidths.historico;

      const tipoMov = t.tipoMovimentacao.length > 15
        ? t.tipoMovimentacao.substring(0, 12) + "..."
        : t.tipoMovimentacao;
      doc.text(tipoMov, x, rowY, { width: colWidths.tipo });
      x += colWidths.tipo;

      const valorCor = t.tipo === "entrada" ? "#2e7d32" : "#c62828";
      const sinal = t.tipo === "entrada" ? "+" : "-";
      doc.fillColor(valorCor).text(
        `${sinal} ${formatarMoeda(t.valor)}`, x, rowY,
        { width: colWidths.valor, align: "right" }
      );
      x += colWidths.valor;

      doc.fillColor("#333").text(
        formatarMoeda(t.saldoFinal), x, rowY,
        { width: colWidths.saldo, align: "right" }
      );
      x += colWidths.saldo;

      const cliente = (t.nomeCliente || "-").substring(0, 13);
      doc.fillColor("#555").text(cliente, x, rowY, { width: colWidths.cliente });

      rowY += 14;
    });

    // ─── Rodapé ───
    if (rowY > doc.page.height - 50) doc.addPage();
    doc.y = rowY + 10;
    doc.strokeColor("#e0e0e0").lineWidth(0.5)
      .moveTo(40, doc.y).lineTo(40 + pageWidth, doc.y).stroke();
    doc.moveDown(0.3);
    doc.fontSize(7).font("Helvetica").fillColor("#999")
      .text(
        `Extrato bancário gerado automaticamente. ${CONTA.nome} | CNPJ: ${CONTA.documento} | Banco: ${CONTA.banco} | Ag: ${CONTA.agencia} | CC: ${CONTA.contaCorrente}`,
        { align: "center" }
      );

    doc.end();
  });
}

// ─── API Route ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    const nome = file.name.toLowerCase();
    const isExcel = nome.endsWith(".xlsx") || nome.endsWith(".xls");
    const isTexto = nome.endsWith(".csv") || nome.endsWith(".txt");

    if (!isExcel && !isTexto) {
      return NextResponse.json(
        { error: "Formato inválido. Envie um arquivo .csv, .txt, .xlsx ou .xls" },
        { status: 400 }
      );
    }

    let transacoes: TransacaoIugo[];

    if (isExcel) {
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength === 0) {
        return NextResponse.json({ error: "Arquivo está vazio" }, { status: 400 });
      }
      transacoes = parsearExcelIugo(buffer);
    } else {
      const conteudo = await file.text();
      if (!conteudo.trim()) {
        return NextResponse.json({ error: "Arquivo está vazio" }, { status: 400 });
      }
      transacoes = parsearCSVIugo(conteudo);
    }

    if (transacoes.length === 0) {
      return NextResponse.json(
        { error: "Não foi possível identificar transações. Verifique se é um extrato da Iugo." },
        { status: 400 }
      );
    }

    const resumo = calcularResumo(transacoes);
    const pdfBuffer = await gerarPDF(transacoes, resumo);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="extrato-prospera-${resumo.periodo.inicio}-a-${resumo.periodo.fim}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro ao gerar extrato:", msg, error instanceof Error ? error.stack : "");
    return NextResponse.json(
      { error: `Erro interno ao processar o arquivo: ${msg}` },
      { status: 500 }
    );
  }
}
