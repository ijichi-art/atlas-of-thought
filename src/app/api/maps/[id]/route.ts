import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { SampleMap, CityData, CountryData, RoadData, Point } from "@/types/atlas";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: mapId } = await params;

  const map = await prisma.map.findFirst({
    where: { id: mapId, userId },
    include: {
      countries: true,
      cities: {
        include: {
          conversations: {
            include: {
              conversation: {
                include: {
                  messages: {
                    orderBy: { ordinal: "asc" },
                    take: 6,
                    select: { role: true, text: true },
                  },
                },
              },
            },
          },
        },
      },
      roads: true,
    },
  });

  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  const countries: CountryData[] = map.countries.map((c) => ({
    id: c.id,
    name: c.name,
    nameJa: c.nameJa ?? undefined,
    theme: c.theme ?? undefined,
    color: c.color,
    polygon: (c.polygon as [number, number][]) ?? [],
  }));

  const cities: CityData[] = map.cities.map((c) => {
    // Collect messages from all linked conversations for the panel preview.
    const messages = c.conversations.flatMap((cc) =>
      cc.conversation.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        text: m.text,
      }))
    ).slice(0, 6);

    return {
      id: c.id,
      countryId: c.countryId,
      rank: c.rank as CityData["rank"],
      label: c.label,
      labelJa: c.labelJa ?? undefined,
      position: [c.positionX, c.positionY] as Point,
      urbanDensity: c.urbanDensity,
      summary: c.summary ?? undefined,
      messages: messages.length > 0 ? messages : undefined,
    };
  });

  const roads: RoadData[] = map.roads.map((r) => ({
    id: r.id,
    fromCityId: r.fromId,
    toCityId: r.toId,
    type: r.type as RoadData["type"],
    label: r.label ?? undefined,
  }));

  const sampleMap: SampleMap = {
    id: map.id,
    title: map.title,
    viewBox: { width: 1640, height: 1000 },
    sea: { color: "#a8c4d8" },
    countries,
    mountainRanges: [],
    rivers: [],
    cities,
    roads,
  };

  return NextResponse.json(sampleMap);
}

const PatchBody = z.object({ title: z.string().min(1).max(120) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: mapId } = await params;

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const map = await prisma.map.findFirst({ where: { id: mapId, userId: session.user.id }, select: { id: true } });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  const updated = await prisma.map.update({ where: { id: mapId }, data: { title: parsed.data.title }, select: { id: true, title: true } });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: mapId } = await params;

  const map = await prisma.map.findFirst({ where: { id: mapId, userId: session.user.id }, select: { id: true } });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  await prisma.map.delete({ where: { id: mapId } });
  return NextResponse.json({ ok: true });
}
