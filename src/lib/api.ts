/**
 * API client — replicates the axios interceptor behavior from the original project.
 * Uses fetch instead of axios to reduce dependencies in Next.js.
 */

import { getSessionUserInfo, removeUserInfo, setSessionUserInfo } from "./session";

function getBaseUrl(): string {
  // All API calls go through our proxy at /api/proxy
  // This hides the real backend URL from the browser
  if (typeof window !== "undefined") {
    return "/api/proxy";
  }
  // Server-side can call the backend directly
  return process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "";
}

async function refreshAccessToken(refreshToken: string) {
  const baseUrl = typeof window !== "undefined" ? "/api/proxy" : (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "");
  const res = await fetch(`${baseUrl}/user/refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error("Falha ao atualizar token.");
  return res.json();
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp < Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
}

async function getValidToken(): Promise<string | null> {
  const info = getSessionUserInfo();
  if (!info?.accessToken) return null;

  if (!isTokenExpired(info.accessToken)) {
    return info.accessToken;
  }

  // Token expired — refresh
  try {
    const data = await refreshAccessToken(info.refreshToken);
    const newInfo = {
      ...info,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken?.id || data.refreshToken,
    };
    setSessionUserInfo(newInfo);
    return data.accessToken;
  } catch {
    removeUserInfo();
    return null;
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
}

export async function api<T = unknown>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, params } = options;

  const token = await getValidToken();

  let url = `${getBaseUrl()}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => searchParams.set(k, String(v)));
    url += `?${searchParams.toString()}`;
  }

  const fetchHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (token) {
    fetchHeaders["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle 403 — try refresh once
  if (res.status === 403) {
    const info = getSessionUserInfo();
    if (info?.refreshToken) {
      try {
        const data = await refreshAccessToken(info.refreshToken);
        setSessionUserInfo({
          ...info,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken?.id || data.refreshToken,
        });

        // Retry request
        fetchHeaders["Authorization"] = `Bearer ${data.accessToken}`;
        const retryRes = await fetch(url, {
          method,
          headers: fetchHeaders,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retryRes.ok) {
          const err = await retryRes.json().catch(() => ({}));
          throw { response: { data: err, status: retryRes.status } };
        }
        return retryRes.json();
      } catch {
        removeUserInfo();
        throw { response: { data: { error: "Sessão expirada." }, status: 403 } };
      }
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw { response: { data: err, status: res.status }, message: err?.error || "Erro inesperado." };
  }

  return res.json();
}

// Convenience methods
export function apiGet<T = unknown>(endpoint: string, params?: Record<string, string | number>) {
  return api<T>(endpoint, { method: "GET", params });
}

export function apiPost<T = unknown>(endpoint: string, body?: unknown) {
  return api<T>(endpoint, { method: "POST", body });
}

export function apiPut<T = unknown>(endpoint: string, body?: unknown) {
  return api<T>(endpoint, { method: "PUT", body });
}

export function apiDelete<T = unknown>(endpoint: string, body?: unknown) {
  return api<T>(endpoint, { method: "DELETE", body });
}
