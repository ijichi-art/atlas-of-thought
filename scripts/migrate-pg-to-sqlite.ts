// One-shot migration of an existing Postgres atlas DB into the new
// SQLite store. Required when an installation predates the Solo-mode
// switch (commit "Solo mode: SQLite + auth stub + ...") and you don't
// want to re-run terraform from scratch.
//
// Reads from Postgres via `pg`, writes to SQLite via better-sqlite3.
// The auth model is rewritten from the original NextAuth user to the
// fixed `solo-user` so the local auth stub can see the migrated maps.
//
// Usage:
//   set -a && source .env.local && set +a
//   PG_URL="postgresql://atlas:atlas@localhost:5432/atlas" \
//     npx tsx scripts/migrate-pg-to-sqlite.ts
//
// SQLite path comes from DATABASE_URL (file:./prisma/dev.db default).

import { Client } from "pg";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const SOLO_USER_ID = "solo-user";

function sqlitePath(): string {
  const raw = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const file = raw.replace(/^file:/, "");
  return path.resolve(file);
}

async function main() {
  const pgUrl = process.env.PG_URL ?? "postgresql://atlas:atlas@localhost:5432/atlas";
  const dbPath = sqlitePath();
  console.log(`source: ${pgUrl}`);
  console.log(`target: ${dbPath}`);
  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite DB not found at ${dbPath}.`);
    console.error(`Run \`npx prisma db push\` first to create the schema.`);
    process.exit(1);
  }

  const pg = new Client({ connectionString: pgUrl });
  await pg.connect();
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Wipe SQLite in reverse FK order so we can run idempotently.
  const wipeOrder = [
    "Artifact",
    "TerrainFeature",
    "Road",
    "Message",
    "PlaceConversation",
    "Conversation",
    "Place",
    "Map",
    "ApiKey",
    "UserPreference",
    "Session",
    "Account",
    "VerificationToken",
    "User",
  ];
  for (const t of wipeOrder) {
    try {
      sqlite.prepare(`DELETE FROM "${t}"`).run();
    } catch {
      // ignore — table might not exist if schema diverged
    }
  }

  // Ensure the solo-user row exists. The migrated maps / api keys all
  // get FKed to this single user.
  sqlite
    .prepare(
      `INSERT INTO "User" (id, name, email, "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      SOLO_USER_ID,
      "Solo User",
      "solo@local",
      new Date().toISOString(),
      new Date().toISOString(),
    );

  // Helper that runs an INSERT with a column list. Values pulled from
  // the source row by column name; userId is rewritten when present.
  function copyTable(args: {
    pgRows: Record<string, unknown>[];
    table: string;
    columns: string[];
    rewriteUserId?: boolean;
  }) {
    const { pgRows, table, columns, rewriteUserId } = args;
    if (pgRows.length === 0) {
      console.log(`  ${table}: 0 rows`);
      return;
    }
    const placeholders = columns.map(() => "?").join(", ");
    const colList = columns.map((c) => `"${c}"`).join(", ");
    const stmt = sqlite.prepare(
      `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`,
    );
    const insertMany = sqlite.transaction((rows: Record<string, unknown>[]) => {
      for (const r of rows) {
        const vals = columns.map((c) => {
          let v = r[c];
          if (rewriteUserId && c === "userId" && v !== null && v !== SOLO_USER_ID) {
            v = SOLO_USER_ID;
          }
          // Postgres returns Date objects for timestamps; SQLite needs ISO strings.
          if (v instanceof Date) v = v.toISOString();
          // Postgres returns object/array for json columns; SQLite stores text.
          if (v !== null && typeof v === "object" && !(v instanceof Buffer)) {
            v = JSON.stringify(v);
          }
          // Postgres bytea comes back as Buffer; SQLite better-sqlite3 takes Buffer directly.
          if (v === undefined) v = null;
          return v as string | number | bigint | Buffer | null;
        });
        stmt.run(vals);
      }
    });
    insertMany(pgRows);
    console.log(`  ${table}: ${pgRows.length} rows`);
  }

  // ── ApiKey ──────────────────────────────────────────────────────────
  console.log("Migrating ApiKey...");
  const apikeys = (await pg.query(`SELECT * FROM "ApiKey"`)).rows;
  copyTable({
    pgRows: apikeys,
    table: "ApiKey",
    columns: [
      "id", "userId", "provider", "ciphertext", "hint", "label", "model",
      "createdAt", "lastUsedAt",
    ],
    rewriteUserId: true,
  });

  // ── UserPreference ──────────────────────────────────────────────────
  console.log("Migrating UserPreference...");
  const prefs = (await pg.query(`SELECT * FROM "UserPreference"`)).rows;
  // userId is the PK here, so we collapse all preferences to solo-user
  // (last write wins — there should only be one in practice).
  const pref = prefs.find((p) => p.userId !== SOLO_USER_ID) ?? prefs[0];
  if (pref) {
    sqlite
      .prepare(
        `INSERT INTO "UserPreference" ("userId", "chatProvider") VALUES (?, ?)`,
      )
      .run(SOLO_USER_ID, pref.chatProvider as string);
    console.log(`  UserPreference: 1 row (rewritten userId)`);
  } else {
    console.log(`  UserPreference: 0 rows`);
  }

  // ── Map ─────────────────────────────────────────────────────────────
  console.log("Migrating Map...");
  const maps = (await pg.query(`SELECT * FROM "Map"`)).rows;
  copyTable({
    pgRows: maps,
    table: "Map",
    columns: [
      "id", "userId", "title", "visibility", "shareSlug",
      "exclusionDirective", "createdAt", "updatedAt",
    ],
    rewriteUserId: true,
  });

  // ── Place ───────────────────────────────────────────────────────────
  console.log("Migrating Place...");
  const placesAll = (
    await pg.query(`SELECT * FROM "Place" ORDER BY level ASC, ordinal ASC`)
  ).rows;
  // Insert in level order so self-FK (parentId) targets exist.
  copyTable({
    pgRows: placesAll,
    table: "Place",
    columns: [
      "id", "mapId", "parentId", "level", "name", "nameJa", "theme",
      "color", "polygon", "positionX", "positionY", "ordinal",
      "cityRank", "builtUpR", "summary", "createdAt", "updatedAt",
    ],
  });

  // ── Conversation ────────────────────────────────────────────────────
  console.log("Migrating Conversation...");
  const convs = (await pg.query(`SELECT * FROM "Conversation"`)).rows;
  copyTable({
    pgRows: convs,
    table: "Conversation",
    columns: [
      "id", "mapId", "source", "externalId", "title", "topicEmbedding",
      "poiX", "poiY", "poiKind", "createdAtSource", "importedAt",
    ],
  });

  // ── Message ─────────────────────────────────────────────────────────
  console.log("Migrating Message...");
  const messages = (
    await pg.query(`SELECT * FROM "Message" ORDER BY "conversationId", ordinal`)
  ).rows;
  copyTable({
    pgRows: messages,
    table: "Message",
    columns: [
      "id", "conversationId", "ordinal", "role", "text",
      "topicSegmentId", "createdAt",
    ],
  });

  // ── PlaceConversation ───────────────────────────────────────────────
  console.log("Migrating PlaceConversation...");
  const pc = (await pg.query(`SELECT * FROM "PlaceConversation"`)).rows;
  copyTable({
    pgRows: pc,
    table: "PlaceConversation",
    columns: ["placeId", "conversationId", "createdAt"],
  });

  // ── Road ────────────────────────────────────────────────────────────
  console.log("Migrating Road...");
  const roads = (await pg.query(`SELECT * FROM "Road"`)).rows;
  copyTable({
    pgRows: roads,
    table: "Road",
    columns: [
      "id", "mapId", "fromId", "toId", "type", "label",
      "weight", "waypoints", "createdAt",
    ],
  });

  // ── TerrainFeature ──────────────────────────────────────────────────
  console.log("Migrating TerrainFeature...");
  const terrain = (await pg.query(`SELECT * FROM "TerrainFeature"`)).rows;
  copyTable({
    pgRows: terrain,
    table: "TerrainFeature",
    columns: [
      "id", "mapId", "type", "geometry", "betweenCountryA",
      "betweenCountryB", "createdAt",
    ],
  });

  // ── Artifact ────────────────────────────────────────────────────────
  console.log("Migrating Artifact...");
  const artifacts = (await pg.query(`SELECT * FROM "Artifact"`)).rows;
  copyTable({
    pgRows: artifacts,
    table: "Artifact",
    columns: [
      "id", "placeId", "kind", "landmarkType", "title", "content", "createdAt",
    ],
  });

  // Final summary.
  const counts = sqlite
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM "Map") AS maps,
        (SELECT COUNT(*) FROM "Place") AS places,
        (SELECT COUNT(*) FROM "Conversation") AS convs,
        (SELECT COUNT(*) FROM "Message") AS msgs,
        (SELECT COUNT(*) FROM "Road") AS roads,
        (SELECT COUNT(*) FROM "TerrainFeature") AS terrain,
        (SELECT COUNT(*) FROM "ApiKey") AS keys`,
    )
    .get();
  console.log("\nSQLite final counts:");
  console.log(counts);

  await pg.end();
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
