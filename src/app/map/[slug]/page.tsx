import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicAtlasView } from "./PublicAtlasView";
import type { SampleMap, CityData, CountryData, RoadData, Point } from "@/types/atlas";

type Props = { params: Promise<{ slug: string }> };

async function loadMap(slug: string) {
  const map = await prisma.map.findFirst({
    where: { shareSlug: slug, visibility: { not: "private" } },
    select: { id: true, title: true, shareSlug: true },
  });
  if (!map) return null;
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
  const messagesByCity = new Map<string, { role: string; text: string }[]>();
  for (const cc of cityConvs) {
    const arr = messagesByCity.get(cc.placeId) ?? [];
    for (const m of cc.conversation.messages) arr.push({ role: m.role, text: m.text });
    messagesByCity.set(cc.placeId, arr);
  }

  const dbRoads = await prisma.road.findMany({ where: { mapId } });

  return {
    id: map.id,
    title: map.title,
    shareSlug: map.shareSlug,
    countryPlaces,
    cityPlaces,
    messagesByCity,
    dbRoads,
    cityCount: cityPlaces.length,
    countryCount: countryPlaces.length,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const map = await loadMap(slug);
  if (!map) return { title: "Map not found" };

  const desc = `${map.cityCount} cities across ${map.countryCount} countries — an Atlas of Thought`;
  const origin = process.env.NEXT_PUBLIC_ORIGIN ?? "http://localhost:3002";

  return {
    title: `${map.title} — Atlas of Thought`,
    description: desc,
    openGraph: {
      title: map.title,
      description: desc,
      url: `${origin}/map/${slug}`,
      type: "website",
      images: [{ url: `${origin}/map/${slug}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: map.title,
      description: desc,
    },
  };
}

export default async function PublicMapPage({ params }: Props) {
  const { slug } = await params;
  const map = await loadMap(slug);
  if (!map) notFound();

  const countries: CountryData[] = map.countryPlaces.map((c) => ({
    id: c.id,
    name: c.name,
    nameJa: c.nameJa ?? undefined,
    theme: c.theme ?? undefined,
    color: c.color,
    polygon: (c.polygon as [number, number][]) ?? [],
  }));

  const cities: CityData[] = map.cityPlaces.map((c) => {
    const messages = (map.messagesByCity.get(c.id) ?? [])
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.text }))
      .slice(0, 6);
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

  const roads: RoadData[] = map.dbRoads.map((r) => ({
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

  return (
    <div className="h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between text-sm flex-none">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-stone-500 hover:text-stone-800 font-serif">
            Atlas of Thought
          </Link>
          <span className="text-stone-300">·</span>
          <span className="text-stone-700">{map.title}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-400">
          <span>{map.cityCount} cities · {map.countryCount} countries</span>
          <Link href={`/map/${slug}/embed`} className="underline hover:text-stone-600">
            embed
          </Link>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <PublicAtlasView map={sampleMap} />
      </div>
    </div>
  );
}
