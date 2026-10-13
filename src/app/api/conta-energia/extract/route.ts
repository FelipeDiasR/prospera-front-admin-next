import { NextRequest, NextResponse } from "next/server";

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const EXTRACTION_PROMPT = `Analise esta imagem de uma conta de energia elétrica (fatura) e extraia os seguintes dados em formato JSON:

{
  "distribuidora": "nome da distribuidora/companhia de energia (ex: Enel, Equatorial, Coelce, etc.)",
  "nomeTitular": "nome completo do titular da conta",
  "cpfCnpj": "CPF ou CNPJ do titular (somente números, sem pontuação)",
  "numeroUC": "número da Unidade Consumidora (UC)",
  "numeroCliente": "número do cliente",
  "endereco": {
    "rua": "nome da rua/logradouro",
    "numero": "número do endereço",
    "bairro": "nome do bairro",
    "complemento": "complemento (apartamento, bloco, etc.) ou null se não houver",
    "cep": "CEP somente números (8 dígitos)",
    "cidade": "nome da cidade",
    "estado": "sigla do estado (2 letras)"
  },
  "valorMedio": "valor médio da conta como número decimal (usar ponto). Calcule a média se houver histórico de consumo/valores dos últimos meses visível na fatura. Se não houver histórico, use o valor total da fatura atual.",
  "valorFaturaAtual": "valor total da fatura atual como número decimal (usar ponto)",
  "mesReferencia": "mês de referência no formato MM/YYYY",
  "consumoKwh": "consumo em kWh do mês como número inteiro"
}

Regras:
- Retorne APENAS o JSON, sem markdown, sem explicações
- Todos os valores numéricos devem usar ponto como separador decimal
- O CPF deve conter 11 dígitos, o CNPJ deve conter 14 dígitos (somente números)
- O CEP deve conter 8 dígitos (somente números)
- Para o "valorMedio": se a fatura mostrar um histórico de consumo/valores dos últimos meses (geralmente em um gráfico de barras ou tabela), calcule a média dos valores apresentados. Se não houver histórico visível, use o valor da fatura atual.
- O número da UC (Unidade Consumidora) geralmente aparece em destaque na fatura
- O número do cliente pode ser diferente do número da UC
- Se algum campo não for legível ou não existir na fatura, use null
- IMPORTANTE: O CPF/CNPJ pode estar parcialmente mascarado (com asteriscos). Nesse caso, retorne o que for possível ler, preenchendo com asteriscos onde estiver oculto.`;

interface ContaEnergiaResult {
  distribuidora: string | null;
  nomeTitular: string | null;
  cpfCnpj: string | null;
  numeroUC: string | null;
  numeroCliente: string | null;
  endereco: {
    rua: string | null;
    numero: string | null;
    bairro: string | null;
    complemento: string | null;
    cep: string | null;
    cidade: string | null;
    estado: string | null;
  } | null;
  valorMedio: number | null;
  valorFaturaAtual: number | null;
  mesReferencia: string | null;
  consumoKwh: number | null;
  provider: string;
}

function parseJsonResponse(text: string): Omit<ContaEnergiaResult, "provider"> {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  const endereco = parsed.endereco
    ? {
        rua: parsed.endereco.rua || null,
        numero: parsed.endereco.numero || null,
        bairro: parsed.endereco.bairro || null,
        complemento: parsed.endereco.complemento || null,
        cep: parsed.endereco.cep ? String(parsed.endereco.cep).replace(/\D/g, "") : null,
        cidade: parsed.endereco.cidade || null,
        estado: parsed.endereco.estado || null,
      }
    : null;

  const valorMedio = parsed.valorMedio != null ? Number(parsed.valorMedio) : null;
  const valorFaturaAtual = parsed.valorFaturaAtual != null ? Number(parsed.valorFaturaAtual) : null;
  const consumoKwh = parsed.consumoKwh != null ? Number(parsed.consumoKwh) : null;

  return {
    distribuidora: parsed.distribuidora || null,
    nomeTitular: parsed.nomeTitular || null,
    cpfCnpj: parsed.cpfCnpj ? String(parsed.cpfCnpj) : null,
    numeroUC: parsed.numeroUC ? String(parsed.numeroUC) : null,
    numeroCliente: parsed.numeroCliente ? String(parsed.numeroCliente) : null,
    endereco,
    valorMedio: Number.isFinite(valorMedio) ? valorMedio : null,
    valorFaturaAtual: Number.isFinite(valorFaturaAtual) ? valorFaturaAtual : null,
    mesReferencia: parsed.mesReferencia || null,
    consumoKwh: Number.isFinite(consumoKwh) ? consumoKwh : null,
  };
}

async function extractWithClaude(
  base64: string,
  mediaType: string
): Promise<Omit<ContaEnergiaResult, "provider">> {
  const isPdf = mediaType === "application/pdf";
  const contentBlock = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      }
    : {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [contentBlock, { type: "text", text: EXTRACTION_PROMPT }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  return parseJsonResponse(text);
}

async function extractWithGemini(
  base64: string,
  mediaType: string
): Promise<Omit<ContaEnergiaResult, "provider">> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseJsonResponse(text);
}

async function extractWithOpenAI(
  base64: string,
  mediaType: string
): Promise<Omit<ContaEnergiaResult, "provider">> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mediaType};base64,${base64}` },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  return parseJsonResponse(text);
}

/**
 * POST /api/conta-energia/extract
 *
 * Aceita FormData com campo "file" (imagem ou PDF de uma conta de energia)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Campo 'file' é obrigatório." },
        { status: 400 }
      );
    }

    console.log(`[Conta Energia API] Recebido arquivo: ${file.name}, tipo: ${file.type}, tamanho: ${(file.size / 1024).toFixed(1)}KB`);
    console.log(`[Conta Energia API] Keys configuradas — Claude: ${!!CLAUDE_API_KEY}, Gemini: ${!!GEMINI_API_KEY}, OpenAI: ${!!OPENAI_API_KEY}`);

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Arquivo muito grande. Limite: 10MB." },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let mediaType = file.type || "image/jpeg";
    if (file.name?.toLowerCase().endsWith(".pdf")) {
      mediaType = "application/pdf";
    }

    console.log(`[Conta Energia API] mediaType resolvido: ${mediaType}`);

    // PDF: envia direto para as APIs que suportam PDF nativo
    if (mediaType === "application/pdf") {
      const base64Pdf = buffer.toString("base64");

      // Claude suporta PDF nativo
      if (CLAUDE_API_KEY) {
        console.log("[Conta Energia API] Tentando Claude (PDF)...");
        try {
          const result = await extractWithClaude(base64Pdf, "application/pdf");
          console.log(`[Conta Energia API] Claude (PDF) respondeu — nomeTitular: ${result.nomeTitular}, numeroUC: ${result.numeroUC}`);
          if (result.nomeTitular || result.numeroUC) {
            console.log("[Conta Energia API] ✅ Usando resultado do Claude (PDF)");
            return NextResponse.json({ ...result, provider: "Claude (PDF)" });
          }
          console.log("[Conta Energia API] ⚠️ Claude (PDF) retornou dados insuficientes, tentando próximo...");
        } catch (err) {
          console.warn("[Conta Energia API] ❌ Claude (PDF) falhou:", (err as Error).message);
        }
      } else {
        console.log("[Conta Energia API] ⏭️ Claude pulado (sem API key)");
      }

      // Gemini suporta PDF como inline_data
      if (GEMINI_API_KEY) {
        console.log("[Conta Energia API] Tentando Gemini (PDF)...");
        try {
          const result = await extractWithGemini(base64Pdf, "application/pdf");
          console.log(`[Conta Energia API] Gemini (PDF) respondeu — nomeTitular: ${result.nomeTitular}, numeroUC: ${result.numeroUC}`);
          if (result.nomeTitular || result.numeroUC) {
            console.log("[Conta Energia API] ✅ Usando resultado do Gemini (PDF)");
            return NextResponse.json({ ...result, provider: "Gemini (PDF)" });
          }
          console.log("[Conta Energia API] ⚠️ Gemini (PDF) retornou dados insuficientes");
        } catch (err) {
          console.warn("[Conta Energia API] ❌ Gemini (PDF) falhou:", (err as Error).message);
        }
      } else {
        console.log("[Conta Energia API] ⏭️ Gemini pulado (sem API key)");
      }

      return NextResponse.json(
        { error: "Não foi possível extrair dados do PDF. Tente enviar como imagem (foto/screenshot)." },
        { status: 502 }
      );
    }

    // Imagem: fluxo com visão
    const base64 = buffer.toString("base64");

    if (CLAUDE_API_KEY) {
      console.log("[Conta Energia API] Tentando Claude (imagem)...");
      try {
        const result = await extractWithClaude(base64, mediaType);
        console.log(`[Conta Energia API] Claude respondeu — nomeTitular: ${result.nomeTitular}, numeroUC: ${result.numeroUC}`);
        if (result.nomeTitular || result.numeroUC) {
          console.log("[Conta Energia API] ✅ Usando resultado do Claude");
          return NextResponse.json({ ...result, provider: "Claude" });
        }
        console.log("[Conta Energia API] ⚠️ Claude retornou dados insuficientes, tentando próximo...");
      } catch (err) {
        console.warn("[Conta Energia API] ❌ Claude (imagem) falhou:", (err as Error).message);
      }
    } else {
      console.log("[Conta Energia API] ⏭️ Claude pulado (sem API key)");
    }

    if (GEMINI_API_KEY) {
      console.log("[Conta Energia API] Tentando Gemini (imagem)...");
      try {
        const result = await extractWithGemini(base64, mediaType);
        console.log(`[Conta Energia API] Gemini respondeu — nomeTitular: ${result.nomeTitular}, numeroUC: ${result.numeroUC}`);
        if (result.nomeTitular || result.numeroUC) {
          console.log("[Conta Energia API] ✅ Usando resultado do Gemini");
          return NextResponse.json({ ...result, provider: "Gemini" });
        }
        console.log("[Conta Energia API] ⚠️ Gemini retornou dados insuficientes, tentando próximo...");
      } catch (err) {
        console.warn("[Conta Energia API] ❌ Gemini (imagem) falhou:", (err as Error).message);
      }
    } else {
      console.log("[Conta Energia API] ⏭️ Gemini pulado (sem API key)");
    }

    if (OPENAI_API_KEY) {
      console.log("[Conta Energia API] Tentando OpenAI (imagem)...");
      try {
        const result = await extractWithOpenAI(base64, mediaType);
        console.log(`[Conta Energia API] OpenAI respondeu — nomeTitular: ${result.nomeTitular}, numeroUC: ${result.numeroUC}`);
        console.log("[Conta Energia API] ✅ Usando resultado do OpenAI (último fallback)");
        return NextResponse.json({ ...result, provider: "OpenAI GPT" });
      } catch (err) {
        console.error("[Conta Energia API] ❌ OpenAI falhou:", (err as Error).message);
        return NextResponse.json(
          { error: `Falha na extração: ${(err as Error).message}` },
          { status: 502 }
        );
      }
    } else {
      console.log("[Conta Energia API] ⏭️ OpenAI pulado (sem API key)");
    }

    return NextResponse.json(
      { error: "Nenhuma API key configurada no servidor." },
      { status: 500 }
    );
  } catch (err) {
    console.error("[Conta Energia API] Erro inesperado:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 }
    );
  }
}
