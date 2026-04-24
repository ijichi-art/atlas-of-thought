import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAiClient } from "@/lib/ai-client";
import { terraform } from "@/lib/terraform";

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
      { status: 402 }
    );
  }

  try {
    const result = await terraform(mapId, ai);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Terraform failed" },
      { status: 500 }
    );
  }
}
