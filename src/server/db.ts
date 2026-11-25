import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";
import { logger } from "@/server/infra/logger";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * ปรับแต่ง PostgreSQL URL สำหรับไดรเวอร์ `pg` v8+:
 * ระบุ `sslmode=verify-full` อย่างชัดเจนเมื่อใช้ `sslmode=require` เพื่อไม่ให้เกิด Security Warning บน Node.js
 */
function normalizePgConnectionString(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const sslMode = parsed.searchParams.get("sslmode");
    if (sslMode === "require" && !parsed.searchParams.has("uselibpqcompat")) {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function createPrismaClient(): PrismaClient {
  const { DATABASE_URL } = getEnv();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured — copy .env.example to .env");
  }

  const connectionString = normalizePgConnectionString(DATABASE_URL);

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
    }),
    // รองรับ Cloud Postgres ข้ามภูมิภาค (เช่น Neon US-East) ไม่ให้เกิด P2028 Transaction Timeout (ค่าเริ่มต้นเดิม 5000ms)
    transactionOptions: {
      maxWait: 15_000,
      timeout: 30_000,
    },
  });
}

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

/** Lazy proxy เพื่อให้ import `db` ได้โดยไม่พังตอน build/test ที่ยังไม่ได้ต่อ DB จริง */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export interface AtomicStep<TContext> {
  name: string;
  execute: (ctx: TContext) => Promise<void>;
  compensate: (ctx: TContext) => Promise<void>;
}

/**
 * รันชุดคำสั่งภายใต้ Prisma Interactive Transaction (`BEGIN ... COMMIT / ROLLBACK`)
 */
export async function runDbTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  client: Pick<PrismaClient, "$transaction"> = getDb(),
): Promise<T> {
  return client.$transaction((tx) => work(tx));
}

/**
 * รันชุดงานหลายขั้นตอนแบบ All-or-Nothing พร้อม Rollback ย้อนลำดับ (LIFO) เมื่อเกิดข้อผิดพลาดกลางคัน (WS-602)
 */
export async function runAtomicUnitOfWork<TContext>(
  context: TContext,
  steps: ReadonlyArray<AtomicStep<TContext>>,
): Promise<TContext> {
  const completed: AtomicStep<TContext>[] = [];
  try {
    for (const step of steps) {
      await step.execute(context);
      completed.push(step);
    }
    return context;
  } catch (err) {
    for (let i = completed.length - 1; i >= 0; i -= 1) {
      await completed[i]!.compensate(context);
    }
    throw err;
  }
}

export async function checkDatabaseHealth(): Promise<{
  status: "ok" | "unconfigured" | "error";
  latencyMs?: number;
}> {
  if (!getEnv().DATABASE_URL) {
    return { status: "unconfigured" };
  }
  const start = performance.now();
  try {
    await getDb().$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    logger.error("database health check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "error", latencyMs: Math.round(performance.now() - start) };
  }
}
