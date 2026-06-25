import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "";

/**
 * Proxy genérico — repassa todas as requests para o backend real.
 * O client chama /api/proxy/user/auth e o servidor repassa para https://soulprime.info/user/auth
 * 
 * Isso esconde a URL do backend do browser, impedindo que qualquer um
 * descubra o endereço real da API inspecionando o código.
 */
async function proxyRequest(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const targetPath = "/" + path.join("/");
  
  // Rebuild URL with query params
  const url = new URL(request.url);
  const queryString = url.search;
  const targetUrl = `${BACKEND_URL}${targetPath}${queryString}`;

  // Forward headers (except host-related ones)
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!["host", "connection", "content-length"].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  // Get body for non-GET requests
  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = JSON.stringify(await request.json());
    } else {
      body = await request.arrayBuffer();
    }
  }

  try {
    const backendResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    // Forward backend response
    const responseBody = await backendResponse.arrayBuffer();
    const responseHeaders = new Headers();
    backendResponse.headers.forEach((value, key) => {
      // Skip headers that Next.js handles
      if (!["transfer-encoding", "connection", "keep-alive"].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    return new NextResponse(responseBody, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[Proxy] Error:", err);
    return NextResponse.json(
      { error: "Erro ao conectar com o servidor." },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
