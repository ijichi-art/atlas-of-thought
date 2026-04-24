import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicAtlasView } from "../PublicAtlasView";
import type { SampleMap, CityData, CountryData, RoadData, Point } from "@/types/atlas";

type Props = { params: Promise<{ slug: string }> };

export default async function EmbedPage({ params }: Props) {
  const { slug } = await params;

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
    },
  });

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

  // Bare layout — no header, no chrome. Designed to live inside an <iframe>.
  return (
    <div className="w-full h-screen">
      <PublicAtlasView map={sampleMap} />
    </div>
  );
}
