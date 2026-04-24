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
      _count: { select: { cities: true, countries: true } },
    },
  });
  return map;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const map = await loadMap(slug);
  if (!map) return { title: "Map not found" };

  const desc = `${map._count.cities} cities across ${map._count.countries} countries — an Atlas of Thought`;
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

  const countries: CountryData[] = map.countries.map((c) => ({
    id: c.id,
    name: c.name,
    nameJa: c.nameJa ?? undefined,
    theme: c.theme ?? undefined,
    color: c.color,
    polygon: (c.polygon as [number, number][]) ?? [],
  }));

  const cities: CityData[] = map.cities.map((c) => {
    const messages = c.conversations
      .flatMap((cc) => cc.conversation.messages.map((m) => ({ role: m.role as "user" | "assistant", text: m.text })))
      .slice(0, 6);
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
          <span>{map._count.cities} cities · {map._count.countries} countries</span>
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
