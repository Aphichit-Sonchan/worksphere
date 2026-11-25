import { AppError } from "@/server/http/errors";
import { getRedis } from "./redis";

export interface RateLimitRule {
  /** ชื่อ bucket เช่น "auth:login" */
  bucket: string;
  /** จำนวนครั้งสูงสุดภายในหน้าต่างเวลา */
  limit: number;
  /** หน้าต่างเวลาเป็นวินาที */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class MemoryRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  check(key: string, limit: number, windowSeconds: number, now = Date.now()): RateLimitResult {
    const current = this.windows.get(key);
    if (!current || now >= current.resetAt) {
      const resetAt = now + windowSeconds * 1000;
      this.windows.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: windowSeconds,
      };
    }

    current.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return {
      allowed: current.count <= limit,
      remaining: Math.max(0, limit - current.count),
      retryAfterSeconds,
    };
  }

  resetAll() {
    this.windows.clear();
  }
}

export const memoryRateLimiter = new MemoryRateLimiter();

export async function checkRateLimit(
  identifier: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const fullKey = `rl:${rule.bucket}:${identifier}`;
  const redis = getRedis();

  if (!redis) {
    return memoryRateLimiter.check(fullKey, rule.limit, rule.windowSeconds);
  }

  const count = await redis.incr(fullKey);
  if (count === 1) {
    await redis.expire(fullKey, rule.windowSeconds);
  }
  const ttl = await redis.ttl(fullKey);
  const retryAfterSeconds = ttl > 0 ? ttl : rule.windowSeconds;

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds,
  };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

export async function enforceRateLimit(
  request: Request,
  rule: RateLimitRule,
  subjectSuffix?: string,
): Promise<void> {
  const ip = getClientIp(request);
  const id = subjectSuffix ? `${ip}:${subjectSuffix}` : ip;
  const result = await checkRateLimit(id, rule);

  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Too many requests, please try again later", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}
