import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { SystemRole } from "@/generated/prisma/enums";
import { getEnv } from "@/server/env";

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 นาที
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 วัน
export const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24 ชั่วโมง
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 ชั่วโมง

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;

/** ใช้ตรวจรหัสผ่านหลอกเมื่อไม่พบอีเมล เพื่อป้องกัน Timing Attack */
export async function verifyDummyPassword(plain: string): Promise<void> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("worksphere-dummy-timing-guard-password");
  }
  const dummy = await dummyHashPromise;
  await verifyPassword(dummy, plain);
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  sys: SystemRole;
  iat: number;
  exp: number;
}

export type VerifyAccessResult =
  | { ok: true; payload: AccessTokenPayload }
  | { ok: false; reason: "expired" | "invalid" };

function base64UrlEncodeJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function hmacSign(input: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(input, "utf8").digest("base64url");
}

export function signAccessToken(
  claims: { userId: string; sessionId: string; systemRole: SystemRole },
  options?: { ttlSeconds?: number; nowMs?: number; secret?: string },
): string {
  const nowSec = Math.floor((options?.nowMs ?? Date.now()) / 1000);
  const ttl = options?.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
  const secret = options?.secret ?? getEnv().AUTH_SECRET;

  const header = base64UrlEncodeJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlEncodeJson({
    sub: claims.userId,
    sid: claims.sessionId,
    sys: claims.systemRole,
    iat: nowSec,
    exp: nowSec + ttl,
  } satisfies AccessTokenPayload);

  const signingInput = `${header}.${payload}`;
  const signature = hmacSign(signingInput, secret);
  return `${signingInput}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  options?: { nowMs?: number; secret?: string },
): VerifyAccessResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const [headerB64, payloadB64, signature] = parts;
  if (!headerB64 || !payloadB64 || !signature) return { ok: false, reason: "invalid" };

  const secret = options?.secret ?? getEnv().AUTH_SECRET;
  const expectedSig = hmacSign(`${headerB64}.${payloadB64}`, secret);

  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as Partial<AccessTokenPayload>;

    if (
      typeof parsed.sub !== "string" ||
      typeof parsed.sid !== "string" ||
      (parsed.sys !== "SYSTEM_ADMIN" && parsed.sys !== "USER") ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return { ok: false, reason: "invalid" };
    }

    const nowSec = Math.floor((options?.nowMs ?? Date.now()) / 1000);
    if (parsed.exp <= nowSec) {
      return { ok: false, reason: "expired" };
    }

    return { ok: true, payload: parsed as AccessTokenPayload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
