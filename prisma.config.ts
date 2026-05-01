import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Load env vars from .env.local first (dev), then fall back to .env.
// Done before defineConfig so DATABASE_URL is available.
loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    // Solo-mode default: SQLite file inside ./prisma so dev setups don't
    // need a Postgres server. Electron build sets this to an OS app-data
    // path before importing the runtime.
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  },
});
