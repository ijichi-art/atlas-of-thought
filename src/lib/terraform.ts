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

export type ConvInput = {
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

type AiSkipItem = { conversationIndex: number; reason: string };

export type AiResult = {
  countries: AiCountry[];
  cities: AiCity[];
  edges?: AiEdge[];
  // Layer 2 skip lists. Populated only when a non-empty user directive
  // was passed to clusterWithAI.
  skipDefinitive?: AiSkipItem[];
  skipAmbiguous?: AiSkipItem[];
};

// ── JSON repair ───────────────────────────────────────────────────────────────
//
// LLM output sometimes gets cut off mid-array (output budget exhausted while
// the model was still emitting). We walk the bytes tracking depth + string
// state, snip back to the most recent completed value at the outermost depth,
// then close any remaining open arrays / objects so the result is parseable.
// Returns null if the structure is too badly mangled to recover.
export function repairTruncatedJson(input: string): unknown | null {
  let inString = false;
  let escape = false;
  // Stack of open brackets ('[' or '{') with the index of the opening char.
  // We also track, for each frame, the position of the last comma at THAT
  // depth — that's where we'd snip to drop the partial element.
  const stack: Array<{ open: "[" | "{"; lastSafeEnd: number }> = [];
  // Index of the last char that completes a top-level value at depth 1
  // (i.e. directly inside the outermost { ... }). Snipping here keeps every
  // complete top-level field of the response.
  let lastCompleteAtTop = -1;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[" || ch === "{") {
      stack.push({ open: ch, lastSafeEnd: -1 });
      continue;
    }
    if (ch === "]" || ch === "}") {
      stack.pop();
      // After closing, if we're back at depth 1, this position completes a
      // top-level value (countries[], cities[], a country object, etc.).
      if (stack.length === 1) {
        lastCompleteAtTop = i;
      }
      continue;
    }
    if (ch === "," && stack.length === 1) {
      // Comma at depth 1 (between top-level fields) — the field BEFORE this
      // comma was complete. Mark this as the last safe end (just before comma).
      lastCompleteAtTop = i - 1;
    }
  }

  if (lastCompleteAtTop < 0) return null;
  // Snip up to and including the last complete top-level value, then close
  // the outermost object.
  const head = input.slice(0, lastCompleteAtTop + 1) + "}";
  try {
    return JSON.parse(head);
  } catch {
    return null;
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

// Information passed to clusterWithAI when this call is one batch of a larger
// terraform run (see clusterBatched). Drives prompt adjustments so the LLM
// reuses already-named countries instead of creating fresh ones each batch.
type BatchContext = {
  existingCountries: Array<{ name: string; theme: string; color?: string }>;
  batchNumber: number; // 1-based
  totalBatches: number;
  globalConvCount: number; // total across all batches
  // Hard cap on country count across all batches. The LLM is told to prefer
  // reusing existing ones once we're approaching this number.
  maxCountriesTotal: number;
};

async function clusterWithAI(
  convs: ConvInput[],
  ai: AiClient,
  directive: string | null = null,
  batchCtx: BatchContext | null = null,
): Promise<AiResult> {
  const system = `You are a master cartographer of thought. Given AI conversation transcripts, you design a hierarchical "map of mind" — countries (themes), districts (sub-themes), cities (individual conversations), and edges (semantic links between conversations).

Output JSON only — no markdown, no commentary, no fences. Be precise and exhaustive.`;

  const convList = convs
    .map(
      (c, i) =>
        `[${i}] (${c.messageCount} msgs, ${c.totalChars}c) title="${c.title ?? "(untitled)"}" preview="${c.preview.replace(/\n/g, " ")}"`,
    )
    .join("\n");

  const colorList = COUNTRY_COLORS.join(", ");
  // In batched mode, allow up to maxCountriesTotal for the WHOLE run. Per-batch
  // cap is permissive so the LLM can introduce new ones early, then reuse later.
  const maxCountries = batchCtx
    ? Math.min(batchCtx.maxCountriesTotal, Math.max(3, Math.ceil(convs.length / 3)))
    : Math.min(8, Math.max(3, Math.ceil(convs.length / 3)));

  // Existing-countries seed for cross-batch reuse. When provided, the LLM is
  // told to put new conversations into these named countries whenever they fit
  // a previously-discovered theme, instead of inventing fresh names per batch.
  const existingCountriesBlock = batchCtx && batchCtx.existingCountries.length > 0
    ? `

EXISTING COUNTRIES (created by earlier batches — REUSE these names verbatim when conversations match):
${batchCtx.existingCountries
        .map((c) => `- "${c.name}": ${c.theme}${c.color ? ` (color ${c.color})` : ""}`)
        .join("\n")}

Rules for using existing countries:
- If a conversation in this batch fits any existing country's theme, place it in that country.
- Reuse the existing country's name VERBATIM (case-sensitive, no rewording).
- Only create a NEW country for a theme that none of the existing ones cover.
- Total countries across the whole map should NOT exceed ${batchCtx.maxCountriesTotal}.
  Currently ${batchCtx.existingCountries.length} exist; prefer reusing them.`
    : "";

  const batchHeader = batchCtx
    ? `\n(This is batch ${batchCtx.batchNumber} of ${batchCtx.totalBatches} — covering ${convs.length} conversations of ${batchCtx.globalConvCount} total. Conversations are indexed 0..${convs.length - 1} LOCAL to this batch.)\n`
    : "";

  // Layer 2: optional natural-language exclusion directive. The LLM splits
  // matches into definitive (>=80% confident) vs ambiguous (30-80%) so the
  // user can confirm. We forbid the LLM from adding privacy/safety judgment
  // of its own — only the user's directive controls skipping. Guards
  // against over-cutting.
  const directiveTrimmed = (directive ?? "").trim();
  const directiveBlock = directiveTrimmed
    ? `

USER EXCLUSION DIRECTIVE (apply during cartography):
${directiveTrimmed}

Apply this directive as follows:
- Mark conversations as "skipDefinitive" ONLY if the directive clearly applies (>=80% confident).
- Mark as "skipAmbiguous" if the directive might apply but you're unsure (30-80% confident).
- If under 30% confident, do NOT skip — leave the conversation in the normal flow.
- Do NOT skip on your own judgment of sensitivity, privacy, or safety. Only skip per the directive above.
- Each skip item must include a 1-sentence "reason".
- Skipped conversations should still appear in cities[] and in some district's cityIndexes
  (so the user can later un-skip them); the skip lists are advisory metadata.`
    : "";

  const skipSchemaBlock = directiveTrimmed
    ? `,
  "skipDefinitive": [
    { "conversationIndex": 3, "reason": "Directly mentions Acme Corp, which the directive excludes." }
  ],
  "skipAmbiguous": [
    { "conversationIndex": 7, "reason": "Touches on a project codename that may relate to the excluded scope." }
  ]`
    : "";

  const user = `Conversations (${convs.length} total). Each is identified by [N]:
${convList}${batchHeader}${existingCountriesBlock}

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
  ]${skipSchemaBlock}
}${directiveBlock}`;

  let raw = "";
  for await (const chunk of ai.stream({
    system,
    messages: [{ role: "user", content: user }],
    // 32k gives enough headroom for DeepSeek R1's reasoning tokens (typ.
    // 5-12k) PLUS the structured-JSON output for a 50-conv batch (~5-6k).
    // Earlier 16k was tight: when reasoning ran long, the output got cut
    // off mid-array and the parse failed for half the batches.
    maxTokens: 32000,
    jsonMode: true,
  })) {
    raw += chunk;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI returned no JSON. Got: ${raw.slice(0, 300)}`);

  let parsed: AiResult;
  try {
    parsed = JSON.parse(jsonMatch[0]) as AiResult;
  } catch {
    // Try to recover from a truncated response (LLM cut off mid-array). We
    // walk the JSON tracking depth + string state, find the position of the
    // last completed value at depth 1, then close the structure from there.
    // A degraded result is still useful — better than dropping the whole batch.
    const repaired = repairTruncatedJson(jsonMatch[0]);
    if (repaired === null) {
      throw new Error(
        `AI returned invalid JSON. Snippet: ${jsonMatch[0].slice(0, 300)}`,
      );
    }
    parsed = repaired as AiResult;
  }

  if (!Array.isArray(parsed.countries) || parsed.countries.length === 0) {
    throw new Error("AI returned no countries.");
  }
  if (!Array.isArray(parsed.cities) || parsed.cities.length === 0) {
    throw new Error("AI returned no cities.");
  }
  return parsed;
}

// ── Batched cartography ───────────────────────────────────────────────────────
//
// For large maps (1000+ conversations), a single LLM call doesn't fit in
// context. We batch into ~80-conversation chunks. Each batch sees the
// COUNTRIES discovered by previous batches as a seed: the LLM is told to
// reuse those country names whenever a conversation matches their theme,
// only inventing new names for genuinely-new themes. After all batches
// complete, we merge by country name (case-insensitive), remap each batch's
// LOCAL conversationIndex / fromCity / toCity values to GLOBAL indices, and
// fix up post-merge invariants (≤1 capital per country).

// Per-batch size. Lower = more LLM calls but each call's output is smaller,
// keeping us well below DeepSeek R1's combined reasoning+output budget.
// 50 conversations produces ~5-6k tokens of structured JSON, which leaves
// plenty of headroom for R1's reasoning tokens within 32k max_tokens.
export const BATCH_SIZE = 50;
const SINGLE_CALL_THRESHOLD = 60; // ≤ this many conversations → single LLM call
const MAX_COUNTRIES_TOTAL = 12;

export async function clusterBatched(
  inputs: ConvInput[],
  ai: AiClient,
  directive: string | null,
): Promise<AiResult> {
  // Slice inputs into batches.
  const batches: ConvInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push(inputs.slice(i, i + BATCH_SIZE));
  }

  // Accumulator. Countries are deduped by lowercased name. The first batch
  // that introduces a country owns its color/theme/nameJa/neighbors; later
  // batches only contribute new districts to it.
  type AccCountry = AiCountry & { districts: AiDistrict[] };
  const accCountriesByKey = new Map<string, AccCountry>();
  const insertionOrder: string[] = []; // preserve order countries were first seen
  const accCities: AiCity[] = [];
  const accEdges: AiEdge[] = [];
  const accSkipDefinitive: AiSkipItem[] = [];
  const accSkipAmbiguous: AiSkipItem[] = [];

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchOffset = bi * BATCH_SIZE;

    const existingCountries = insertionOrder.map((k) => {
      const c = accCountriesByKey.get(k)!;
      return { name: c.name, theme: c.theme, color: c.color };
    });

    // One bad batch shouldn't kill the whole terraform. Log and continue with
    // an empty contribution if the LLM hiccups for one batch — the user gets
    // a slightly thinner map, not a 500.
    let batchResult: AiResult;
    try {
      batchResult = await clusterWithAI(batch, ai, directive, {
        existingCountries,
        batchNumber: bi + 1,
        totalBatches: batches.length,
        globalConvCount: inputs.length,
        maxCountriesTotal: MAX_COUNTRIES_TOTAL,
      });
    } catch (err) {
      console.error(
        `[clusterBatched] batch ${bi + 1}/${batches.length} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    // Merge countries: dedupe by lowercased trimmed name.
    for (const c of batchResult.countries ?? []) {
      const key = (c.name ?? "").toLowerCase().trim();
      if (!key) continue;
      let existing = accCountriesByKey.get(key);
      if (!existing) {
        existing = {
          name: c.name,
          nameJa: c.nameJa,
          theme: c.theme,
          color: c.color,
          neighbors: c.neighbors,
          districts: [],
        };
        accCountriesByKey.set(key, existing);
        insertionOrder.push(key);
      }
      // Append this batch's districts, remapping cityIndexes from local → global.
      for (const d of c.districts ?? []) {
        existing.districts.push({
          name: d.name,
          nameJa: d.nameJa,
          cityIndexes: (d.cityIndexes ?? [])
            .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < batch.length)
            .map((i) => i + batchOffset),
        });
      }
    }

    // Cities: remap conversationIndex local → global.
    for (const city of batchResult.cities ?? []) {
      if (
        !Number.isInteger(city.conversationIndex) ||
        city.conversationIndex < 0 ||
        city.conversationIndex >= batch.length
      ) continue;
      accCities.push({
        ...city,
        conversationIndex: city.conversationIndex + batchOffset,
      });
    }

    // Edges: remap both endpoints.
    for (const e of batchResult.edges ?? []) {
      if (
        !Number.isInteger(e.fromCity) ||
        !Number.isInteger(e.toCity) ||
        e.fromCity < 0 || e.fromCity >= batch.length ||
        e.toCity < 0 || e.toCity >= batch.length
      ) continue;
      accEdges.push({
        ...e,
        fromCity: e.fromCity + batchOffset,
        toCity: e.toCity + batchOffset,
      });
    }

    // Skip lists.
    for (const s of batchResult.skipDefinitive ?? []) {
      if (!Number.isInteger(s.conversationIndex)) continue;
      if (s.conversationIndex < 0 || s.conversationIndex >= batch.length) continue;
      accSkipDefinitive.push({
        conversationIndex: s.conversationIndex + batchOffset,
        reason: s.reason,
      });
    }
    for (const s of batchResult.skipAmbiguous ?? []) {
      if (!Number.isInteger(s.conversationIndex)) continue;
      if (s.conversationIndex < 0 || s.conversationIndex >= batch.length) continue;
      accSkipAmbiguous.push({
        conversationIndex: s.conversationIndex + batchOffset,
        reason: s.reason,
      });
    }
  }

  // Post-merge fix: each country must have at most ONE capital. The LLM picks
  // a capital per batch independently, so a country present in multiple batches
  // ends up with multiple. Demote duplicates to "city" — keep the first one
  // (smallest conversationIndex) as the capital.
  const convToCountryKey = new Map<number, string>();
  for (const [key, country] of accCountriesByKey) {
    for (const d of country.districts) {
      for (const idx of d.cityIndexes) convToCountryKey.set(idx, key);
    }
  }
  const capitalsAssigned = new Set<string>();
  // Sort cities by conversationIndex so the "first" capital wins consistently.
  const cityOrder = [...accCities].sort(
    (a, b) => a.conversationIndex - b.conversationIndex,
  );
  for (const city of cityOrder) {
    if (city.rank !== "capital") continue;
    const ck = convToCountryKey.get(city.conversationIndex);
    if (!ck) continue;
    if (capitalsAssigned.has(ck)) {
      city.rank = "city";
    } else {
      capitalsAssigned.add(ck);
    }
  }

  return {
    countries: insertionOrder.map((k) => accCountriesByKey.get(k)!),
    cities: accCities,
    edges: accEdges,
    skipDefinitive: accSkipDefinitive.length > 0 ? accSkipDefinitive : undefined,
    skipAmbiguous: accSkipAmbiguous.length > 0 ? accSkipAmbiguous : undefined,
  };
}

// Dispatch: small input → single LLM call (faster, simpler). Large input →
// batched, accumulating shared country list.
async function clusterSmart(
  inputs: ConvInput[],
  ai: AiClient,
  directive: string | null,
): Promise<AiResult> {
  if (inputs.length <= SINGLE_CALL_THRESHOLD) {
    return clusterWithAI(inputs, ai, directive);
  }
  return clusterBatched(inputs, ai, directive);
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
  const ringR = Math.min(VIEW_W, VIEW_H) * 0.22; // tighter initial ring (was 0.32)
  const countryNodes: CountryNode[] = Array.from({ length: Nc }, (_, i) => {
    const angle = (2 * Math.PI * i) / Nc - Math.PI / 2 + (rng() - 0.5) * 0.4;
    return { i, x: CX + ringR * Math.cos(angle), y: CY + ringR * Math.sin(angle) };
  });

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
    .force("repel", forceManyBody().strength(-1500)) // less aggressive (was -3000)
    .force("center", forceCenter(CX, CY).strength(0.18)) // stronger pull to center (was 0.06)
    .force("collide", forceCollide(140)) // smaller collision radius (was 170)
    .force("attract", () => {
      for (const l of links) {
        const dx = (l.target.x ?? 0) - (l.source.x ?? 0);
        const dy = (l.target.y ?? 0) - (l.source.y ?? 0);
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 220) * 0.06 * l.strength;
        l.source.x = (l.source.x ?? 0) + (dx / d) * f;
        l.source.y = (l.source.y ?? 0) + (dy / d) * f;
        l.target.x = (l.target.x ?? 0) - (dx / d) * f;
        l.target.y = (l.target.y ?? 0) - (dy / d) * f;
      }
    })
    .stop();

  for (let t = 0; t < 300; t++) cSim.tick();

  // Hard cap: no country may sit further than this from the map center.
  // Prevents one isolated country from drifting into "lonely island" territory.
  const MAX_DIST_FROM_CENTER = 280;
  for (const node of countryNodes) {
    const dx = (node.x ?? CX) - CX;
    const dy = (node.y ?? CY) - CY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > MAX_DIST_FROM_CENTER) {
      node.x = CX + (dx / d) * MAX_DIST_FROM_CENTER;
      node.y = CY + (dy / d) * MAX_DIST_FROM_CENTER;
    }
  }

  const countryCenters: Array<[number, number]> = countryNodes.map((n) => clamp(n.x ?? CX, n.y ?? CY, 220));

  // Step 2: structured city placement per the user's spec
  //   - capital → at cluster (country) center (with tiny jitter)
  //   - major cities (rank "city") → 200-400px from capital, random angle
  //   - towns → scattered 80-500px from capital
  //   - all cities maintain ≥ MIN_SEP separation (overlap prevention)
  const MIN_SEP = 100;

  // Group cities by country
  type CityEntry = { convIdx: number; rank: "capital" | "city" | "town" };
  const byCountry = new Map<number, CityEntry[]>();
  for (const [convIdx, asgn] of assignments) {
    const aiCity = ai.cities.find((c) => c.conversationIndex === convIdx);
    const rank = aiCity?.rank ?? "town";
    if (!byCountry.has(asgn.countryIdx)) byCountry.set(asgn.countryIdx, []);
    byCountry.get(asgn.countryIdx)!.push({ convIdx, rank });
  }

  const positions = new Map<number, [number, number]>();

  for (const [countryIdx, cities] of byCountry) {
    const center = countryCenters[countryIdx];
    const localRng = mulberry32(seed + countryIdx * 7919 + 1);
    const placed: [number, number][] = [];

    const tryPlace = (
      rMin: number,
      rMax: number,
      maxAttempts: number,
    ): [number, number] => {
      // First pass: try to satisfy hard separation
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const r = rMin + localRng() * (rMax - rMin);
        const theta = localRng() * 2 * Math.PI;
        const cand: [number, number] = [
          center[0] + r * Math.cos(theta),
          center[1] + r * Math.sin(theta),
        ];
        if (cand[0] < 60 || cand[0] > VIEW_W - 60) continue;
        if (cand[1] < 60 || cand[1] > VIEW_H - 60) continue;
        let ok = true;
        for (const p of placed) {
          if (pdist(cand, p) < MIN_SEP) {
            ok = false;
            break;
          }
        }
        if (ok) return cand;
      }
      // Fallback: pick the candidate with largest minimum distance to placed
      let best: [number, number] = center;
      let bestD = -Infinity;
      for (let attempt = 0; attempt < 50; attempt++) {
        const r = rMin + localRng() * (rMax - rMin);
        const theta = localRng() * 2 * Math.PI;
        const cand = clamp(
          center[0] + r * Math.cos(theta),
          center[1] + r * Math.sin(theta),
          60,
        );
        const minD = placed.length === 0 ? Infinity : Math.min(...placed.map((p) => pdist(cand, p)));
        if (minD > bestD) {
          bestD = minD;
          best = cand;
        }
      }
      return best;
    };

    // Capital: at country center with small jitter
    const capital = cities.find((c) => c.rank === "capital");
    if (capital) {
      const jitterAngle = localRng() * 2 * Math.PI;
      const jitterR = localRng() * 20;
      const capPos: [number, number] = [
        center[0] + jitterR * Math.cos(jitterAngle),
        center[1] + jitterR * Math.sin(jitterAngle),
      ];
      positions.set(capital.convIdx, capPos);
      placed.push(capPos);
    }

    // Major cities: radial 200-400 from capital
    for (const c of cities.filter((x) => x.rank === "city")) {
      const pos = tryPlace(200, 400, 100);
      positions.set(c.convIdx, pos);
      placed.push(pos);
    }

    // Towns: scattered 80-500 (whole cluster), min separation
    for (const c of cities.filter((x) => x.rank === "town")) {
      const pos = tryPlace(80, 500, 100);
      positions.set(c.convIdx, pos);
      placed.push(pos);
    }
  }

  // Recompute country centers as actual centroid of their final cities
  const cAcc: { x: number; y: number; count: number }[] = countryCenters.map(() => ({
    x: 0,
    y: 0,
    count: 0,
  }));
  for (const [convIdx, asgn] of assignments) {
    const p = positions.get(convIdx);
    if (!p) continue;
    cAcc[asgn.countryIdx].x += p[0];
    cAcc[asgn.countryIdx].y += p[1];
    cAcc[asgn.countryIdx].count++;
  }
  const finalCenters: Array<[number, number]> = countryCenters.map(([x, y], i) =>
    cAcc[i].count > 0 ? [cAcc[i].x / cAcc[i].count, cAcc[i].y / cAcc[i].count] : [x, y],
  );

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
  const padding = 130; // generous so biome terrain has room to show
  const irregularity = 0.2;

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

// ── Hierarchical edge bundling ────────────────────────────────────────────────
//
// Real road networks have a hierarchy: highways connect regions, arterials
// connect districts, local streets serve neighbourhoods. Multiple destinations
// SHARE the trunk before branching off near the destination.
//
// We replicate this by routing every road through the (countryCentroid →
// districtCentroid) hierarchy. Roads going between the same district pair
// pass through the same two centroids → their middle segments physically
// coincide → they bundle visually like a real interchange.
//
// We do NOT delete roads — every semantic link the AI identified stays on the
// map. Only exact duplicates (same unordered city pair, possibly multiple
// AI edges) are merged into one (preferring the most important type).

function typeRank(t: "highway" | "regular" | "trail" | "ferry"): number {
  return t === "highway" ? 0 : t === "regular" ? 1 : t === "trail" ? 2 : 3;
}

function edgeKey(fromId: string, toId: string): string {
  return fromId < toId ? `${fromId}::${toId}` : `${toId}::${fromId}`;
}

type RoadCandidate = {
  fromId: string;
  toId: string;
  type: "highway" | "regular" | "trail" | "ferry";
  label: string | null;
  fromConvIdx: number;
  toConvIdx: number;
};

// Compute district + country centroids from the placed cities.
function computeCentroids(
  positions: Map<number, [number, number]>,
  assignments: Map<number, Assignment>,
): {
  districtCentroids: Map<string, [number, number]>; // key = "countryIdx:districtIdx"
  countryCentroids: Map<number, [number, number]>;
} {
  const dGroups = new Map<string, Array<[number, number]>>();
  const cGroups = new Map<number, Array<[number, number]>>();

  for (const [convIdx, asgn] of assignments) {
    const pos = positions.get(convIdx);
    if (!pos) continue;
    const dKey = `${asgn.countryIdx}:${asgn.districtIdx}`;
    if (!dGroups.has(dKey)) dGroups.set(dKey, []);
    dGroups.get(dKey)!.push(pos);
    if (!cGroups.has(asgn.countryIdx)) cGroups.set(asgn.countryIdx, []);
    cGroups.get(asgn.countryIdx)!.push(pos);
  }

  const meanOf = (pts: Array<[number, number]>): [number, number] => [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];

  const districtCentroids = new Map<string, [number, number]>();
  for (const [k, pts] of dGroups) districtCentroids.set(k, meanOf(pts));
  const countryCentroids = new Map<number, [number, number]>();
  for (const [k, pts] of cGroups) countryCentroids.set(k, meanOf(pts));

  return { districtCentroids, countryCentroids };
}

// Compute the bundled waypoint chain for a road.
//   same district           → []                          (direct)
//   same country, diff dist → [districtA, districtB]
//   diff country            → [districtA, countryA, countryB, districtB]
//
// Identical district/country centroids cause adjacent edges to bundle
// physically — they share segments of their Catmull-Rom path.
function bundledWaypoints(
  fromConvIdx: number,
  toConvIdx: number,
  assignments: Map<number, Assignment>,
  districtCentroids: Map<string, [number, number]>,
  countryCentroids: Map<number, [number, number]>,
): Array<[number, number]> {
  const fromAsgn = assignments.get(fromConvIdx);
  const toAsgn = assignments.get(toConvIdx);
  if (!fromAsgn || !toAsgn) return [];

  const fromDKey = `${fromAsgn.countryIdx}:${fromAsgn.districtIdx}`;
  const toDKey = `${toAsgn.countryIdx}:${toAsgn.districtIdx}`;
  if (fromDKey === toDKey) return [];

  const fromDC = districtCentroids.get(fromDKey);
  const toDC = districtCentroids.get(toDKey);

  if (fromAsgn.countryIdx === toAsgn.countryIdx) {
    return [fromDC, toDC].filter((p): p is [number, number] => Array.isArray(p));
  }

  const fromCC = countryCentroids.get(fromAsgn.countryIdx);
  const toCC = countryCentroids.get(toAsgn.countryIdx);
  return [fromDC, fromCC, toCC, toDC].filter((p): p is [number, number] => Array.isArray(p));
}

// Dedupe candidates by unordered city pair, keeping the most important type.
// This is the ONLY pruning we do — every distinct semantic link survives.
function dedupePairs(candidates: RoadCandidate[]): RoadCandidate[] {
  const byPair = new Map<string, RoadCandidate>();
  for (const c of candidates) {
    if (c.fromId === c.toId) continue;
    const k = edgeKey(c.fromId, c.toId);
    const existing = byPair.get(k);
    if (!existing || typeRank(c.type) < typeRank(existing.type)) byPair.set(k, c);
  }
  return Array.from(byPair.values());
}

// ── Force-Directed Edge Bundling ──────────────────────────────────────────────
//
// Holten & van Wijk 2009. Treats each road as a flexible polyline subdivided
// into M segments. Pairs of edges with high "compatibility" (similar bearing,
// length, and midpoint proximity) attract each other along corresponding
// subdivision points. Iterating produces organic bundles where roads heading
// the same direction through the same region physically merge for their
// shared trunk and split at the ends.
//
// Standard FDEB parameters; not tuned to mask issues.

type EdgePath = [number, number][]; // polyline of canvas-space points

function pdist(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

// Resample a polyline into exactly (M+1) evenly spaced points along its length.
function resample(poly: EdgePath, M: number): EdgePath {
  if (poly.length < 2) return poly.slice();
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    const d = pdist(poly[i - 1], poly[i]);
    segLens.push(d);
    total += d;
  }
  if (total === 0) return Array.from({ length: M + 1 }, () => [poly[0][0], poly[0][1]]);
  const step = total / M;
  const out: EdgePath = [[poly[0][0], poly[0][1]]];
  let segIdx = 0;
  let segStart = 0;
  for (let k = 1; k < M; k++) {
    const target = k * step;
    while (segIdx < segLens.length && segStart + segLens[segIdx] < target) {
      segStart += segLens[segIdx];
      segIdx++;
    }
    if (segIdx >= segLens.length) {
      const last = poly[poly.length - 1];
      out.push([last[0], last[1]]);
      continue;
    }
    const t = (target - segStart) / segLens[segIdx];
    const a = poly[segIdx];
    const b = poly[segIdx + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  const last = poly[poly.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

// Compatibility score (0..1): how strongly two edges should attract.
// Standard FDEB: angle × scale × position. Higher = more compatible.
function compatibility(a: EdgePath, b: EdgePath): number {
  const a0 = a[0];
  const a1 = a[a.length - 1];
  const b0 = b[0];
  const b1 = b[b.length - 1];
  const aLen = pdist(a0, a1);
  const bLen = pdist(b0, b1);
  if (aLen < 1e-3 || bLen < 1e-3) return 0;
  const lavg = (aLen + bLen) / 2;

  // Angle compatibility (undirected): |cos(θ)|
  const adx = (a1[0] - a0[0]) / aLen;
  const ady = (a1[1] - a0[1]) / aLen;
  const bdx = (b1[0] - b0[0]) / bLen;
  const bdy = (b1[1] - b0[1]) / bLen;
  const Ca = Math.abs(adx * bdx + ady * bdy);

  // Scale compatibility: 1 if equal length, → 0 as they diverge
  const Cs = 2 / (lavg / Math.min(aLen, bLen) + Math.max(aLen, bLen) / lavg);

  // Position compatibility: 1 if midpoints coincident, → 0 as separation grows
  const aMx = (a0[0] + a1[0]) / 2;
  const aMy = (a0[1] + a1[1]) / 2;
  const bMx = (b0[0] + b1[0]) / 2;
  const bMy = (b0[1] + b1[1]) / 2;
  const midD = Math.sqrt((aMx - bMx) ** 2 + (aMy - bMy) ** 2);
  const Cp = lavg / (lavg + midD);

  return Ca * Cs * Cp;
}

// Run FDEB on a list of polylines. Returns bundled polylines (same shape).
// "Bundled" means roads that fly through the same corridor physically share
// their middle subdivision points — they overlap on the trunk and diverge
// only at the endpoints.
function fdebBundle(
  paths: EdgePath[],
  opts: {
    iterations?: number;
    subdivisions?: number;
    initialStep?: number;
    cooling?: number;
    springK?: number;
    compatibilityThreshold?: number;
  } = {},
): EdgePath[] {
  const iterations = opts.iterations ?? 60;
  const M = opts.subdivisions ?? 8;
  let step = opts.initialStep ?? 0.5;
  const cooling = opts.cooling ?? 0.95;
  const K = opts.springK ?? 0.1;
  const Cthresh = opts.compatibilityThreshold ?? 0.6;

  // Resample every path to (M+1) points
  const sub: EdgePath[] = paths.map((p) => resample(p, M));
  const N = sub.length;

  // Pre-compute compatible pairs (compatibility uses original endpoints, stable)
  type CPair = { i: number; j: number; w: number };
  const pairs: CPair[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const w = compatibility(sub[i], sub[j]);
      if (w > Cthresh) pairs.push({ i, j, w });
    }
  }

  // Iterate: attractive force between corresponding interior points of
  // compatible edges, plus spring force keeping each path "smooth".
  for (let iter = 0; iter < iterations; iter++) {
    // Accumulate displacements (don't update in-place mid-iteration)
    const dx: number[][] = sub.map((p) => p.map(() => 0));
    const dy: number[][] = sub.map((p) => p.map(() => 0));

    for (const { i, j, w } of pairs) {
      const Pi = sub[i];
      const Pj = sub[j];
      for (let k = 1; k < Pi.length - 1; k++) {
        const ddx = Pj[k][0] - Pi[k][0];
        const ddy = Pj[k][1] - Pi[k][1];
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < 1e-3) continue;
        // Inverse-distance attractive force, scaled by compatibility
        const f = (w * step) / Math.max(d, 8);
        dx[i][k] += ddx * f;
        dy[i][k] += ddy * f;
        dx[j][k] -= ddx * f;
        dy[j][k] -= ddy * f;
      }
    }

    // Spring force: pull each interior point toward the midpoint of its
    // neighbours. Keeps the polyline taut.
    for (let i = 0; i < N; i++) {
      const P = sub[i];
      for (let k = 1; k < P.length - 1; k++) {
        const mx = (P[k - 1][0] + P[k + 1][0]) / 2;
        const my = (P[k - 1][1] + P[k + 1][1]) / 2;
        dx[i][k] += (mx - P[k][0]) * K;
        dy[i][k] += (my - P[k][1]) * K;
      }
    }

    // Apply
    for (let i = 0; i < N; i++) {
      const P = sub[i];
      for (let k = 1; k < P.length - 1; k++) {
        P[k][0] += dx[i][k];
        P[k][1] += dy[i][k];
      }
    }

    step *= cooling;
  }

  return sub;
}


// ── Main ──────────────────────────────────────────────────────────────────────

export type TerraformResult = {
  countriesCreated: number;
  citiesCreated: number;
  roadsCreated: number;
  roadsCandidates: number; // before pruning — useful to see how aggressive the filter was
  conversationsPlaced: number;
  conversationsSkipped: number;
};

// Per-skip metadata returned to the client for the confirmation modal.
export type SkipItem = {
  convIdx: number;
  convId: string;
  title: string | null;
  reason: string;
};

// Result of the preview pass: cartographer proposal + skip lists derived
// from the user directive. The client uses this to render the confirmation
// modal and posts back the chosen skipConvIdx[] on commit.
export type TerraformPreview = {
  aiResult: AiResult;
  // Conversation IDs in the order they were given to the LLM. Sent back on
  // commit so we can detect whether the underlying conversation set changed
  // between preview and commit (in which case the cached aiResult is stale).
  conversationIds: string[];
  skipDefinitive: SkipItem[];
  skipAmbiguous: SkipItem[];
};

// Two terraform modes:
//   A) Fresh: leave aiResult unset; LLM runs with `directive`.
//   B) From preview: pass `aiResult` + `skipConvIdx`; LLM is NOT re-called.
export type TerraformInput = {
  aiResult?: AiResult;
  skipConvIdx?: number[];
  directive?: string | null;
};

async function loadConvInputs(mapId: string): Promise<ConvInput[]> {
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
    // Cap to keep terraform from running indefinitely on huge backlogs.
    // Batched cartography (clusterBatched) handles up to a few thousand at
    // ~$0.30 / 10 minutes for DeepSeek R1; beyond that we'd want a UI for
    // selecting a subset rather than implicitly truncating.
    take: 2000,
  });

  return allConvs.map((c) => {
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
}

// Preview: run the cartographer LLM only, persist the directive, return the
// proposal plus structured skip lists for the confirmation UI. No geography
// is written to the DB until the client follows up with terraform(... opts).
export async function terraformPreview(
  mapId: string,
  ai: AiClient,
  directive: string | null,
): Promise<TerraformPreview> {
  const inputs = await loadConvInputs(mapId);

  await prisma.map.update({
    where: { id: mapId },
    data: { exclusionDirective: directive?.trim() ? directive.trim() : null },
  });

  if (inputs.length === 0) {
    return {
      aiResult: { countries: [], cities: [] },
      conversationIds: [],
      skipDefinitive: [],
      skipAmbiguous: [],
    };
  }

  const aiResult = await clusterSmart(inputs, ai, directive);

  const enrich = (item: AiSkipItem): SkipItem | null => {
    const i = item.conversationIndex;
    if (!Number.isInteger(i) || i < 0 || i >= inputs.length) return null;
    return {
      convIdx: i,
      convId: inputs[i].id,
      title: inputs[i].title,
      reason: typeof item.reason === "string" ? item.reason : "",
    };
  };

  const skipDefinitive = (aiResult.skipDefinitive ?? [])
    .map(enrich)
    .filter((x): x is SkipItem => x !== null);
  const skipAmbiguous = (aiResult.skipAmbiguous ?? [])
    .map(enrich)
    .filter((x): x is SkipItem => x !== null);

  return {
    aiResult,
    conversationIds: inputs.map((c) => c.id),
    skipDefinitive,
    skipAmbiguous,
  };
}

export async function terraform(
  mapId: string,
  ai: AiClient,
  opts: TerraformInput = {},
): Promise<TerraformResult> {
  const inputs = await loadConvInputs(mapId);

  if (inputs.length === 0) {
    return {
      countriesCreated: 0,
      citiesCreated: 0,
      roadsCreated: 0,
      roadsCandidates: 0,
      conversationsPlaced: 0,
      conversationsSkipped: 0,
    };
  }

  // Use the cartographer's preview output if provided; otherwise call the LLM
  // (single call for small maps, iterative batched for large ones).
  const aiResult =
    opts.aiResult ?? (await clusterSmart(inputs, ai, opts.directive ?? null));

  // Persist the directive on this fresh path too, so re-terraform pre-fills it.
  if (opts.directive !== undefined) {
    await prisma.map.update({
      where: { id: mapId },
      data: {
        exclusionDirective: opts.directive?.trim() ? opts.directive.trim() : null,
      },
    });
  }

  const assignments = assignAll(aiResult, inputs.length);

  // Layer 2 skip: drop these conversations from city placement. Roads
  // referencing them won't be created (cityIdByConvIdx miss); any country
  // emptied by skipping is dropped at the country-creation step.
  const skipSet = new Set(opts.skipConvIdx ?? []);
  for (const idx of skipSet) assignments.delete(idx);
  const conversationsSkipped = skipSet.size;

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

  // ── Structured road network (per the user's spec) ──
  //   1. Highways: MST + α between every country's capital
  //   2. Main arterials: within each country, capital → each major city (radial)
  //   3. Collectors: each major city → 1 nearest other major; each town → nearest major
  //
  // Roads are stored as straight lines (no waypoints). MST + radial layout has
  // no loops by construction, no parallel-near-overlap by construction.

  type CityRecord = {
    convIdx: number;
    cityId: string;
    rank: "capital" | "city" | "town";
    pos: [number, number];
    countryIdx: number;
  };

  const allCityRecords: CityRecord[] = [];
  for (const [convIdx, asgn] of assignments) {
    const cityId = cityIdByConvIdx.get(convIdx);
    const pos = positions.get(convIdx);
    if (!cityId || !pos) continue;
    const aiCity = aiResult.cities.find((c) => c.conversationIndex === convIdx);
    allCityRecords.push({
      convIdx,
      cityId,
      rank: aiCity?.rank ?? "town",
      pos,
      countryIdx: asgn.countryIdx,
    });
  }

  const candidates: RoadCandidate[] = [];

  // Group cities by country for arterials and collectors
  const recordsByCountry = new Map<number, CityRecord[]>();
  for (const r of allCityRecords) {
    if (!recordsByCountry.has(r.countryIdx)) recordsByCountry.set(r.countryIdx, []);
    recordsByCountry.get(r.countryIdx)!.push(r);
  }

  // Step 1: highway network — MST + α between capitals (one per country)
  const capitals: CityRecord[] = [];
  for (const records of recordsByCountry.values()) {
    const cap = records.find((r) => r.rank === "capital");
    if (cap) capitals.push(cap);
  }
  if (capitals.length >= 2) {
    type CapEdge = { i: number; j: number; d: number };
    const allCapEdges: CapEdge[] = [];
    for (let i = 0; i < capitals.length; i++) {
      for (let j = i + 1; j < capitals.length; j++) {
        allCapEdges.push({ i, j, d: pdist(capitals[i].pos, capitals[j].pos) });
      }
    }
    allCapEdges.sort((a, b) => a.d - b.d);

    // Kruskal's MST
    const parent = capitals.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const mstPicks: CapEdge[] = [];
    const restPicks: CapEdge[] = [];
    for (const e of allCapEdges) {
      const ra = find(e.i);
      const rb = find(e.j);
      if (ra !== rb) {
        parent[ra] = rb;
        mstPicks.push(e);
      } else {
        restPicks.push(e);
      }
    }
    // α: 1-2 extra cheapest non-MST edges so the highway graph isn't a strict tree
    const alpha = Math.min(2, Math.max(0, Math.floor(capitals.length / 3)));
    const allHighwayEdges = [...mstPicks, ...restPicks.slice(0, alpha)];
    for (const e of allHighwayEdges) {
      const a = capitals[e.i];
      const b = capitals[e.j];
      candidates.push({
        fromId: a.cityId,
        toId: b.cityId,
        type: "highway",
        label: "national highway",
        fromConvIdx: a.convIdx,
        toConvIdx: b.convIdx,
      });
    }
  }

  // Step 2: within each country, capital → each major city (radial arterials)
  for (const records of recordsByCountry.values()) {
    const cap = records.find((r) => r.rank === "capital");
    if (!cap) continue;
    for (const r of records) {
      if (r.rank !== "city") continue;
      candidates.push({
        fromId: cap.cityId,
        toId: r.cityId,
        type: "regular",
        label: "main arterial",
        fromConvIdx: cap.convIdx,
        toConvIdx: r.convIdx,
      });
    }
  }

  // Step 3: collectors — each major city → 1 nearest major (city or capital);
  //                       each town → nearest major
  for (const records of recordsByCountry.values()) {
    const majors = records.filter((r) => r.rank === "city" || r.rank === "capital");
    const towns = records.filter((r) => r.rank === "town");

    // City ↔ city (1 nearest non-capital pair; dedupe later collapses repeats)
    for (const m of majors) {
      if (m.rank !== "city") continue; // start from cities; pair with nearest other major
      const others = majors.filter((x) => x.cityId !== m.cityId);
      if (others.length === 0) continue;
      others.sort((a, b) => pdist(m.pos, a.pos) - pdist(m.pos, b.pos));
      const nearest = others[0];
      candidates.push({
        fromId: m.cityId,
        toId: nearest.cityId,
        type: "trail",
        label: "collector",
        fromConvIdx: m.convIdx,
        toConvIdx: nearest.convIdx,
      });
    }

    // Each town → nearest major
    for (const t of towns) {
      if (majors.length === 0) continue;
      let nearest = majors[0];
      let minD = pdist(t.pos, nearest.pos);
      for (let i = 1; i < majors.length; i++) {
        const d = pdist(t.pos, majors[i].pos);
        if (d < minD) {
          minD = d;
          nearest = majors[i];
        }
      }
      candidates.push({
        fromId: t.cityId,
        toId: nearest.cityId,
        type: "trail",
        label: "local road",
        fromConvIdx: t.convIdx,
        toConvIdx: nearest.convIdx,
      });
    }
  }

  // Dedupe identical pairs (e.g. city-A→city-B added from both sides)
  const finalRoads = dedupePairs(candidates);

  const roadIds: string[] = [];
  for (const r of finalRoads) {
    const road = await prisma.road.create({
      data: {
        mapId,
        fromId: r.fromId,
        toId: r.toId,
        type: r.type,
        label: r.label,
        // No waypoints — straight line from city to city (no intermediate trunks).
        // The structured network (MST + radial + collectors) doesn't need bundling.
      },
      select: { id: true },
    });
    roadIds.push(road.id);
  }

  return {
    countriesCreated: countryIdByIdx.size,
    citiesCreated: cityIdByConvIdx.size,
    roadsCreated: roadIds.length,
    roadsCandidates: candidates.length,
    conversationsPlaced: cityIdByConvIdx.size,
    conversationsSkipped,
  };
}
