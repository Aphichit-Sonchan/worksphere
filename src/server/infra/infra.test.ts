import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseServerEnv } from "@/server/env";
import { MemoryCacheAdapter } from "@/server/infra/cache";
import { LocalDiskStorageAdapter } from "@/server/infra/storage";

describe("parseServerEnv", () => {
  it("applies safe defaults in development", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.REALTIME_PORT).toBe(3001);
    expect(env.STORAGE_DRIVER).toBe("local");
  });

  it("enforces DATABASE_URL and custom AUTH_SECRET in production", () => {
    expect(() => parseServerEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://u:p@host/db",
      }),
    ).toThrow(/AUTH_SECRET/);
  });
});

describe("MemoryCacheAdapter", () => {
  it("stores, reads, invalidates by prefix, and expires keys", async () => {
    const cache = new MemoryCacheAdapter();
    await cache.set("proj:1:meta", { name: "Alpha" }, 60);
    await cache.set("proj:1:stats", { open: 3 }, 60);
    await cache.set("proj:2:meta", { name: "Beta" }, 60);

    expect(await cache.get<{ name: string }>("proj:1:meta")).toEqual({ name: "Alpha" });

    await cache.delByPrefix("proj:1:");
    expect(await cache.get("proj:1:meta")).toBeNull();
    expect(await cache.get("proj:1:stats")).toBeNull();
    expect(await cache.get("proj:2:meta")).toEqual({ name: "Beta" });

    await cache.set("short", "v", -1);
    expect(await cache.get("short")).toBeNull();
  });
});

describe("LocalDiskStorageAdapter", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes, reads, deletes files and blocks path traversal", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-storage-"));
    const storage = new LocalDiskStorageAdapter(tmpDir);

    const payload = Buffer.from("hello worksphere");
    const saved = await storage.put("org_1/task_1/note.txt", payload, "text/plain");
    expect(saved.sizeBytes).toBe(payload.byteLength);

    const readBack = await storage.read("org_1/task_1/note.txt");
    expect(readBack.toString("utf8")).toBe("hello worksphere");

    await storage.remove("org_1/task_1/note.txt");
    await expect(storage.read("org_1/task_1/note.txt")).rejects.toThrow();

    await expect(storage.put("../../escape.txt", payload, "text/plain")).rejects.toThrow(
      /Invalid storage key path/,
    );
  });
});
