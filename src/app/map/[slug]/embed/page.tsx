import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicAtlasView } from "../PublicAtlasView";
import type { SampleMap, CityData, CountryData, RoadData, Point } from "@/types/atlas";

type Props = { params: Promise<{ slug: string }> };

export default async function EmbedPage({ params }: Props) {
  const { slug } = await params;

  const map = await prisma.map.findFirst({
    where: { shareSlug: slug, visibility: { not: "private" } },
    select: { id: true, title: true },
  });
  if (!map) notFound();
  const mapId = map.id;

  const places = await prisma.place.findMany({
    where: { mapId },
    orderBy: { ordinal: "asc" },
  });
  const countryPlaces = places.filter((p) => p.level === "country");
  const cityPlaces = places.filter((p) => p.level === "city");

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
      position: [c.positionX, c.positionY] as Point,
      urbanDensity: c.cityRank === "capital" ? 8 : c.cityRank === "city" ? 5 : 2,
      summary: c.summary ?? undefined,
      messages: messages.length > 0 ? messages : undefined,
    };
  });

  const dbRoads = await prisma.road.findMany({ where: { mapId } });
  const roads: RoadData[] = dbRoads.map((r) => ({
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

  // Bare layout — no header, no chrome. Designed to live inside an <iframe>.
  return (
    <div className="w-full h-screen">
      <PublicAtlasView map={sampleMap} />
    </div>
  );
}
