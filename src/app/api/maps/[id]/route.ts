import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rejectUntrustedRequest } from "@/lib/request-security";
import type { SampleMap, CityData, CountryData, RoadData, POIData, RiverData, Point } from "@/types/atlas";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejection = rejectUntrustedRequest(req);
  if (rejection) return rejection;

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

  // Pull message previews for each city. The naive nested include
  //   placeConversation.findMany({ include: { conversation: { include: { messages: ... } } } })
  // generates a compound SELECT that exceeds SQLite's default 500-branch
  // UNION ALL limit on maps with ~1500+ conversations (Prisma error
  // P2029). Split into three flat queries instead and assemble in JS.
  const placeConvLinks = await prisma.placeConversation.findMany({
    where: { place: { mapId, level: "city" } },
    select: { placeId: true, conversationId: true },
  });
  // Authoritative POI count per city — sourced from the join directly.
  const poiCountByCity = new Map<string, number>();
  for (const cc of placeConvLinks) {
    poiCountByCity.set(cc.placeId, (poiCountByCity.get(cc.placeId) ?? 0) + 1);
  }
  // For the side-panel preview we only need a few messages per city, not
  // the full transcript. To stay light: pick at most one conversation's
  // worth (6 messages) per city.
  const sampleConvIdByCity = new Map<string, string>();
  for (const cc of placeConvLinks) {
    if (!sampleConvIdByCity.has(cc.placeId)) {
      sampleConvIdByCity.set(cc.placeId, cc.conversationId);
    }
  }
  const sampleConvIds = Array.from(sampleConvIdByCity.values());
  // Chunk the IN-list to stay safely under SQLite limits.
  const CHUNK = 200;
  const messagesByConv = new Map<
    string,
    { role: "user" | "assistant"; text: string }[]
  >();
  for (let i = 0; i < sampleConvIds.length; i += CHUNK) {
    const slice = sampleConvIds.slice(i, i + CHUNK);
    const msgs = await prisma.message.findMany({
      where: { conversationId: { in: slice } },
      orderBy: { ordinal: "asc" },
      select: { conversationId: true, role: true, text: true },
    });
    for (const m of msgs) {
      const arr = messagesByConv.get(m.conversationId) ?? [];
      if (arr.length < 6) {
        arr.push({ role: m.role as "user" | "assistant", text: m.text });
        messagesByConv.set(m.conversationId, arr);
      }
    }
  }
  const messagesByCity = new Map<
    string,
    { role: "user" | "assistant"; text: string }[]
  >();
  for (const [cityId, convId] of sampleConvIdByCity) {
    const arr = messagesByConv.get(convId);
    if (arr && arr.length > 0) messagesByCity.set(cityId, arr);
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

  // POIs (individual conversations) — split into two flat queries for the
  // same SQLite-limit reason as above.
  const convToCity = new Map<string, string>();
  for (const cc of placeConvLinks) {
    if (!convToCity.has(cc.conversationId)) convToCity.set(cc.conversationId, cc.placeId);
  }
  const convIdsWithCity = Array.from(convToCity.keys());
  type PoiRow = {
    id: string;
    title: string | null;
    poiX: number | null;
    poiY: number | null;
    poiKind: string | null;
  };
  const poiRowsRaw: PoiRow[] = [];
  for (let i = 0; i < convIdsWithCity.length; i += CHUNK) {
    const slice = convIdsWithCity.slice(i, i + CHUNK);
    const rows = await prisma.conversation.findMany({
      where: { mapId, id: { in: slice }, poiX: { not: null } },
      select: { id: true, title: true, poiX: true, poiY: true, poiKind: true },
    });
    poiRowsRaw.push(...rows);
  }
  const poiRows = poiRowsRaw.map((p) => ({
    ...p,
    places: [{ placeId: convToCity.get(p.id) ?? "" }],
  }));
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
  const rejection = rejectUntrustedRequest(req);
  if (rejection) return rejection;

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
  const rejection = rejectUntrustedRequest(req);
  if (rejection) return rejection;

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: mapId } = await params;

  const map = await prisma.map.findFirst({ where: { id: mapId, userId: session.user.id }, select: { id: true } });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  await prisma.map.delete({ where: { id: mapId } });
  return NextResponse.json({ ok: true });
}
