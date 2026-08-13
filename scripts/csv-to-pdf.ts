/**
 * Script para transformar CSV de entrada/saída da Iugo em relatório PDF
 *
 * Uso:
 *   npx tsx scripts/csv-to-pdf.ts <arquivo.csv> [--separador=;] [--saida=relatorio.pdf]
 *
 * Exemplos:
 *   npx tsx scripts/csv-to-pdf.ts dados-iugo.csv
 *   npx tsx scripts/csv-to-pdf.ts dados-iugo.csv --separador=;
 *   npx tsx scripts/csv-to-pdf.ts dados-iugo.csv --saida=relatorio-junho.pdf
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import PDFDocument from "pdfkit";

// ─── Configuração ────────────────────────────────────────────────────────────

interface TransacaoIugo {
  data: string;
  descricao: string;
  tipo: "entrada" | "saida";
  valor: number;
  status?: string;
  cliente?: string;
  formaPagamento?: string;
  [key: string]: string | number | undefined;
}

interface ResumoFinanceiro {
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  quantidadeEntradas: number;
  quantidadeSaidas: number;
  periodo: { inicio: string; fim: string };
}

// ─── Parse de argumentos ─────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const csvFile = args.find((a) => !a.startsWith("--"));
  const separador =
    args
      .find((a) => a.startsWith("--separador="))
      ?.replace("--separador=", "") || ";";
  const saida =
    args.find((a) => a.startsWith("--saida="))?.replace("--saida=", "") ||
    "relatorio-iugo.pdf";

  if (!csvFile) {
    console.error("❌ Uso: npx tsx scripts/csv-to-pdf.ts <arquivo.csv>");
    console.error("   Opções:");
    console.error("     --separador=;     Separador do CSV (padrão: ;)");
    console.error(
      "     --saida=nome.pdf  Nome do arquivo de saída (padrão: relatorio-iugo.pdf)"
    );
    process.exit(1);
  }

  return { csvFile, separador, saida };
}

// ─── Leitura e parse do CSV ──────────────────────────────────────────────────

function lerCSV(filePath: string, separador: string): Record<string, string>[] {
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Arquivo não encontrado: ${fullPath}`);
    process.exit(1);
  }

  const conteudo = fs.readFileSync(fullPath, "utf-8");

  // Tenta detectar o separador se o padrão não funcionar
  const primeiraLinha = conteudo.split("\n")[0];
  let sep = separador;
  if (!primeiraLinha.includes(sep)) {
    if (primeiraLinha.includes("\t")) sep = "\t";
    else if (primeiraLinha.includes(",")) sep = ",";
    else if (primeiraLinha.includes("|")) sep = "|";
    console.log(`⚠️  Separador "${separador}" não detectado. Usando "${sep}"`);
  }

  const records = parse(conteudo, {
    delimiter: sep,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
  }) as Record<string, string>[];

  console.log(`✅ ${records.length} registros lidos do CSV`);
  return records;
}

// ─── Mapeamento dos campos ───────────────────────────────────────────────────

function normalizarCampo(headers: string[], possiveisNomes: string[]): string | undefined {
  return headers.find((h) =>
    possiveisNomes.some(
      (nome) => h.toLowerCase().trim().includes(nome.toLowerCase())
    )
  );
}

function mapearTransacoes(records: Record<string, string>[]): TransacaoIugo[] {
  if (records.length === 0) return [];

  const headers = Object.keys(records[0]);
  console.log(`📋 Colunas detectadas: ${headers.join(", ")}`);

  // Mapeamento flexível de colunas
  const campoData = normalizarCampo(headers, ["data", "date", "dt", "vencimento", "criado", "created"]);
  const campoDescricao = normalizarCampo(headers, ["descri", "description", "desc", "histórico", "historico", "memo"]);
  const campoValor = normalizarCampo(headers, ["valor", "value", "amount", "total", "quantia"]);
  const campoTipo = normalizarCampo(headers, ["tipo", "type", "natureza", "movimento", "operação", "operacao"]);
  const campoStatus = normalizarCampo(headers, ["status", "situação", "situacao", "estado"]);
  const campoCliente = normalizarCampo(headers, ["cliente", "client", "pagador", "nome", "name"]);
  const campoPagamento = normalizarCampo(headers, ["pagamento", "payment", "forma", "método", "metodo"]);

  const resultado: TransacaoIugo[] = [];

  for (const record of records) {
    const valorRaw = campoValor ? record[campoValor] : "0";
    const valor = parseFloat(
      valorRaw
        .replace(/[R$\s]/g, "")
        .replace(/\./g, "")
        .replace(",", ".")
    );

    if (isNaN(valor)) continue;

    // Detecta se é entrada ou saída
    let tipo: "entrada" | "saida" = "entrada";
    if (campoTipo) {
      const tipoRaw = record[campoTipo].toLowerCase();
      if (
        tipoRaw.includes("saída") ||
        tipoRaw.includes("saida") ||
        tipoRaw.includes("débito") ||
        tipoRaw.includes("debito") ||
        tipoRaw.includes("pagamento") ||
        tipoRaw.includes("despesa") ||
        tipoRaw.includes("expense") ||
        tipoRaw.includes("debit")
      ) {
        tipo = "saida";
      }
    } else if (valor < 0) {
      tipo = "saida";
    }

    resultado.push({
      data: campoData ? record[campoData] : "",
      descricao: campoDescricao ? record[campoDescricao] : "Sem descrição",
      tipo,
      valor: Math.abs(valor),
      status: campoStatus ? record[campoStatus] : undefined,
      cliente: campoCliente ? record[campoCliente] : undefined,
      formaPagamento: campoPagamento ? record[campoPagamento] : undefined,
    });
  }

  return resultado;
}

// ─── Cálculo do resumo ───────────────────────────────────────────────────────

function calcularResumo(transacoes: TransacaoIugo[]): ResumoFinanceiro {
  const entradas = transacoes.filter((t) => t.tipo === "entrada");
  const saidas = transacoes.filter((t) => t.tipo === "saida");

  const totalEntradas = entradas.reduce((acc, t) => acc + t.valor, 0);
  const totalSaidas = saidas.reduce((acc, t) => acc + t.valor, 0);

  const datas = transacoes
    .map((t) => t.data)
    .filter((d) => d)
    .sort();

  return {
    totalEntradas,
    totalSaidas,
    saldo: totalEntradas - totalSaidas,
    quantidadeEntradas: entradas.length,
    quantidadeSaidas: saidas.length,
    periodo: {
      inicio: datas[0] || "N/A",
      fim: datas[datas.length - 1] || "N/A",
    },
  };
}

// ─── Geração do PDF ──────────────────────────────────────────────────────────

function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function gerarPDF(
  transacoes: TransacaoIugo[],
  resumo: ResumoFinanceiro,
  outputPath: string
) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
  });

  const stream = fs.createWriteStream(path.resolve(outputPath));
  doc.pipe(stream);

  const pageWidth = doc.page.width - 100; // margins

  // ─── Cabeçalho ───
  doc
    .fontSize(22)
    .font("Helvetica-Bold")
    .fillColor("#1a1a2e")
    .text("Relatório Financeiro", { align: "center" });

  doc
    .fontSize(12)
    .font("Helvetica")
    .fillColor("#555")
    .text("Dados extraídos da Iugo", { align: "center" });

  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .fillColor("#777")
    .text(
      `Período: ${resumo.periodo.inicio} a ${resumo.periodo.fim}`,
      { align: "center" }
    );

  doc
    .text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, {
      align: "center",
    });

  doc.moveDown(1.5);

  // ─── Linha separadora ───
  doc
    .strokeColor("#e0e0e0")
    .lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(50 + pageWidth, doc.y)
    .stroke();

  doc.moveDown(1);

  // ─── Resumo financeiro ───
  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .fillColor("#1a1a2e")
    .text("Resumo Financeiro");

  doc.moveDown(0.5);

  // Cards de resumo
  const cardY = doc.y;
  const cardWidth = pageWidth / 3 - 10;

  // Card Entradas
  doc
    .rect(50, cardY, cardWidth, 60)
    .fillAndStroke("#e8f5e9", "#4caf50");
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#2e7d32")
    .text("ENTRADAS", 50 + 10, cardY + 10, { width: cardWidth - 20 });
  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(formatarMoeda(resumo.totalEntradas), 50 + 10, cardY + 28, {
      width: cardWidth - 20,
    });
  doc
    .fontSize(8)
    .font("Helvetica")
    .text(`${resumo.quantidadeEntradas} transações`, 50 + 10, cardY + 45, {
      width: cardWidth - 20,
    });

  // Card Saídas
  const card2X = 50 + cardWidth + 15;
  doc
    .rect(card2X, cardY, cardWidth, 60)
    .fillAndStroke("#ffebee", "#f44336");
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#c62828")
    .text("SAÍDAS", card2X + 10, cardY + 10, { width: cardWidth - 20 });
  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(formatarMoeda(resumo.totalSaidas), card2X + 10, cardY + 28, {
      width: cardWidth - 20,
    });
  doc
    .fontSize(8)
    .font("Helvetica")
    .text(`${resumo.quantidadeSaidas} transações`, card2X + 10, cardY + 45, {
      width: cardWidth - 20,
    });

  // Card Saldo
  const card3X = card2X + cardWidth + 15;
  const saldoCor = resumo.saldo >= 0 ? "#e3f2fd" : "#fff3e0";
  const saldoBorda = resumo.saldo >= 0 ? "#1976d2" : "#f57c00";
  const saldoTexto = resumo.saldo >= 0 ? "#0d47a1" : "#e65100";
  doc
    .rect(card3X, cardY, cardWidth, 60)
    .fillAndStroke(saldoCor, saldoBorda);
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor(saldoTexto)
    .text("SALDO", card3X + 10, cardY + 10, { width: cardWidth - 20 });
  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(formatarMoeda(resumo.saldo), card3X + 10, cardY + 28, {
      width: cardWidth - 20,
    });
  doc
    .fontSize(8)
    .font("Helvetica")
    .text(
      `${resumo.quantidadeEntradas + resumo.quantidadeSaidas} total`,
      card3X + 10,
      cardY + 45,
      { width: cardWidth - 20 }
    );

  doc.y = cardY + 80;
  doc.moveDown(1);

  // ─── Tabela de transações ───
  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .fillColor("#1a1a2e")
    .text("Detalhamento de Transações");

  doc.moveDown(0.5);

  // Header da tabela
  const tableTop = doc.y;
  const colWidths = {
    data: 70,
    descricao: pageWidth - 70 - 80 - 70 - 60,
    tipo: 60,
    valor: 80,
    status: 70,
  };

  // Fundo do header
  doc.rect(50, tableTop, pageWidth, 20).fill("#1a1a2e");

  doc
    .fontSize(8)
    .font("Helvetica-Bold")
    .fillColor("#ffffff");

  let colX = 55;
  doc.text("DATA", colX, tableTop + 6, { width: colWidths.data });
  colX += colWidths.data;
  doc.text("DESCRIÇÃO", colX, tableTop + 6, { width: colWidths.descricao });
  colX += colWidths.descricao;
  doc.text("TIPO", colX, tableTop + 6, { width: colWidths.tipo });
  colX += colWidths.tipo;
  doc.text("VALOR", colX, tableTop + 6, { width: colWidths.valor, align: "right" });
  colX += colWidths.valor;
  doc.text("STATUS", colX, tableTop + 6, { width: colWidths.status });

  let rowY = tableTop + 25;

  // Linhas da tabela
  transacoes.forEach((t, i) => {
    // Nova página se necessário
    if (rowY > doc.page.height - 80) {
      doc.addPage();
      rowY = 50;

      // Repetir header na nova página
      doc.rect(50, rowY, pageWidth, 20).fill("#1a1a2e");
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff");
      let hx = 55;
      doc.text("DATA", hx, rowY + 6, { width: colWidths.data });
      hx += colWidths.data;
      doc.text("DESCRIÇÃO", hx, rowY + 6, { width: colWidths.descricao });
      hx += colWidths.descricao;
      doc.text("TIPO", hx, rowY + 6, { width: colWidths.tipo });
      hx += colWidths.tipo;
      doc.text("VALOR", hx, rowY + 6, { width: colWidths.valor, align: "right" });
      hx += colWidths.valor;
      doc.text("STATUS", hx, rowY + 6, { width: colWidths.status });
      rowY += 25;
    }

    // Zebra stripes
    if (i % 2 === 0) {
      doc.rect(50, rowY - 3, pageWidth, 18).fill("#f8f9fa");
    }

    doc.fontSize(8).font("Helvetica").fillColor("#333");

    colX = 55;
    doc.text(t.data || "-", colX, rowY, { width: colWidths.data });
    colX += colWidths.data;

    // Truncar descrição se muito longa
    const desc =
      t.descricao.length > 40
        ? t.descricao.substring(0, 37) + "..."
        : t.descricao;
    doc.text(desc, colX, rowY, { width: colWidths.descricao });
    colX += colWidths.descricao;

    // Tipo com cor
    const tipoCor = t.tipo === "entrada" ? "#2e7d32" : "#c62828";
    const tipoLabel = t.tipo === "entrada" ? "Entrada" : "Saída";
    doc.fillColor(tipoCor).text(tipoLabel, colX, rowY, { width: colWidths.tipo });
    colX += colWidths.tipo;

    // Valor
    doc
      .fillColor(tipoCor)
      .text(formatarMoeda(t.valor), colX, rowY, {
        width: colWidths.valor,
        align: "right",
      });
    colX += colWidths.valor;

    // Status
    doc
      .fillColor("#555")
      .text(t.status || "-", colX, rowY, { width: colWidths.status });

    rowY += 18;
  });

  // ─── Rodapé ───
  doc.moveDown(2);
  doc
    .strokeColor("#e0e0e0")
    .lineWidth(0.5)
    .moveTo(50, doc.y)
    .lineTo(50 + pageWidth, doc.y)
    .stroke();

  doc.moveDown(0.5);
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#999")
    .text(
      "Relatório gerado automaticamente a partir dos dados da Iugo. " +
        "Este documento é para uso interno do time financeiro.",
      { align: "center" }
    );

  doc.end();

  return new Promise<void>((resolve) => {
    stream.on("finish", () => {
      console.log(`\n✅ PDF gerado com sucesso: ${path.resolve(outputPath)}`);
      console.log(`   📊 ${transacoes.length} transações processadas`);
      console.log(`   💰 Saldo: ${formatarMoeda(resumo.saldo)}`);
      resolve();
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🏦 Gerador de Relatório Financeiro - Iugo\n");

  const { csvFile, separador, saida } = parseArgs();

  console.log(`📂 Lendo arquivo: ${csvFile}`);
  console.log(`📐 Separador: "${separador}"`);
  console.log(`📄 Saída: ${saida}\n`);

  const records = lerCSV(csvFile, separador);
  const transacoes = mapearTransacoes(records);

  if (transacoes.length === 0) {
    console.error("❌ Nenhuma transação válida encontrada no CSV.");
    console.error(
      "   Verifique se o arquivo contém colunas de valor e data."
    );
    process.exit(1);
  }

  const resumo = calcularResumo(transacoes);

  console.log(`\n📊 Resumo:`);
  console.log(`   Entradas: ${formatarMoeda(resumo.totalEntradas)} (${resumo.quantidadeEntradas})`);
  console.log(`   Saídas:   ${formatarMoeda(resumo.totalSaidas)} (${resumo.quantidadeSaidas})`);
  console.log(`   Saldo:    ${formatarMoeda(resumo.saldo)}`);

  await gerarPDF(transacoes, resumo, saida);
}

main().catch((err) => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
