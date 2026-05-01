import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { SampleMap, CityData, CountryData, RoadData, POIData, RiverData, Point } from "@/types/atlas";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: mapId } = await params;

  const map = await prisma.map.findFirst({
    where: { id: mapId, userId },
    select: { id: true, title: true },
  });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  // Materialise the legacy { countries, cities, roads } shape from Place
  // rows. Phase 1 keeps the schema flat (level=country at depth 1, level=city
  // at depth 2). Phase 4 will return a richer hierarchy + POI list directly.
  const places = await prisma.place.findMany({
    where: { mapId },
    orderBy: { ordinal: "asc" },
  });
  const cityPlaces = places.filter((p) => p.level === "city");
  const countryPlaces = places.filter((p) => p.level === "country");

  // Pull conversation message previews for each city (POI side panel data).
  const cityConvs = await prisma.placeConversation.findMany({
    where: { place: { mapId, level: "city" } },
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
  });
  // Authoritative POI count per city — sourced from the PlaceConversation
  // join directly so the built-up threshold doesn't rely on the (looser)
  // POI-list filter that drops convs missing poiX/poiY.
  const poiCountByCity = new Map<string, number>();
  for (const cc of cityConvs) {
    poiCountByCity.set(cc.placeId, (poiCountByCity.get(cc.placeId) ?? 0) + 1);
  }
  const messagesByCity = new Map<string, { role: "user" | "assistant"; text: string }[]>();
  for (const cc of cityConvs) {
    const arr = messagesByCity.get(cc.placeId) ?? [];
    for (const m of cc.conversation.messages) {
      arr.push({ role: m.role as "user" | "assistant", text: m.text });
    }
    messagesByCity.set(cc.placeId, arr);
  }

  const countries: CountryData[] = countryPlaces.map((c) => ({
    id: c.id,
    name: c.name,
    nameJa: c.nameJa ?? undefined,
    theme: c.theme ?? undefined,
    color: c.color,
    polygon: (c.polygon as [number, number][]) ?? [],
  }));

  const cities: CityData[] = cityPlaces.map((c) => {
    const messages = (messagesByCity.get(c.id) ?? []).slice(0, 6);
    return {
      id: c.id,
      countryId: c.parentId ?? "",
      rank: (c.cityRank ?? "town") as CityData["rank"],
      label: c.name,
      labelJa: c.nameJa ?? undefined,
      district: c.theme ?? undefined,
      districtJa: undefined,
      position: [c.positionX, c.positionY] as Point,
      builtUpR: c.builtUpR ?? undefined,
      poiCount: poiCountByCity.get(c.id) ?? 0,
      urbanDensity: c.cityRank === "capital" ? 8 : c.cityRank === "city" ? 5 : 2,
      summary: c.summary ?? undefined,
      messages: messages.length > 0 ? messages : undefined,
    };
  });

  // POIs (individual conversations) — one per Conversation that has a place
  // assigned, with the position scattered inside its city's built-up disk
  // by Phase 3.
  const poiRows = await prisma.conversation.findMany({
    where: { mapId, places: { some: { place: { mapId, level: "city" } } }, poiX: { not: null } },
    select: {
      id: true,
      title: true,
      poiX: true,
      poiY: true,
      poiKind: true,
      places: {
        where: { place: { level: "city" } },
        select: { placeId: true },
        take: 1,
      },
    },
  });
  const validKinds = new Set<NonNullable<POIData["kind"]>>([
    "code", "research", "personal", "question", "creative", "decision",
  ]);
  const pois: POIData[] = poiRows
    .filter((p) => p.places[0] && p.poiX !== null && p.poiY !== null)
    .map((p) => {
      const kindCandidate = (p.poiKind ?? undefined) as POIData["kind"];
      const kind = kindCandidate && validKinds.has(kindCandidate) ? kindCandidate : undefined;
      return {
        id: `poi-${p.id}`,
        cityId: p.places[0].placeId,
        conversationId: p.id,
        label: p.title ?? "(untitled)",
        position: [p.poiX!, p.poiY!] as Point,
        kind,
      };
    });

  const dbTerrain = await prisma.terrainFeature.findMany({
    where: { mapId, type: "river" },
    select: { id: true, geometry: true },
  });
  const rivers: RiverData[] = dbTerrain
    .map((t) => {
      const g = t.geometry as { kind?: string; coords?: [number, number][] } | null;
      if (!g || g.kind !== "polyline" || !Array.isArray(g.coords)) return null;
      return { id: t.id, path: g.coords as Point[] };
    })
    .filter((r): r is RiverData => r !== null);

  const dbRoads = await prisma.road.findMany({ where: { mapId } });
  const roads: RoadData[] = dbRoads.map((r) => ({
    id: r.id,
    fromCityId: r.fromId,
    toCityId: r.toId,
    type: r.type as RoadData["type"],
    label: r.label ?? undefined,
    weight: r.weight ?? undefined,
    waypoints: (r.waypoints as [number, number][] | null) ?? undefined,
  }));

  const sampleMap: SampleMap = {
    id: map.id,
    title: map.title,
    viewBox: { width: 1640, height: 1000 },
    sea: { color: "#a8c4d8" },
    countries,
    mountainRanges: [],
    rivers,
    cities,
    roads,
    pois,
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
