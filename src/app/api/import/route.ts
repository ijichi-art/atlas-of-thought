import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseContent, type KnownSource } from "@/lib/parsers";
import type { ParseIssue } from "@/lib/parsers/types";
import type { SourceType } from "@/generated/prisma/client";
import { redactSecrets, type RedactionEvent } from "@/lib/secret-redact";

// Map parser source strings to the DB enum values.
const SOURCE_MAP: Record<string, SourceType> = {
  chatgpt: "chatgpt",
  claude: "claude",
  claude_code: "claude_code",
  gemini: "gemini",
  manual: "manual",
};

function toSourceType(s: string): SourceType {
  return SOURCE_MAP[s] ?? "manual";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function getRawText(req: Request): Promise<{
  raw: string;
  source: string;
  mapId: string;
  title?: string;
} | { error: string; status: number }> {
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const mapId = (form.get("mapId") as string | null) ?? "";
    const source = (form.get("source") as string | null) ?? "auto";
    const title = (form.get("title") as string | null) ?? undefined;
    const file = form.get("file") as File | null;
    const raw = file ? await file.text() : ((form.get("text") as string | null) ?? "");
    return { raw, source, mapId, title };
  }

  // JSON body fallback
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return { error: "Invalid request body", status: 400 };
  }
  return {
    raw: (body as Record<string, string>).text ?? "",
    source: (body as Record<string, string>).source ?? "auto",
    mapId: (body as Record<string, string>).mapId ?? "",
    title: (body as Record<string, string>).title,
  };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = await getRawText(req);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { raw, source, mapId, title } = parsed;

  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }
  if (!raw.trim()) {
    return NextResponse.json({ error: "No content provided" }, { status: 400 });
  }

  const map = await prisma.map.findFirst({ where: { id: mapId, userId } });
  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const knownSources = new Set<string>(["chatgpt", "claude", "claude_code", "gemini", "paste", "auto"]);
  const safeSource: KnownSource | "auto" = knownSources.has(source)
    ? (source as KnownSource | "auto")
    : "auto";

  const { conversations, issues } = parseContent(raw, { source: safeSource, title });

  let imported = 0;
  let skipped = 0;
  let totalTokens = 0;
  const dbIssues: ParseIssue[] = [];
  // Layer 1 secret redaction stats — surfaced in the response so the
  // importing user can see what was stripped without ever seeing the
  // values themselves.
  const redactionTotals = new Map<string, number>();

  for (const conv of conversations) {
    // Redact secrets in every message body before persisting. Format-only
    // matching: deterministic patterns from src/lib/secret-redact.ts.
    const redactedMessages = conv.messages.map((m) => {
      const r = redactSecrets(m.text);
      for (const ev of r.events) {
        redactionTotals.set(ev.kind, (redactionTotals.get(ev.kind) ?? 0) + ev.count);
      }
      return { ...m, text: r.text };
    });

    totalTokens += redactedMessages.reduce((sum, m) => sum + estimateTokens(m.text), 0);
    const dbSource = toSourceType(conv.source);

    try {
      await prisma.$transaction(async (tx) => {
        // Dedup: same (mapId, source, externalId) → skip
        if (conv.externalId) {
          const existing = await tx.conversation.findFirst({
            where: { mapId, source: dbSource, externalId: conv.externalId },
            select: { id: true },
          });
          if (existing) {
            skipped++;
            return;
          }
        }

        await tx.conversation.create({
          data: {
            mapId,
            source: dbSource,
            externalId: conv.externalId ?? null,
            title: conv.title,
            createdAtSource: conv.createdAt ?? null,
            messages: {
              create: redactedMessages.map((m, i) => ({
                ordinal: i,
                role: m.role,
                text: m.text,
                createdAt: m.createdAt ?? null,
              })),
            },
          },
        });

        imported++;
      });
    } catch (err) {
      dbIssues.push({
        level: "warning",
        code: "db_write_error",
        message: err instanceof Error ? err.message : "Failed to save conversation",
        conversationId: conv.externalId,
      });
    }
  }

  const redactions: RedactionEvent[] = Array.from(redactionTotals, ([kind, count]) => ({
    kind: kind as RedactionEvent["kind"],
    count,
  }));

  return NextResponse.json({
    imported,
    skipped,
    issues: [...issues, ...dbIssues],
    estimatedTokens: totalTokens,
    redactions,
  });
}
