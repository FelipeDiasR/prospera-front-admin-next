/**
 * Session management — client-side only.
 * Mirrors the original react-secure-storage approach but uses localStorage directly.
 * In production, consider encrypting or using httpOnly cookies.
 */

"use client";

export interface SessionUserInfo {
  accessToken: string;
  refreshToken: string;
  id: string;
  email: string;
  role?: string;
  nickname?: string;
  username?: string;
  bio?: string;
  imagem?: string;
  telephone?: string;
  cpf?: string;
  gender?: number;
  content_creator?: boolean;
  profession?: string;
  createdAt?: string;
  updatedAt?: string;
  wallet_id?: string;
  coin?: number;
}

const STORAGE_KEY = "prospera_user_session";

export function setSessionUserInfo(data: Partial<SessionUserInfo>) {
  if (typeof window === "undefined") return;
  const existing = getSessionUserInfo();
  const merged = { ...existing, ...data };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

export function getSessionUserInfo(): SessionUserInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function removeUserInfo() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
