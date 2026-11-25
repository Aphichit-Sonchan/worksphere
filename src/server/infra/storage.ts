import fs from "node:fs/promises";
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
    // S3-compatible driver จะขยายเพิ่มใน Phase 4 (WS-406) เมื่อเชื่อมไฟล์แนบจริง
    adapterInstance = new LocalDiskStorageAdapter(env.LOCAL_STORAGE_DIR);
  }
  return adapterInstance;
}
