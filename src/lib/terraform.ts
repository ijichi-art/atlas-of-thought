// Auto-terraforming v2: hierarchical, semantic, organic.
//
// Pipeline:
//   1. Single Opus call → 4-level hierarchy (countries / districts / cities / edges)
//   2. Validate & repair (every conversation must end up in some district + city)
//   3. Force-directed layout: country centers attract by neighbor relations,
//      cities attract toward their country center and same-district siblings
//   4. Organic country boundaries: convex hull of cities + outward expansion + jitter
//   5. Persist countries / cities / roads
//
// Determinism: a stable seed derived from the sorted conversation IDs feeds
// every PRNG so the same input produces the same map.

import { prisma } from "@/lib/prisma";
import type { AiClient } from "./ai-client";
import { polygonHull } from "d3-polygon";
import {
  forceSimulation,
  forceManyBody,
  forceCollide,
  forceCenter,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";

// ── Constants ─────────────────────────────────────────────────────────────────

const VIEW_W = 1640;
const VIEW_H = 1000;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;

const COUNTRY_COLORS = [
  "#c4d4be", "#c8b8d8", "#d4c4a8", "#b8ccd4",
  "#d4b8b8", "#c4d4c8", "#d0c8b0", "#bdc7d4",
  "#d3c0d4", "#c8cfb6",
];

// ── AI types ──────────────────────────────────────────────────────────────────

type ConvInput = {
  id: string;
  title: string | null;
  preview: string;
  messageCount: number;
  totalChars: number;
};

type AiDistrict = {
  name: string;
  nameJa?: string;
  cityIndexes: number[];
};

type AiCountry = {
  name: string;
  nameJa?: string;
  theme: string;
  color?: string;
  neighbors?: number[];
  districts: AiDistrict[];
};

type AiCity = {
  conversationIndex: number;
  topic: string;
  topicJa?: string;
  summary: string;
  rank: "capital" | "city" | "town";
};

type AiEdge = {
  fromCity: number;
  toCity: number;
  type?: "highway" | "regular" | "trail";
  concept: string;
};

type AiResult = {
  countries: AiCountry[];
  cities: AiCity[];
  edges?: AiEdge[];
};

// ── Prompt ────────────────────────────────────────────────────────────────────

async function clusterWithAI(convs: ConvInput[], ai: AiClient): Promise<AiResult> {
  const system = `You are a master cartographer of thought. Given AI conversation transcripts, you design a hierarchical "map of mind" — countries (themes), districts (sub-themes), cities (individual conversations), and edges (semantic links between conversations).

Output JSON only — no markdown, no commentary, no fences. Be precise and exhaustive.`;

  const convList = convs
    .map(
      (c, i) =>
        `[${i}] (${c.messageCount} msgs, ${c.totalChars}c) title="${c.title ?? "(untitled)"}" preview="${c.preview.replace(/\n/g, " ")}"`,
    )
    .join("\n");

  const colorList = COUNTRY_COLORS.join(", ");
  const maxCountries = Math.min(8, Math.max(3, Math.ceil(convs.length / 3)));

  const user = `Conversations (${convs.length} total). Each is identified by [N]:
${convList}

Build a hierarchical map of these conversations.

LEVEL 1 — COUNTRIES (themes):
- Group ALL ${convs.length} conversations into 3-${maxCountries} thematic countries.
- Each country: a Latin/Greek-inspired single-word name (Architectura, Cognitio, Machina, Forum, Sylva, Aether, Nautica, Industria, Mercatus, Eloquentia…) and an optional Japanese single-word.
- Theme: 3-7 word description.
- Color: pick from ${colorList}.
- Neighbors: array of 1-3 country indices (other than itself) that are most thematically related — these will be drawn adjacent on the map.

LEVEL 2 — DISTRICTS (sub-themes within a country):
- Each country has 1-4 districts.
- Each district has a name (English + optional Japanese) and lists which conversation indices belong to it.
- A district groups conversations sharing a finer-grained sub-theme.
- EVERY conversation index 0..${convs.length - 1} must appear in EXACTLY ONE district across all countries combined.

LEVEL 3 — CITIES (one per conversation):
- Topic: 3-6 word phrase capturing the conversation's gist.
- TopicJa: optional Japanese phrase.
- Summary: ONE concise sentence about what was discussed and concluded.
- Rank: "capital" for the most substantial conversation in its country (only ONE per country); "city" for medium; "town" for short or peripheral.

LEVEL 4 — EDGES (semantic roads):
- Pairs of conversations that share a meaningful concept, technique, decision, or causal link.
- Each edge: fromCity (conv index), toCity (conv index), type, concept (3-8 word phrase).
- type: "highway" for foundational/recurring shared concept, "regular" for specific shared technique, "trail" for tangential reference.
- Aim for 1-3 edges per city on average. Don't connect every pair — only meaningful ones.

CRITICAL RULES:
- Every conversation index 0..${convs.length - 1} must appear in exactly one district AND in cities[].
- Each country has exactly ONE capital.
- Edges reference conversation indices, not names.

Output JSON only, this exact shape:
{
  "countries": [
    {
      "name": "Architectura",
      "nameJa": "建築",
      "theme": "system architecture and design patterns",
      "color": "#c4d4be",
      "neighbors": [1, 2],
      "districts": [
        { "name": "Auth Quarter", "nameJa": "認証区", "cityIndexes": [0, 5, 7] },
        { "name": "Storage Bay", "nameJa": "記憶湾", "cityIndexes": [3, 11] }
      ]
    }
  ],
  "cities": [
    {
      "conversationIndex": 0,
      "topic": "JWT token refresh strategy",
      "topicJa": "トークン更新",
      "summary": "Designed a refresh-token rotation flow that handles expired sessions gracefully.",
      "rank": "capital"
    }
  ],
  "edges": [
    { "fromCity": 0, "toCity": 5, "type": "highway", "concept": "shared OAuth provider integration" }
  ]
}`;

  let raw = "";
  for await (const chunk of ai.stream({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 16384,
  })) {
    raw += chunk;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI returned no JSON. Got: ${raw.slice(0, 300)}`);

  let parsed: AiResult;
  try {
    parsed = JSON.parse(jsonMatch[0]) as AiResult;
  } catch (err) {
    throw new Error(
      `AI returned invalid JSON: ${err instanceof Error ? err.message : err}. Snippet: ${jsonMatch[0].slice(0, 300)}`,
    );
  }

  if (!Array.isArray(parsed.countries) || parsed.countries.length === 0) {
    throw new Error("AI returned no countries.");
  }
  if (!Array.isArray(parsed.cities) || parsed.cities.length === 0) {
    throw new Error("AI returned no cities.");
  }
  return parsed;
}

// ── Validation & repair ───────────────────────────────────────────────────────

type Assignment = { countryIdx: number; districtIdx: number };

function assignAll(ai: AiResult, convCount: number): Map<number, Assignment> {
  const map = new Map<number, Assignment>();

  for (let ci = 0; ci < ai.countries.length; ci++) {
    const country = ai.countries[ci];
    const districts = Array.isArray(country.districts) ? country.districts : [];
    for (let di = 0; di < districts.length; di++) {
      const cityIdxs = Array.isArray(districts[di].cityIndexes) ? districts[di].cityIndexes : [];
      for (const idx of cityIdxs) {
        if (Number.isInteger(idx) && idx >= 0 && idx < convCount && !map.has(idx)) {
          map.set(idx, { countryIdx: ci, districtIdx: di });
        }
      }
    }
  }

  // Repair: any conv not assigned → put into the largest country's "Unsorted" district
  const missing: number[] = [];
  for (let i = 0; i < convCount; i++) if (!map.has(i)) missing.push(i);

  if (missing.length > 0) {
    const counts = new Array(ai.countries.length).fill(0);
    for (const a of map.values()) counts[a.countryIdx]++;
    let largest = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[largest]) largest = i;
    const country = ai.countries[largest];
    if (!Array.isArray(country.districts)) country.districts = [];
    let miscIdx = country.districts.findIndex((d) => d.name === "Unsorted");
    if (miscIdx === -1) {
      country.districts.push({ name: "Unsorted", cityIndexes: [] });
      miscIdx = country.districts.length - 1;
    }
    for (const idx of missing) {
      country.districts[miscIdx].cityIndexes.push(idx);
      map.set(idx, { countryIdx: largest, districtIdx: miscIdx });
    }
  }

  return map;
}

// ── PRNG (deterministic) ──────────────────────────────────────────────────────

function deterministicSeed(parts: string[]): number {
  let h = 2166136261;
  const joined = [...parts].sort().join("|");
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(x: number, y: number, padding: number): [number, number] {
  return [
    Math.max(padding, Math.min(VIEW_W - padding, x)),
    Math.max(padding, Math.min(VIEW_H - padding, y)),
  ];
}

// ── Layout ────────────────────────────────────────────────────────────────────

type CityNode = SimulationNodeDatum & {
  i: number;
  countryIdx: number;
  districtIdx: number;
  rank: "capital" | "city" | "town";
};

type CountryNode = SimulationNodeDatum & { i: number };

function layoutAll(
  ai: AiResult,
  assignments: Map<number, Assignment>,
  seedParts: string[],
): { positions: Map<number, [number, number]>; countryCenters: Array<[number, number]> } {
  const seed = deterministicSeed(seedParts);
  const rng = mulberry32(seed);

  // Step 1: country centers — start in a ring, then force-adjust using neighbor links
  const Nc = ai.countries.length;
  const ringR = Math.min(VIEW_W, VIEW_H) * 0.32;
  const countryNodes: CountryNode[] = Array.from({ length: Nc }, (_, i) => {
    const angle = (2 * Math.PI * i) / Nc - Math.PI / 2 + (rng() - 0.5) * 0.4;
    return { i, x: CX + ringR * Math.cos(angle), y: CY + ringR * Math.sin(angle) };
  });

  // Build neighbor adjacency: pull adjacent countries toward each other
  type Link = { source: CountryNode; target: CountryNode; strength: number };
  const links: Link[] = [];
  for (let i = 0; i < Nc; i++) {
    const ns = ai.countries[i].neighbors ?? [];
    for (const n of ns) {
      if (n >= 0 && n < Nc && n !== i) {
        links.push({ source: countryNodes[i], target: countryNodes[n], strength: 0.5 });
      }
    }
  }

  const cSim = forceSimulation<CountryNode>(countryNodes)
    .force("repel", forceManyBody().strength(-3000))
    .force("center", forceCenter(CX, CY).strength(0.06))
    .force("collide", forceCollide(170))
    .force("attract", () => {
      for (const l of links) {
        const dx = (l.target.x ?? 0) - (l.source.x ?? 0);
        const dy = (l.target.y ?? 0) - (l.source.y ?? 0);
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 280) * 0.05 * l.strength;
        l.source.x = (l.source.x ?? 0) + (dx / d) * f;
        l.source.y = (l.source.y ?? 0) + (dy / d) * f;
        l.target.x = (l.target.x ?? 0) - (dx / d) * f;
        l.target.y = (l.target.y ?? 0) - (dy / d) * f;
      }
    })
    .stop();

  for (let t = 0; t < 300; t++) cSim.tick();

  const countryCenters: Array<[number, number]> = countryNodes.map((n) => clamp(n.x ?? CX, n.y ?? CY, 220));

  // Step 2: city positions — pulled toward country centers, then nudged toward district centroids
  const cityNodes: CityNode[] = [];
  for (const [convIdx, asgn] of assignments) {
    const cityInfo = ai.cities.find((c) => c.conversationIndex === convIdx);
    const rank = cityInfo?.rank ?? "town";
    const [cx0, cy0] = countryCenters[asgn.countryIdx];
    const jitterAngle = rng() * 2 * Math.PI;
    const jitterR = 20 + rng() * 30;
    cityNodes.push({
      i: convIdx,
      countryIdx: asgn.countryIdx,
      districtIdx: asgn.districtIdx,
      rank,
      x: cx0 + Math.cos(jitterAngle) * jitterR,
      y: cy0 + Math.sin(jitterAngle) * jitterR,
    });
  }

  const ciSim = forceSimulation<CityNode>(cityNodes)
    .force(
      "countryX",
      forceX<CityNode>((d) => countryCenters[d.countryIdx][0]).strength(0.1),
    )
    .force(
      "countryY",
      forceY<CityNode>((d) => countryCenters[d.countryIdx][1]).strength(0.1),
    )
    .force(
      "collide",
      forceCollide<CityNode>((d) => (d.rank === "capital" ? 30 : d.rank === "city" ? 22 : 16)),
    )
    .force("repel", forceManyBody<CityNode>().strength(-60))
    .stop();

  for (let t = 0; t < 220; t++) ciSim.tick();

  // Step 3: pull same-district cities toward district centroid
  for (let pass = 0; pass < 35; pass++) {
    const dCent = new Map<string, { x: number; y: number; count: number }>();
    for (const n of cityNodes) {
      const key = `${n.countryIdx}:${n.districtIdx}`;
      const c = dCent.get(key) ?? { x: 0, y: 0, count: 0 };
      c.x += n.x ?? 0;
      c.y += n.y ?? 0;
      c.count++;
      dCent.set(key, c);
    }
    for (const c of dCent.values()) {
      c.x /= c.count;
      c.y /= c.count;
    }
    for (const n of cityNodes) {
      const key = `${n.countryIdx}:${n.districtIdx}`;
      const c = dCent.get(key)!;
      n.x = (n.x ?? 0) + (c.x - (n.x ?? 0)) * 0.05;
      n.y = (n.y ?? 0) + (c.y - (n.y ?? 0)) * 0.05;
    }
  }

  // Final relaxation with collide
  const ciSim2 = forceSimulation<CityNode>(cityNodes)
    .force(
      "collide",
      forceCollide<CityNode>((d) => (d.rank === "capital" ? 28 : d.rank === "city" ? 20 : 14)),
    )
    .stop();
  for (let t = 0; t < 80; t++) ciSim2.tick();

  // Recompute country centers as actual centroid of their final cities
  const cAcc: { x: number; y: number; count: number }[] = countryCenters.map(() => ({
    x: 0,
    y: 0,
    count: 0,
  }));
  for (const n of cityNodes) {
    cAcc[n.countryIdx].x += n.x ?? 0;
    cAcc[n.countryIdx].y += n.y ?? 0;
    cAcc[n.countryIdx].count++;
  }
  const finalCenters: Array<[number, number]> = countryCenters.map(([x, y], i) =>
    cAcc[i].count > 0 ? [cAcc[i].x / cAcc[i].count, cAcc[i].y / cAcc[i].count] : [x, y],
  );

  const positions = new Map<number, [number, number]>();
  for (const n of cityNodes) {
    const [x, y] = clamp(n.x ?? CX, n.y ?? CY, 60);
    positions.set(n.i, [x, y]);
  }

  return { positions, countryCenters: finalCenters };
}

// ── Country polygons (organic) ────────────────────────────────────────────────

function organicBlob(
  cx: number,
  cy: number,
  r: number,
  rng: () => number,
  irregularity: number,
): [number, number][] {
  const sides = 12;
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    const radius = r * (1 + (rng() - 0.5) * irregularity * 2);
    points.push([Math.round(cx + radius * Math.cos(angle)), Math.round(cy + radius * Math.sin(angle))]);
  }
  return points;
}

function countryPolygonFromCities(
  cityPoints: Array<[number, number]>,
  seed: number,
): [number, number][] {
  if (cityPoints.length === 0) return [];
  const rng = mulberry32(seed);
  const padding = 80;
  const irregularity = 0.18;

  if (cityPoints.length === 1) {
    const [cx, cy] = cityPoints[0];
    return organicBlob(cx, cy, padding * 1.2, rng, irregularity);
  }

  const cx = cityPoints.reduce((s, p) => s + p[0], 0) / cityPoints.length;
  const cy = cityPoints.reduce((s, p) => s + p[1], 0) / cityPoints.length;

  const hullInput = cityPoints.map(([x, y]) => [x, y] as [number, number]);
  const hull = polygonHull(hullInput) ?? hullInput;

  // Expand vertices outward from centroid + per-vertex jitter
  const expanded: [number, number][] = hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
    const nx = dx / d;
    const ny = dy / d;
    const jitter = 1 + (rng() - 0.5) * irregularity * 2;
    return [Math.round(x + nx * padding * jitter), Math.round(y + ny * padding * jitter)];
  });

  // Subdivide each edge with intermediate jittered points → organic curvature
  const detailed: [number, number][] = [];
  for (let i = 0; i < expanded.length; i++) {
    const a = expanded[i];
    const b = expanded[(i + 1) % expanded.length];
    detailed.push(a);
    for (let t = 1; t <= 2; t++) {
      const f = t / 3;
      const mx = a[0] + (b[0] - a[0]) * f;
      const my = a[1] + (b[1] - a[1]) * f;
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const elen = Math.max(0.0001, Math.sqrt(ex * ex + ey * ey));
      const px = -ey / elen;
      const py = ex / elen;
      const j = (rng() - 0.5) * 32;
      detailed.push([Math.round(mx + px * j), Math.round(my + py * j)]);
    }
  }

  return detailed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export type TerraformResult = {
  countriesCreated: number;
  citiesCreated: number;
  roadsCreated: number;
  conversationsPlaced: number;
};

export async function terraform(mapId: string, ai: AiClient): Promise<TerraformResult> {
  const allConvs = await prisma.conversation.findMany({
    where: { mapId, source: { not: "native" } },
    select: {
      id: true,
      title: true,
      messages: {
        orderBy: { ordinal: "asc" },
        select: { role: true, text: true },
      },
    },
    orderBy: { importedAt: "desc" },
    take: 50,
  });

  if (allConvs.length === 0) {
    return { countriesCreated: 0, citiesCreated: 0, roadsCreated: 0, conversationsPlaced: 0 };
  }

  const inputs: ConvInput[] = allConvs.map((c) => {
    const userMsgs = c.messages.filter((m) => m.role === "user");
    const preview = (userMsgs[0]?.text ?? c.messages[0]?.text ?? "").slice(0, 280);
    const totalChars = c.messages.reduce((s, m) => s + m.text.length, 0);
    return {
      id: c.id,
      title: c.title,
      preview,
      messageCount: c.messages.length,
      totalChars,
    };
  });

  const aiResult = await clusterWithAI(inputs, ai);
  const assignments = assignAll(aiResult, inputs.length);

  const seedParts = inputs.map((c) => c.id);
  const { positions, countryCenters } = layoutAll(aiResult, assignments, seedParts);
  void countryCenters; // not stored on Country yet — used internally for layout

  // Wipe existing geography
  await prisma.$transaction([
    prisma.road.deleteMany({ where: { mapId } }),
    prisma.city.deleteMany({ where: { mapId } }),
    prisma.country.deleteMany({ where: { mapId } }),
  ]);

  // Create countries with city-derived organic polygons
  const countryIdByIdx = new Map<number, string>();
  for (let i = 0; i < aiResult.countries.length; i++) {
    const c = aiResult.countries[i];
    const cityPositions: Array<[number, number]> = [];
    for (const [convIdx, asgn] of assignments) {
      if (asgn.countryIdx === i) {
        const pos = positions.get(convIdx);
        if (pos) cityPositions.push(pos);
      }
    }
    if (cityPositions.length === 0) continue;
    const polygon = countryPolygonFromCities(
      cityPositions,
      deterministicSeed([c.name + ":" + i]),
    );
    const country = await prisma.country.create({
      data: {
        mapId,
        name: c.name,
        nameJa: c.nameJa ?? null,
        theme: c.theme ?? null,
        color: c.color || COUNTRY_COLORS[i % COUNTRY_COLORS.length],
        polygon,
      },
      select: { id: true },
    });
    countryIdByIdx.set(i, country.id);
  }

  // Create cities (one per assigned conversation)
  const cityIdByConvIdx = new Map<number, string>();
  for (const [convIdx, asgn] of assignments) {
    const countryId = countryIdByIdx.get(asgn.countryIdx);
    if (!countryId) continue;
    const pos = positions.get(convIdx);
    if (!pos) continue;

    const conv = inputs[convIdx];
    const aiCity = aiResult.cities.find((c) => c.conversationIndex === convIdx);
    const district = aiResult.countries[asgn.countryIdx]?.districts?.[asgn.districtIdx];
    const rank = aiCity?.rank ?? "town";

    const city = await prisma.city.create({
      data: {
        mapId,
        countryId,
        rank,
        label: aiCity?.topic ?? conv.title ?? "(untitled)",
        labelJa: aiCity?.topicJa ?? null,
        district: district?.name ?? null,
        districtJa: district?.nameJa ?? null,
        summary: aiCity?.summary ?? null,
        positionX: pos[0],
        positionY: pos[1],
        urbanDensity: rank === "capital" ? 8 : rank === "city" ? 5 : 2,
        conversations: { create: { conversationId: conv.id } },
      },
      select: { id: true },
    });
    cityIdByConvIdx.set(convIdx, city.id);
  }

  // Roads from explicit semantic edges
  const seenEdges = new Set<string>();
  const roadIds: string[] = [];
  for (const e of aiResult.edges ?? []) {
    const fromId = cityIdByConvIdx.get(e.fromCity);
    const toId = cityIdByConvIdx.get(e.toCity);
    if (!fromId || !toId || fromId === toId) continue;
    const key = fromId < toId ? `${fromId}:${toId}` : `${toId}:${fromId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const road = await prisma.road.create({
      data: { mapId, fromId, toId, type: e.type ?? "regular", label: e.concept ?? null },
      select: { id: true },
    });
    roadIds.push(road.id);
  }

  // Inter-country highways: nearest city pair between neighboring countries
  for (let i = 0; i < aiResult.countries.length; i++) {
    const ns = aiResult.countries[i].neighbors ?? [];
    for (const n of ns) {
      if (n <= i) continue;
      if (n < 0 || n >= aiResult.countries.length) continue;
      const aCities = Array.from(assignments.entries())
        .filter(([, a]) => a.countryIdx === i)
        .map(([convIdx]) => ({ id: cityIdByConvIdx.get(convIdx), pos: positions.get(convIdx) }))
        .filter((c) => c.id && c.pos);
      const bCities = Array.from(assignments.entries())
        .filter(([, a]) => a.countryIdx === n)
        .map(([convIdx]) => ({ id: cityIdByConvIdx.get(convIdx), pos: positions.get(convIdx) }))
        .filter((c) => c.id && c.pos);
      if (aCities.length === 0 || bCities.length === 0) continue;

      let best: { fromId: string; toId: string; dist: number } | null = null;
      for (const a of aCities) {
        for (const b of bCities) {
          const dx = a.pos![0] - b.pos![0];
          const dy = a.pos![1] - b.pos![1];
          const d = dx * dx + dy * dy;
          if (!best || d < best.dist) best = { fromId: a.id!, toId: b.id!, dist: d };
        }
      }
      if (!best) continue;
      const key = best.fromId < best.toId ? `${best.fromId}:${best.toId}` : `${best.toId}:${best.fromId}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const road = await prisma.road.create({
        data: { mapId, fromId: best.fromId, toId: best.toId, type: "highway", label: "neighbor border" },
        select: { id: true },
      });
      roadIds.push(road.id);
    }
  }

  return {
    countriesCreated: countryIdByIdx.size,
    citiesCreated: cityIdByConvIdx.size,
    roadsCreated: roadIds.length,
    conversationsPlaced: cityIdByConvIdx.size,
  };
}
