// Auto-terraforming: turn a set of imported conversations into countries, cities,
// and roads on the atlas map. One Claude call does topic extraction + clustering;
// the rest is deterministic layout math.

import { prisma } from "@/lib/prisma";
import type { AiClient } from "./ai-client";

// ── Layout constants ──────────────────────────────────────────────────────────

const CX = 820;
const CY = 500;
const RING_RADIUS = 250;   // country centers orbit this far from map center
const CITY_SPREAD = 80;    // cities scatter within this radius of their country center
const VIEW_W = 1640;
const VIEW_H = 1000;

const COUNTRY_COLORS = [
  "#c4d4be", "#c8b8d8", "#d4c4a8",
  "#b8ccd4", "#d4b8b8", "#c4d4c8", "#d0c8b0",
];

// ── Types ─────────────────────────────────────────────────────────────────────

type ConvInput = {
  id: string;
  title: string | null;
  preview: string; // first user message, truncated
};

type ClusteredCountry = {
  name: string;
  nameJa?: string;
  theme: string;
  color: string;
  conversationIds: string[];
};

type ClusteredCity = {
  conversationId: string;
  countryIndex: number;
  topic: string;
  summary: string;
  rank: "capital" | "city" | "town";
};

type ClusterResult = {
  countries: ClusteredCountry[];
  cities: ClusteredCity[];
};

// ── AI clustering ─────────────────────────────────────────────────────────────

async function clusterWithAI(convs: ConvInput[], ai: AiClient): Promise<ClusterResult> {
  const system = `You are organizing a "map of thought" — a geographic visualization of AI conversations.
Group the given conversations into thematic clusters that will become countries on a map.
Respond only with valid JSON, no markdown fences.`;

  const convList = convs
    .map((c, i) => `[${i}] id="${c.id}" title="${c.title ?? "(untitled)"}" preview="${c.preview}"`)
    .join("\n");

  const colorList = COUNTRY_COLORS.join(", ");

  const user = `Conversations (${convs.length} total):
${convList}

Task:
1. Group them into 3-${Math.min(7, convs.length)} thematic clusters.
2. Give each cluster a Latin-inspired single-word name (like "Architectura", "Cognitio", "Machina") and an optional Japanese word.
3. For each conversation, extract a short topic phrase (4-8 words) and a 1-sentence summary.
4. Assign ranks: the longest/richest conversation in a cluster is "capital", medium ones "city", short ones "town".
5. Pick a color for each cluster from: ${colorList}

Respond with this JSON (no other text):
{
  "countries": [
    { "name": "...", "nameJa": "...", "theme": "...", "color": "...", "conversationIds": ["id1", "id2"] }
  ],
  "cities": [
    { "conversationId": "id1", "countryIndex": 0, "topic": "...", "summary": "...", "rank": "capital|city|town" }
  ]
}`;

  let raw = "";
  for await (const chunk of ai.stream({ system, messages: [{ role: "user", content: user }], maxTokens: 4096 })) {
    raw += chunk;
  }

  // Extract JSON from the response (handle any accidental markdown fences).
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain valid JSON.");

  const parsed = JSON.parse(jsonMatch[0]) as ClusterResult;
  if (!Array.isArray(parsed.countries) || !Array.isArray(parsed.cities)) {
    throw new Error("AI response JSON missing countries or cities arrays.");
  }
  return parsed;
}

// ── Layout math ───────────────────────────────────────────────────────────────

function countryCenter(i: number, total: number): { x: number; y: number } {
  // Start at top and go clockwise; slight offset so no country is exactly at top.
  const angle = (2 * Math.PI * i) / total - Math.PI / 2 + 0.3;
  return {
    x: CX + RING_RADIUS * Math.cos(angle),
    y: CY + RING_RADIUS * Math.sin(angle),
  };
}

// Seeded deterministic scatter so positions don't change between renders.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cityPosition(
  index: number,
  total: number,
  center: { x: number; y: number },
  seed: number
): { x: number; y: number } {
  const rng = mulberry32(seed + index * 137);
  const angle = rng() * 2 * Math.PI;
  // Capital stays near center; others scatter further out.
  const maxR = index === 0 ? CITY_SPREAD * 0.35 : CITY_SPREAD;
  const r = rng() * maxR;
  return {
    x: Math.max(40, Math.min(VIEW_W - 40, center.x + r * Math.cos(angle))),
    y: Math.max(40, Math.min(VIEW_H - 40, center.y + r * Math.sin(angle))),
  };
}

// Hexagonal-ish country polygon, slightly irregular.
function countryPolygon(center: { x: number; y: number }, seed: number): [number, number][] {
  const rng = mulberry32(seed);
  const sides = 6;
  const baseR = 120;
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides + rng() * 0.4;
    const r = baseR * (0.75 + rng() * 0.5);
    points.push([
      Math.round(center.x + r * Math.cos(angle)),
      Math.round(center.y + r * Math.sin(angle)),
    ]);
  }
  return points;
}

// ── Road generation ───────────────────────────────────────────────────────────

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ── Main export ───────────────────────────────────────────────────────────────

export type TerraformResult = {
  countriesCreated: number;
  citiesCreated: number;
  roadsCreated: number;
  conversationsPlaced: number;
};

export async function terraform(mapId: string, ai: AiClient): Promise<TerraformResult> {
  // Load all unplaced conversations (not yet linked to any city).
  const allConvs = await prisma.conversation.findMany({
    where: {
      mapId,
      source: { not: "native" }, // skip chat-started conversations
      cities: { none: {} },      // not yet placed on any city
    },
    select: {
      id: true,
      title: true,
      messages: {
        where: { role: "user" },
        orderBy: { ordinal: "asc" },
        take: 1,
        select: { text: true },
      },
    },
    take: 50, // process up to 50 per run
  });

  if (allConvs.length === 0) {
    return { countriesCreated: 0, citiesCreated: 0, roadsCreated: 0, conversationsPlaced: 0 };
  }

  const inputs: ConvInput[] = allConvs.map((c) => ({
    id: c.id,
    title: c.title,
    preview: c.messages[0]?.text.slice(0, 200) ?? "",
  }));

  const { countries: rawCountries, cities: rawCities } = await clusterWithAI(inputs, ai);

  // Validate that all conversation IDs in the response are real.
  const validIds = new Set(inputs.map((c) => c.id));
  const validCities = rawCities.filter((city) => validIds.has(city.conversationId));

  // ── Write to DB (wipe any existing auto-generated geography first) ──────────
  await prisma.$transaction([
    // Remove old auto-generated roads, cities, countries for this map.
    // We keep TerrainFeature rows (mountains etc.) that may have been manually added.
    prisma.road.deleteMany({ where: { mapId } }),
    prisma.city.deleteMany({ where: { mapId } }),
    prisma.country.deleteMany({ where: { mapId } }),
  ]);

  // Create countries.
  const createdCountries: { id: string; centerX: number; centerY: number }[] = [];
  for (let i = 0; i < rawCountries.length; i++) {
    const rc = rawCountries[i];
    const center = countryCenter(i, rawCountries.length);
    const polygon = countryPolygon(center, i * 999 + 1);
    const country = await prisma.country.create({
      data: {
        mapId,
        name: rc.name,
        nameJa: rc.nameJa,
        theme: rc.theme,
        color: rc.color || COUNTRY_COLORS[i % COUNTRY_COLORS.length],
        polygon,
      },
      select: { id: true },
    });
    createdCountries.push({ id: country.id, centerX: center.x, centerY: center.y });
  }

  // Create cities and link conversations.
  const createdCities: { id: string; x: number; y: number; countryIndex: number }[] = [];
  const citiesByCountry: Map<number, typeof createdCities> = new Map();

  for (const rc of validCities) {
    const cIdx = Math.min(rc.countryIndex, createdCountries.length - 1);
    const country = createdCountries[cIdx];
    const existingInCountry = citiesByCountry.get(cIdx) ?? [];
    const pos = cityPosition(
      existingInCountry.length,
      validCities.filter((c) => c.countryIndex === cIdx).length,
      { x: country.centerX, y: country.centerY },
      cIdx * 500 + existingInCountry.length
    );

    const city = await prisma.city.create({
      data: {
        mapId,
        countryId: country.id,
        rank: rc.rank,
        label: rc.topic,
        summary: rc.summary,
        positionX: pos.x,
        positionY: pos.y,
        urbanDensity: rc.rank === "capital" ? 7 : rc.rank === "city" ? 4 : 2,
        conversations: {
          create: { conversationId: rc.conversationId },
        },
      },
      select: { id: true },
    });

    const entry = { id: city.id, x: pos.x, y: pos.y, countryIndex: cIdx };
    createdCities.push(entry);
    citiesByCountry.set(cIdx, [...existingInCountry, entry]);
  }

  // Create roads: connect pairs of cities within each country.
  const roadsCreated: string[] = [];
  for (const [, cities] of citiesByCountry) {
    for (let i = 0; i < cities.length; i++) {
      const next = cities[(i + 1) % cities.length];
      if (cities[i].id === next.id) continue;
      const road = await prisma.road.create({
        data: {
          mapId,
          fromId: cities[i].id,
          toId: next.id,
          type: "regular",
        },
        select: { id: true },
      });
      roadsCreated.push(road.id);
    }
  }

  // Create inter-country highways between adjacent countries (ring order).
  for (let i = 0; i < createdCountries.length; i++) {
    const nextI = (i + 1) % createdCountries.length;
    const aCities = citiesByCountry.get(i) ?? [];
    const bCities = citiesByCountry.get(nextI) ?? [];
    if (!aCities.length || !bCities.length) continue;

    // Connect the two nearest cities across these countries.
    let best: [string, string] | null = null;
    let bestDist = Infinity;
    for (const a of aCities) {
      for (const b of bCities) {
        const d = distance(a, b);
        if (d < bestDist) { bestDist = d; best = [a.id, b.id]; }
      }
    }
    if (best) {
      const road = await prisma.road.create({
        data: { mapId, fromId: best[0], toId: best[1], type: "highway" },
        select: { id: true },
      });
      roadsCreated.push(road.id);
    }
  }

  return {
    countriesCreated: createdCountries.length,
    citiesCreated: createdCities.length,
    roadsCreated: roadsCreated.length,
    conversationsPlaced: validCities.length,
  };
}
