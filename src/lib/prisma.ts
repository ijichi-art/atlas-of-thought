import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

// SQLite path. DATABASE_URL is `file:./atlas.db` for dev. The packaged
// Electron build resolves it to an OS app-data directory at startup
// (Electron main process sets process.env.DATABASE_URL before importing
// this module).
function resolveSqliteUrl(): string {
  const raw = process.env.DATABASE_URL ?? "file:./atlas.db";
  return raw.replace(/^file:/, "");
}

function makeClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: resolveSqliteUrl() });
  return new PrismaClient({ adapter });
}

export const prisma = globalThis.__prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
