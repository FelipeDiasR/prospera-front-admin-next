import { NextRequest, NextResponse } from "next/server";

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const EXTRACTION_PROMPT = `Analise esta imagem de uma Nota Fiscal de Consumidor Eletrônica (NFC-e) e extraia os seguintes dados em formato JSON:

{
  "cnpj": "somente números, sem pontuação",
  "establishmentName": "nome/razão social do estabelecimento",
  "issuedDate": "YYYY-MM-DD",
  "issuedTime": "HH:mm:ss",
  "totalAmount": "valor final pago na nota fiscal como número decimal (usar ponto)",
  "items": [
    {
      "description": "descrição do produto",
      "quantity": "quantidade como número decimal (usar ponto)",
      "unitValue": "valor unitário como número decimal (usar ponto)",
      "totalItemValue": "valor total do item como número decimal (usar ponto)"
    }
  ]
}

Regras:
- Retorne APENAS o JSON, sem markdown, sem explicações
- Todos os valores numéricos devem usar ponto como separador decimal
- O CNPJ deve conter apenas dígitos (14 números)
- A data deve estar no formato YYYY-MM-DD
- A hora deve estar no formato HH:mm:ss (24h)
- Extraia TODOS os itens da nota fiscal
- IMPORTANTE para o campo "totalAmount": Use o VALOR EFETIVAMENTE PAGO pelo consumidor. Priorize nesta ordem:
  1. "Valor a pagar R$" (valor final após descontos)
  2. "Valor pago R$" na forma de pagamento
  3. "Valor Total R$" (somente se não houver descontos)
  A nota pode ter descontos que reduzem o valor total. O "totalAmount" deve SEMPRE refletir o que foi pago, não o subtotal antes de descontos.
- Se algum campo não for legível, use null`;

const TEXT_EXTRACTION_PROMPT = `Analise o texto abaixo extraído de uma NFC-e (Nota Fiscal de Consumidor Eletrônica) e retorne os dados em formato JSON:

{
  "cnpj": "somente números, sem pontuação (14 dígitos)",
  "establishmentName": "nome/razão social do estabelecimento",
  "issuedDate": "YYYY-MM-DD",
  "issuedTime": "HH:mm:ss",
  "totalAmount": "valor final pago como número decimal (usar ponto)",
  "items": [
    {
      "description": "descrição do produto",
      "quantity": "quantidade como número decimal (usar ponto)",
      "unitValue": "valor unitário como número decimal (usar ponto)",
      "totalItemValue": "valor total do item como número decimal (usar ponto)"
    }
  ]
}

Regras:
- Retorne APENAS o JSON, sem markdown, sem explicações
- Todos os valores numéricos devem usar ponto como separador decimal
- O CNPJ deve conter apenas dígitos (14 números)
- A data deve estar no formato YYYY-MM-DD
- A hora deve estar no formato HH:mm:ss (24h)
- Extraia TODOS os itens listados
- Para "totalAmount": use o valor efetivamente pago (Valor a pagar > Valor pago > Valor Total)
- Se algum campo não for encontrado, use null
- Ignore linhas de cabeçalho, rodapé, tributos e informações de pagamento — foque nos itens

Texto da NFC-e:
`;

interface NfceItem {
  description: string;
  quantity: string;
  unitValue: string;
  totalItemValue: string;
}

interface NfceResult {
  cnpj: string | null;
  establishmentName: string | null;
  issuedDate: string | null;
  issuedTime: string | null;
  totalAmount: number | null;
  items: NfceItem[];
  provider: string;
}

function parseJsonResponse(text: string): Omit<NfceResult, "provider"> {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  const items: NfceItem[] = (parsed.items || []).map(
    (item: Record<string, unknown>) => ({
      description: String(item.description || "").trim(),
      quantity: String(item.quantity ?? ""),
      unitValue: String(item.unitValue ?? ""),
      totalItemValue: String(item.totalItemValue ?? ""),
    })
  );

  const totalAmount =
    parsed.totalAmount != null ? Number(parsed.totalAmount) : null;

  return {
    cnpj: parsed.cnpj ? String(parsed.cnpj).replace(/\D/g, "") : null,
    establishmentName: parsed.establishmentName || null,
    issuedDate: parsed.issuedDate || null,
    issuedTime: parsed.issuedTime || null,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : null,
    items,
  };
}


async function extractWithClaude(
  base64: string,
  mediaType: string
): Promise<Omit<NfceResult, "provider">> {
  const isPdfFile = mediaType === "application/pdf";
  const contentBlock = isPdfFile
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
          content: [
            contentBlock,
            { type: "text", text: EXTRACTION_PROMPT },
          ],
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
): Promise<Omit<NfceResult, "provider">> {
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

async function extractTextWithClaude(
  nfceText: string
): Promise<Omit<NfceResult, "provider">> {
  const fullPrompt = TEXT_EXTRACTION_PROMPT + nfceText;

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
      messages: [{ role: "user", content: fullPrompt }],
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

async function extractTextWithGemini(
  nfceText: string
): Promise<Omit<NfceResult, "provider">> {
  const fullPrompt = TEXT_EXTRACTION_PROMPT + nfceText;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
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
): Promise<Omit<NfceResult, "provider">> {
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

async function extractTextWithOpenAI(
  nfceText: string
): Promise<Omit<NfceResult, "provider">> {
  const fullPrompt = TEXT_EXTRACTION_PROMPT + nfceText;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [{ role: "user", content: fullPrompt }],
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
 * POST /api/nfce/extract
 *
 * Aceita:
 * - FormData com campo "image" (arquivo de imagem ou PDF)
 * - JSON com campo "text" (texto colado da NFC-e)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Extração via texto
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { text } = body;

      if (!text || typeof text !== "string") {
        return NextResponse.json(
          { error: "Campo 'text' é obrigatório e deve ser uma string." },
          { status: 400 }
        );
      }

      // Tenta Claude primeiro
      if (CLAUDE_API_KEY) {
        try {
          const result = await extractTextWithClaude(text);
          if (result.items.length > 0) {
            return NextResponse.json({ ...result, provider: "Claude (texto)" });
          }
        } catch (err) {
          console.warn("[NFC-e API] Claude (texto) falhou:", (err as Error).message);
        }
      }

      // Fallback Gemini
      if (GEMINI_API_KEY) {
        try {
          const result = await extractTextWithGemini(text);
          if (result.items.length > 0) {
            return NextResponse.json({ ...result, provider: "Gemini (texto)" });
          }
          console.log("[NFC-e API] Gemini (texto) retornou 0 itens, tentando OpenAI...");
        } catch (err) {
          console.warn("[NFC-e API] Gemini (texto) falhou:", (err as Error).message);
        }
      }

      // Fallback OpenAI GPT
      if (OPENAI_API_KEY) {
        try {
          const result = await extractTextWithOpenAI(text);
          return NextResponse.json({ ...result, provider: "OpenAI GPT (texto)" });
        } catch (err) {
          console.error("[NFC-e API] OpenAI GPT (texto) falhou:", (err as Error).message);
          return NextResponse.json(
            { error: `Falha na extração: ${(err as Error).message}` },
            { status: 502 }
          );
        }
      }

      return NextResponse.json(
        { error: "Nenhuma API key configurada no servidor." },
        { status: 500 }
      );
    }

    // Extração via imagem (FormData)
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Campo 'image' é obrigatório no FormData." },
        { status: 400 }
      );
    }

    // Limite de 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Arquivo muito grande. Limite: 10MB." },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    let mediaType = file.type || "image/jpeg";
    if (file.name?.toLowerCase().endsWith(".pdf")) {
      mediaType = "application/pdf";
    }

    // Tenta Claude primeiro
    if (CLAUDE_API_KEY) {
      try {
        const result = await extractWithClaude(base64, mediaType);
        if (result.items.length > 0) {
          return NextResponse.json({ ...result, provider: "Claude" });
        }
        console.log("[NFC-e API] Claude retornou 0 itens, tentando Gemini...");
      } catch (err) {
        console.warn("[NFC-e API] Claude falhou:", (err as Error).message);
      }
    }

    // Fallback Gemini
    if (GEMINI_API_KEY) {
      try {
        const result = await extractWithGemini(base64, mediaType);
        if (result.items.length > 0) {
          return NextResponse.json({ ...result, provider: "Gemini" });
        }
        console.log("[NFC-e API] Gemini retornou 0 itens, tentando OpenAI GPT...");
      } catch (err) {
        console.warn("[NFC-e API] Gemini falhou:", (err as Error).message);
      }
    }

    // Fallback OpenAI GPT
    if (OPENAI_API_KEY) {
      try {
        const result = await extractWithOpenAI(base64, mediaType);
        return NextResponse.json({ ...result, provider: "OpenAI GPT" });
      } catch (err) {
        console.error("[NFC-e API] OpenAI GPT falhou:", (err as Error).message);
        return NextResponse.json(
          { error: `Falha na extração: ${(err as Error).message}` },
          { status: 502 }
        );
      }
    }

    return NextResponse.json(
      { error: "Nenhuma API key configurada no servidor." },
      { status: 500 }
    );
  } catch (err) {
    console.error("[NFC-e API] Erro inesperado:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 }
    );
  }
}
