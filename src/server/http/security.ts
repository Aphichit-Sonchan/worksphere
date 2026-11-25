import { getEnv } from "@/server/env";
import { forbidden } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * ตรวจ Origin สำหรับคำขอที่เปลี่ยนแปลงข้อมูลเมื่อส่งมาจากเบราว์เซอร์ (CSRF Defense)
 */
export function assertTrustedOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const origin = request.headers.get("origin");
  if (!origin) return; // Non-browser clients หรือ same-origin ที่ไม่ได้ส่ง Origin

  const allowedOrigins = new Set<string>();
  try {
    allowedOrigins.add(new URL(getEnv().APP_URL).origin);
  } catch {
    // ignore malformed env fallback
  }
  try {
    allowedOrigins.add(new URL(request.url).origin);
  } catch {
    // ignore
  }

  if (!allowedOrigins.has(origin)) {
    throw forbidden("Untrusted request origin");
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
