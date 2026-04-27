import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAiClient } from "@/lib/ai-client";
import { terraform, type AiResult } from "@/lib/terraform";

// Body shape for the commit endpoint.
//   - All fields are optional. With no body, behaves like the legacy
//     "fresh terraform" call (LLM runs, no directive).
//   - When `aiResult` is supplied (typically from a preview run), the LLM
//     is NOT re-called and `skipConvIdx[]` is applied to drop those
//     conversations from city placement.
//   - `directive` is persisted on the Map for re-terraform pre-fill.
const Body = z.object({
  directive: z.string().max(2000).optional().nullable(),
  skipConvIdx: z.array(z.number().int().nonnegative()).optional(),
  // The LLM's full proposal from the preview pass. Loosely typed here —
  // terraform() trusts and consumes it as-is.
  aiResult: z
    .object({
      countries: z.array(z.unknown()).optional(),
      cities: z.array(z.unknown()).optional(),
    })
    .passthrough()
    .optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: mapId } = await params;

  const map = await prisma.map.findFirst({ where: { id: mapId, userId }, select: { id: true } });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  const ai = await getAiClient(userId);
  if (!ai) {
    return NextResponse.json(
      { error: "no_api_key", message: "Add an API key in Settings first." },
      { status: 402 },
    );
  }

  // Body is optional — keeps backward compat with the legacy no-body call.
  const rawBody = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const result = await terraform(mapId, ai, {
      aiResult: parsed.data.aiResult as AiResult | undefined,
      skipConvIdx: parsed.data.skipConvIdx,
      directive: parsed.data.directive ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Terraform failed" },
      { status: 500 },
    );
  }
}
