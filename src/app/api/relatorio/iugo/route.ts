import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import path from "path";

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

function corrigirEncoding(texto: string): string {
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
  return resultado;
}

function parsearCSVIugo(conteudo: string): TransacaoIugo[] {
  let texto = corrigirEncoding(conteudo.trim());
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);

  const linhas = texto.split("\n");
  let headerLine = linhas[0];
  let dataLines: string[];

  if (linhas.length > 3) {
    dataLines = linhas.slice(1).filter((l) => l.trim());
  } else {
    const fullText = linhas.join("");
    const headerMatch = fullText.match(/^(.+?)(?=\d{4}-\d{2}-\d{2},)/);
    if (headerMatch) {
      headerLine = headerMatch[1].trim();
      const restante = fullText.slice(headerMatch[0].length);
      dataLines = restante
        .split(/(?=\d{4}-\d{2}-\d{2},)/)
        .filter((r) => r.trim());
    } else {
      return [];
    }
  }

  const headers = headerLine.split(",");
  const numColunas = headers.length;
  const transacoes: TransacaoIugo[] = [];

  for (const linha of dataLines) {
    if (!linha.trim()) continue;
    const campos = linha.split(",");
    if (campos.length < 6) continue;

    const data = campos[0]?.trim() || "";
    const saldoInicial = parseFloat(campos[1]) || 0;
    const valor = parseFloat(campos[2]) || 0;
    const saldoFinal = parseFloat(campos[3]) || 0;

    let historico = "", tipoMovimentacao = "", codigo = "";
    let referencia = "", email = "", nomeCliente = "";

    if (campos.length >= numColunas) {
      nomeCliente = campos[campos.length - 1]?.trim() || "";
      email = campos[campos.length - 2]?.trim() || "";
      referencia = campos[campos.length - 3]?.trim() || "";
      codigo = campos[campos.length - 4]?.trim() || "";
      tipoMovimentacao = campos[campos.length - 5]?.trim() || "";
      historico = campos.slice(4, campos.length - 5).join(",").trim();
    } else {
      historico = campos[4]?.trim() || "";
      tipoMovimentacao = campos[5]?.trim() || "";
      codigo = campos[6]?.trim() || "";
      referencia = campos[7]?.trim() || "";
      email = campos[8]?.trim() || "";
      nomeCliente = campos[9]?.trim() || "";
    }

    const tipo: "entrada" | "saida" = valor >= 0 ? "entrada" : "saida";
    transacoes.push({
      data, saldoInicial, valor: Math.abs(valor), saldoFinal,
      historico, tipoMovimentacao, codigo, referencia,
      email, nomeCliente, tipo,
    });
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

    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      return NextResponse.json(
        { error: "Formato inválido. Envie um arquivo .csv ou .txt" },
        { status: 400 }
      );
    }

    const conteudo = await file.text();
    if (!conteudo.trim()) {
      return NextResponse.json(
        { error: "Arquivo está vazio" },
        { status: 400 }
      );
    }

    const transacoes = parsearCSVIugo(conteudo);
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
