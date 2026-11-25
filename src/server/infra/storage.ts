import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getEnv } from "@/server/env";

export interface StoredObjectInfo {
  storageKey: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  put(storageKey: string, data: Buffer, mimeType: string): Promise<StoredObjectInfo>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

/** Local Disk Storage สำหรับโหมดพัฒนา ป้องกัน Path Traversal ทุกครั้ง */
export class LocalDiskStorageAdapter implements StorageAdapter {
  constructor(private readonly baseDir: string) {}

  private resolveSafePath(storageKey: string): string {
    const root = path.resolve(this.baseDir);
    const resolved = path.resolve(root, storageKey);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error("Invalid storage key path");
    }
    return resolved;
  }

  async put(storageKey: string, data: Buffer, mimeType = "application/octet-stream"): Promise<StoredObjectInfo> {
    void mimeType;
    const target = this.resolveSafePath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return { storageKey, sizeBytes: data.byteLength };
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolveSafePath(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await fs.rm(this.resolveSafePath(storageKey), { force: true });
  }
}

let adapterInstance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!adapterInstance) {
    const env = getEnv();
    // บน Vercel Serverless โฟลเดอร์โค้ด (/var/task) อ่านได้อย่างเดียว จึงต้องเขียนลง os.tmpdir() (/tmp) แทนเมื่อใช้โหมด local
    const writableDir =
      process.env.VERCEL && env.LOCAL_STORAGE_DIR === ".local-storage"
        ? path.join(os.tmpdir(), "worksphere-storage")
        : env.LOCAL_STORAGE_DIR;
    adapterInstance = new LocalDiskStorageAdapter(writableDir);
  }
  return adapterInstance;
}
