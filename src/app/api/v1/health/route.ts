import { checkDatabaseHealth } from "@/server/db";
import { getEnv } from "@/server/env";
import { ok, route } from "@/server/http/route";
import { checkRedisHealth } from "@/server/infra/redis";

/**
 * GET /api/v1/health — ตรวจสถานะระบบ
 * ?deep=1 ตรวจการเชื่อมต่อ PostgreSQL, Redis และโหมดของ Storage/Mailer
 */
export const GET = route(async (request: Request) => {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  const base = {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  if (!deep) {
    return ok({ status: "ok", ...base });
  }

  const env = getEnv();
  const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

  const hasError = database.status === "error" || redis.status === "error";
  const status = hasError ? "degraded" : "ok";

  return ok(
    {
      status,
      ...base,
      services: {
        database,
        redis,
        storage: { driver: env.STORAGE_DRIVER, status: "ok" as const },
        mail: { driver: env.MAIL_DRIVER, status: "ok" as const },
      },
    },
    { status: hasError ? 503 : 200 },
  );
});
