import { getEnv } from "@/server/env";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "./crypto";

export const ACCESS_COOKIE_NAME = "ws_access";
export const REFRESH_COOKIE_NAME = "ws_refresh";

function serializeCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  const secure = getEnv().NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function buildAuthSetCookies(tokens: {
  accessToken: string;
  refreshToken: string;
}): string[] {
  return [
    serializeCookie(ACCESS_COOKIE_NAME, tokens.accessToken, ACCESS_TOKEN_TTL_SECONDS),
    serializeCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, REFRESH_TOKEN_TTL_SECONDS),
  ];
}

export function buildClearAuthCookies(): string[] {
  return [
    serializeCookie(ACCESS_COOKIE_NAME, "", 0),
    serializeCookie(REFRESH_COOKIE_NAME, "", 0),
  ];
}

export function parseCookiesHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

export function extractAccessToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookiesHeader(request.headers.get("cookie"));
  return cookies[ACCESS_COOKIE_NAME] ?? null;
}

export function extractRefreshToken(request: Request): string | null {
  const cookies = parseCookiesHeader(request.headers.get("cookie"));
  return cookies[REFRESH_COOKIE_NAME] ?? null;
}

export function appendSetCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers);
  for (const c of cookies) {
    headers.append("Set-Cookie", c);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
