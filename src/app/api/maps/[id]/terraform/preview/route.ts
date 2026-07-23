import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAiClient } from "@/lib/ai-client";
import { terraformPreview } from "@/lib/terraform";
import { rejectUntrustedRequest } from "@/lib/request-security";

const Body = z.object({
  directive: z.string().max(2000).optional().nullable(),
});

// Run the cartographer LLM only and return the proposal + skip lists
// derived from the user directive. Geography is NOT written until the
// client follows up with POST /api/maps/[id]/terraform passing the
// precomputed aiResult + chosen skipConvIdx[].
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejection = rejectUntrustedRequest(req);
  if (rejection) return rejection;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: mapId } = await params;

  const map = await prisma.map.findFirst({ where: { id: mapId, userId }, select: { id: true } });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const directive = parsed.data.directive ?? null;

  const ai = await getAiClient(userId);
  if (!ai) {
    return NextResponse.json(
      { error: "no_api_key", message: "Add an API key in Settings first." },
      { status: 402 },
    );
  }

  try {
    const preview = await terraformPreview(mapId, ai, directive);
    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Preview failed" },
      { status: 500 },
    );
  }
}
