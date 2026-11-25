import Redis from "ioredis";
import { getEnv } from "@/server/env";
import { logger } from "./logger";

const globalForRedis = globalThis as unknown as { redis?: Redis | null };

export function getRedis(): Redis | null {
  if (globalForRedis.redis !== undefined) return globalForRedis.redis;

  const { REDIS_URL } = getEnv();
  if (!REDIS_URL) {
    globalForRedis.redis = null;
    return null;
  }

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // รองรับ BullMQ
    lazyConnect: true,
    enableReadyCheck: true,
  });

  client.on("error", (err) => {
    logger.warn("redis connection error", { message: err.message });
  });

  globalForRedis.redis = client;
  return client;
}

export async function checkRedisHealth(): Promise<{
  status: "ok" | "unconfigured" | "error";
  latencyMs?: number;
}> {
  const client = getRedis();
  if (!client) return { status: "unconfigured" };

  const start = performance.now();
  try {
    if (client.status === "wait") await client.connect();
    const pong = await client.ping();
    return {
      status: pong === "PONG" ? "ok" : "error",
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    logger.error("redis health check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "error", latencyMs: Math.round(performance.now() - start) };
  }
}
