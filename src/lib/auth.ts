"use client";

import { apiGet, apiPost } from "./api";
import { getSessionUserInfo, SessionUserInfo, setSessionUserInfo } from "./session";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: string;
  accessToken: string;
  refreshToken: { id: string; user_id: string };
}

export async function loginUser(credentials: LoginRequest) {
  const data = await apiPost<LoginResponse>("/user/auth", credentials);

  // Store session — same structure as the original project
  setSessionUserInfo({
    email: data.user,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken.id,
    id: data.refreshToken.user_id,
  });

  // Fetch user info (now we have a valid token)
  try {
    const userInfo = await apiGet<Record<string, unknown>>("/user/info");
    // Merge user info without overwriting auth tokens
    const currentSession = getSessionUserInfo();
    setSessionUserInfo({
      ...currentSession,
      ...(userInfo as Partial<SessionUserInfo>),
      // Keep auth tokens from the login response
      accessToken: currentSession?.accessToken || data.accessToken,
      refreshToken: currentSession?.refreshToken || data.refreshToken.id,
      id: currentSession?.id || data.refreshToken.user_id,
    });
    return userInfo;
  } catch {
    // If user info fails, session is still valid with basic data
    return getSessionUserInfo();
  }
}

export function isAuthenticated(): boolean {
  const info = getSessionUserInfo();
  return !!info?.accessToken;
}

export function isAdmin(): boolean {
  const info = getSessionUserInfo();
  const adminRole = process.env.NEXT_PUBLIC_ROLE_ADM || "";
  return info?.role === adminRole;
}

export function getUserInfo() {
  return getSessionUserInfo();
}
