import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(rootDir, ".env") });

export default defineConfig({
  schema: path.resolve(rootDir, "prisma/schema.prisma"),
  migrations: {
    path: path.resolve(rootDir, "prisma/migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
