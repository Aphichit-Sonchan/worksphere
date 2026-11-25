import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  APP_URL: z.url().default("http://localhost:3000"),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().optional().default(""),
  AUTH_SECRET: z
    .string()
    .min(16, "AUTH_SECRET must be at least 16 characters")
    .default("dev-only-secret-change-in-production-32chars"),
  REDIS_URL: z.string().optional().default(""),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().min(1).default(".local-storage"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default("worksphere-attachments"),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  MAIL_DRIVER: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().default("noreply@worksphere.local"),
});

export type ServerEnv = z.infer<typeof envSchema>;

export function parseServerEnv(raw: NodeJS.ProcessEnv): ServerEnv {
  const inferredVercelUrl =
    raw.VERCEL_PROJECT_PRODUCTION_URL || raw.VERCEL_URL
      ? `https://${raw.VERCEL_PROJECT_PRODUCTION_URL || raw.VERCEL_URL}`
      : undefined;

  const parsed = envSchema.parse({
    ...raw,
    APP_URL: raw.APP_URL || inferredVercelUrl,
  });

  if (parsed.NODE_ENV === "production") {
    if (!parsed.DATABASE_URL) {
      throw new Error("DATABASE_URL is required in production");
    }
    if (
      parsed.AUTH_SECRET === "dev-only-secret-change-in-production-32chars" ||
      parsed.AUTH_SECRET.length < 32
    ) {
      throw new Error("AUTH_SECRET must be a custom secret of at least 32 chars in production");
    }
  }

  return parsed;
}

let cachedEnv: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = parseServerEnv(process.env);
  }
  return cachedEnv;
}
