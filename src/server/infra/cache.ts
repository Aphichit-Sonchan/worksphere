import { getRedis } from "./redis";

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
}

/** มาตรฐานชื่อ Cache Key และอายุ TTL ตาม docs/architecture.md §3.4 (WS-603) */
export const CacheKeys = {
  orgMembers: (orgId: string) => `org:${orgId}:members`,
  orgDashboard: (orgId: string, userId: string) => `org:${orgId}:dashboard:${userId}`,
  projectMeta: (projectId: string) => `proj:${projectId}:meta`,
  projectStats: (projectId: string) => `proj:${projectId}:stats`,
} as const;

export const CACHE_TTL = {
  ORG_MEMBERS: 300, // 5 นาที
  PROJECT_META: 600, // 10 นาที
  DASHBOARD: 120, // 2 นาที
} as const;

export class MemoryCacheAdapter implements CacheAdapter {
  private readonly store = new Map<string, { raw: string; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() >= hit.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return JSON.parse(hit.raw) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      raw: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clearAll() {
    this.store.clear();
  }
}

export class RedisCacheAdapter implements CacheAdapter {
  async get<T>(key: string): Promise<T | null> {
    const client = getRedis();
    if (!client) return null;
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const client = getRedis();
    if (!client) return;
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async del(key: string): Promise<void> {
    const client = getRedis();
    if (!client) return;
    await client.del(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    const client = getRedis();
    if (!client) return;
    let cursor = "0";
    do {
      const [next, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) await client.del(...keys);
    } while (cursor !== "0");
  }
}

export const memoryFallbackCache = new MemoryCacheAdapter();
const redisCache = new RedisCacheAdapter();

export const cache: CacheAdapter = {
  get: (key) => (getRedis() ? redisCache.get(key) : memoryFallbackCache.get(key)),
  set: (key, value, ttl) =>
    getRedis() ? redisCache.set(key, value, ttl) : memoryFallbackCache.set(key, value, ttl),
  del: (key) => (getRedis() ? redisCache.del(key) : memoryFallbackCache.del(key)),
  delByPrefix: (prefix) =>
    getRedis()
      ? redisCache.delByPrefix(prefix)
      : memoryFallbackCache.delByPrefix(prefix),
};

/**
 * Read-through Cache Helper: คืนค่าจาก Cache หากมี มิฉะนั้นโหลดจาก `loader` แล้วบันทึกพร้อม TTL
 */
export async function rememberCached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  adapter: CacheAdapter = cache,
): Promise<T> {
  const cached = await adapter.get<T>(key);
  if (cached !== null) {
    return cached;
  }
  const fresh = await loader();
  await adapter.set(key, fresh, ttlSeconds);
  return fresh;
}
