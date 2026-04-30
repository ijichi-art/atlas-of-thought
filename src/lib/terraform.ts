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

// Categorical POI kind. Drives the pin color in the renderer so cluster
// cities mix Google-Maps-style red/purple/blue pins instead of a swarm of
// identical dots. Validated against this whitelist before persistence —
// the LLM occasionally hallucinates extras.
export type AiCityKind =
  | "code"
  | "research"
  | "personal"
  | "question"
  | "creative"
  | "decision";

type AiCity = {
  conversationIndex: number;
  topic: string;
  topicJa?: string;
  summary: string;
  rank: "capital" | "city" | "town";
  kind?: AiCityKind;
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
  // Districts already minted in earlier batches, grouped by their country.
  // Subsequent batches are told to reuse these names whenever a sub-theme
  // matches, otherwise create new ones — same dedup pattern as countries.
  existingDistricts: Array<{ countryName: string; name: string }>;
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

  // District-level seed. Same idea as countries: keep the LLM from inventing
  // a new "Auth Quarter" / "Authentication Section" name for what's already
  // an existing "Auth" district. Without this, batches end up with hundreds
  // of fragmented near-duplicates that don't merge cleanly.
  const existingDistrictsBlock =
    batchCtx && batchCtx.existingDistricts.length > 0
      ? `

EXISTING DISTRICTS (sub-themes within the countries above — REUSE these district names verbatim when a conversation's sub-theme matches):
${(() => {
  const grouped = new Map<string, string[]>();
  for (const d of batchCtx.existingDistricts) {
    const arr = grouped.get(d.countryName) ?? [];
    arr.push(d.name);
    grouped.set(d.countryName, arr);
  }
  return Array.from(grouped.entries())
    .map(([country, names]) => `  ${country}: ${names.map((n) => `"${n}"`).join(", ")}`)
    .join("\n");
})()}

Rules for using existing districts:
- ALWAYS check whether a conversation fits an existing district BEFORE inventing a new one.
- Reuse district names VERBATIM (case-sensitive). "Auth" and "Authentication" are NOT the same — use whichever matches.
- Only create a NEW district when no existing district covers the conversation's sub-theme.
- Aim for FEW BROAD districts (5-20 conversations each), not many tiny ones.`
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
${convList}${batchHeader}${existingCountriesBlock}${existingDistrictsBlock}

Build a hierarchical map of these conversations.

LEVEL 1 — COUNTRIES (themes):
- Group ALL ${convs.length} conversations into 3-${maxCountries} thematic countries.
- Each country: a Latin/Greek-inspired single-word name (Architectura, Cognitio, Machina, Forum, Sylva, Aether, Nautica, Industria, Mercatus, Eloquentia…) and an optional Japanese single-word.
- Theme: 3-7 word description.
- Color: pick from ${colorList}.
- Neighbors: array of 1-3 country indices (other than itself) that are most thematically related — these will be drawn adjacent on the map.

LEVEL 2 — DISTRICTS (sub-themes within a country):
- Each country has 1-3 BROAD districts. Prefer fewer, larger districts.
- Each district has a name (English + optional Japanese) and lists which conversation indices belong to it.
- A district groups 5-20 conversations sharing a clear sub-theme.
- IMPORTANT: this batch will be merged with output from other batches. To avoid the same sub-theme being split into many tiny variants ("Auth", "Authentication", "Auth Quarter"), keep district names short, generic, and consistent.
- EVERY conversation index 0..${convs.length - 1} must appear in EXACTLY ONE district across all countries combined.

LEVEL 3 — CITIES (one per conversation):
- Topic: 3-6 word phrase capturing the conversation's gist.
- TopicJa: optional Japanese phrase.
- Summary: ONE concise sentence about what was discussed and concluded.
- Rank: "capital" for the most substantial conversation in its country (only ONE per country); "city" for medium; "town" for short or peripheral.
- Kind: ONE of these six values, picking the BEST single fit:
    "code"      — programming, debugging, implementation, technical setup
    "research"  — investigating, learning, exploring a topic in depth
    "personal"  — life, social, hobbies, casual chitchat
    "question"  — short factual Q&A, single-turn lookups
    "creative"  — writing, design, ideation, naming, copywriting
    "decision"  — planning, choosing between options, deciding next steps
  Pick exactly one; this drives the POI pin color on the map.

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
      "rank": "capital",
      "kind": "code"
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
    // Flat list of districts already minted so the LLM can reuse names
    // instead of inventing near-duplicates ("Auth" / "Authentication" /
    // "Auth Quarter").
    const existingDistricts: Array<{ countryName: string; name: string }> = [];
    for (const country of accCountriesByKey.values()) {
      for (const d of country.districts) {
        existingDistricts.push({ countryName: country.name, name: d.name });
      }
    }

    const batchT0 = Date.now();
    console.log(
      `[clusterBatched] batch ${bi + 1}/${batches.length} starting (${batch.length} convs, ${existingCountries.length} existing countries)`,
    );

    // One bad batch shouldn't kill the whole terraform. Log and continue with
    // an empty contribution if the LLM hiccups for one batch — the user gets
    // a slightly thinner map, not a 500.
    let batchResult: AiResult;
    try {
      batchResult = await clusterWithAI(batch, ai, directive, {
        existingCountries,
        existingDistricts,
        batchNumber: bi + 1,
        totalBatches: batches.length,
        globalConvCount: inputs.length,
        maxCountriesTotal: MAX_COUNTRIES_TOTAL,
      });
    } catch (err) {
      console.error(
        `[clusterBatched] batch ${bi + 1}/${batches.length} failed after ${((Date.now() - batchT0) / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    console.log(
      `[clusterBatched] batch ${bi + 1}/${batches.length} done in ${((Date.now() - batchT0) / 1000).toFixed(1)}s — countries=${batchResult.countries?.length ?? 0} cities=${batchResult.cities?.length ?? 0} edges=${batchResult.edges?.length ?? 0}`,
    );

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
      // Merge this batch's districts into the existing country, deduping
      // by lowercased trimmed name. Without this, a district like "Auth"
      // appearing in batch 1 and batch 5 would create TWO separate clusters
      // — yielding 474 fragmented clusters for the 1559-conv map. Real-
      // metro scale is ~80-120 clusters; deduping collapses fragments back
      // to that range.
      for (const d of c.districts ?? []) {
        const dKey = (d.name ?? "").toLowerCase().trim();
        if (!dKey) continue;
        const remappedCityIndexes = (d.cityIndexes ?? [])
          .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < batch.length)
          .map((i) => i + batchOffset);
        const existingDistrict = existing.districts.find(
          (e) => (e.name ?? "").toLowerCase().trim() === dKey,
        );
        if (existingDistrict) {
          existingDistrict.cityIndexes = [
            ...existingDistrict.cityIndexes,
            ...remappedCityIndexes,
          ];
        } else {
          existing.districts.push({
            name: d.name,
            nameJa: d.nameJa,
            cityIndexes: remappedCityIndexes,
          });
        }
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

  const districtCount = Array.from(accCountriesByKey.values()).reduce(
    (s, c) => s + c.districts.length,
    0,
  );
  console.log(
    `[clusterBatched] DONE — accumulated countries=${accCountriesByKey.size} districts=${districtCount} cities=${accCities.length} edges=${accEdges.length} (${batches.length} batches over ${inputs.length} convs)`,
  );

  let result: AiResult = {
    countries: insertionOrder.map((k) => accCountriesByKey.get(k)!),
    cities: accCities,
    edges: accEdges,
    skipDefinitive: accSkipDefinitive.length > 0 ? accSkipDefinitive : undefined,
    skipAmbiguous: accSkipAmbiguous.length > 0 ? accSkipAmbiguous : undefined,
  };

  // Post-batch consolidation: per-batch dedupe (existingDistricts seeding)
  // catches verbatim name reuse but not near-duplicates with slightly
  // different wording. One last LLM call sees the full district list and
  // proposes a target-sized merge map. For 1559-conv input we want ~80-120
  // districts (LA-metro scale).
  const TARGET_DISTRICTS = Math.max(60, Math.min(120, Math.round(inputs.length / 15)));
  if (districtCount > TARGET_DISTRICTS * 1.5) {
    console.log(
      `[clusterBatched] consolidating ${districtCount} districts → target ~${TARGET_DISTRICTS}`,
    );
    try {
      result = await consolidateDistricts(result, ai, TARGET_DISTRICTS);
      const newDistrictCount = result.countries.reduce(
        (s, c) => s + (c.districts ?? []).length,
        0,
      );
      console.log(
        `[clusterBatched] consolidation done — districts ${districtCount} → ${newDistrictCount}`,
      );
    } catch (err) {
      console.error(
        `[clusterBatched] consolidation failed (proceeding with un-consolidated districts): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

// Single LLM call to merge near-duplicate districts within each country into
// a smaller, target-count set. Keeps the country boundary inviolable — only
// districts within the same country can be merged. The mapping the LLM
// returns is applied by reassigning each district's cityIndexes to its
// merged-into successor.
async function consolidateDistricts(
  result: AiResult,
  ai: AiClient,
  targetCount: number,
): Promise<AiResult> {
  // Build a flat numbered list with country index + district index + name +
  // size, so the LLM can identify each one unambiguously.
  type DistrictRef = {
    countryIdx: number;
    districtIdx: number;
    name: string;
    size: number;
  };
  const flat: DistrictRef[] = [];
  for (let ci = 0; ci < result.countries.length; ci++) {
    const districts = result.countries[ci].districts ?? [];
    for (let di = 0; di < districts.length; di++) {
      flat.push({
        countryIdx: ci,
        districtIdx: di,
        name: districts[di].name,
        size: (districts[di].cityIndexes ?? []).length,
      });
    }
  }
  if (flat.length <= targetCount) return result;

  const countryList = result.countries
    .map((c, i) => `${i}: ${c.name} — ${c.theme}`)
    .join("\n");
  const districtList = flat
    .map(
      (d, i) =>
        `${i}: country=${d.countryIdx} ("${result.countries[d.countryIdx].name}") name="${d.name}" convs=${d.size}`,
    )
    .join("\n");

  const system = `You are consolidating district names in a hierarchical "map of mind". Multiple batches independently named clusters and produced near-duplicates ("Auth", "Authentication", "Auth Quarter") that mean the same thing. Merge them. Output JSON only — no markdown or commentary.`;
  const user = `COUNTRIES:
${countryList}

DISTRICTS (${flat.length} total — target after merge: ~${targetCount}):
${districtList}

Task: within each country, group near-duplicate districts into broader merged districts. Output a "groups" array — one entry per merged district, each entry listing the input district indices that should fold into it.

Rules:
- NEVER merge across countries. Only districts in the same country merge.
- Keep districts genuinely distinct: only merge near-duplicates, not unrelated sub-themes.
- Pick the most representative input name as the merged name (or coin a clearer one).
- Aim for the target total count (~${targetCount}). It's OK to be a bit over or under.

Output JSON, this exact shape:
{
  "groups": [
    { "fromIndexes": [0, 1, 7], "toName": "Authentication", "toNameJa": "認証" },
    { "fromIndexes": [2], "toName": "Storage", "toNameJa": "記憶" },
    ...
  ]
}

Every input district index 0..${flat.length - 1} must appear in EXACTLY ONE group.`;

  let raw = "";
  for await (const chunk of ai.stream({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 32000,
    jsonMode: true,
  })) {
    raw += chunk;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`consolidator returned no JSON. Got: ${raw.slice(0, 300)}`);

  let parsed: { groups?: Array<{ fromIndexes?: number[]; toName?: string; toNameJa?: string }> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    const repaired = repairTruncatedJson(jsonMatch[0]);
    if (!repaired) throw new Error("consolidator returned malformed JSON");
    parsed = repaired as typeof parsed;
  }

  const groups = parsed.groups ?? [];
  if (groups.length === 0) return result;

  // Build new districts per country by applying groups.
  const newCountries: AiCountry[] = result.countries.map((c) => ({
    ...c,
    districts: [],
  }));
  // Track which input districts have been processed.
  const consumed = new Set<string>(); // key = "countryIdx:districtIdx"
  for (const g of groups) {
    if (!Array.isArray(g.fromIndexes) || g.fromIndexes.length === 0) continue;
    // Map fromIndexes back to (countryIdx, districtIdx) tuples and validate
    // they all belong to the same country.
    const refs = g.fromIndexes
      .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < flat.length)
      .map((i) => flat[i]);
    if (refs.length === 0) continue;
    const countryIdx = refs[0].countryIdx;
    if (!refs.every((r) => r.countryIdx === countryIdx)) continue; // cross-country merges are invalid
    // Concat cityIndexes from all source districts.
    const mergedCityIndexes: number[] = [];
    for (const r of refs) {
      consumed.add(`${r.countryIdx}:${r.districtIdx}`);
      const src = result.countries[r.countryIdx].districts?.[r.districtIdx];
      if (src) mergedCityIndexes.push(...(src.cityIndexes ?? []));
    }
    newCountries[countryIdx].districts.push({
      name: g.toName ?? refs[0].name,
      nameJa: g.toNameJa,
      cityIndexes: mergedCityIndexes,
    });
  }
  // Any input district not covered by a group survives unchanged — the LLM
  // sometimes drops items, but we shouldn't lose conversations.
  for (let ci = 0; ci < result.countries.length; ci++) {
    const districts = result.countries[ci].districts ?? [];
    for (let di = 0; di < districts.length; di++) {
      if (!consumed.has(`${ci}:${di}`)) {
        newCountries[ci].districts.push({ ...districts[di] });
      }
    }
  }

  return { ...result, countries: newCountries };
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

  // ── Step 1: country centers ────────────────────────────────────────────────
  // Force-directed layout for country anchors. The previous version capped
  // distance-from-center at 280px, leaving the outer 65% of the canvas
  // unused — every country crammed into a 560×560 box. Now countries spread
  // across the full canvas with edge-margin clamping instead.
  const Nc = ai.countries.length;
  const ringR = Math.min(VIEW_W, VIEW_H) * 0.32;
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
    .force("repel", forceManyBody().strength(-2200))
    .force("center", forceCenter(CX, CY).strength(0.04))
    .force("collide", forceCollide(180))
    .force("attract", () => {
      for (const l of links) {
        const dx = (l.target.x ?? 0) - (l.source.x ?? 0);
        const dy = (l.target.y ?? 0) - (l.source.y ?? 0);
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 280) * 0.06 * l.strength;
        l.source.x = (l.source.x ?? 0) + (dx / d) * f;
        l.source.y = (l.source.y ?? 0) + (dy / d) * f;
        l.target.x = (l.target.x ?? 0) - (dx / d) * f;
        l.target.y = (l.target.y ?? 0) - (dy / d) * f;
      }
    })
    .stop();
  for (let t = 0; t < 300; t++) cSim.tick();

  // Clamp to canvas with margin (countries need room for their clusters).
  const COUNTRY_MARGIN = 200;
  for (const node of countryNodes) {
    node.x = Math.max(COUNTRY_MARGIN, Math.min(VIEW_W - COUNTRY_MARGIN, node.x ?? CX));
    node.y = Math.max(COUNTRY_MARGIN, Math.min(VIEW_H - COUNTRY_MARGIN, node.y ?? CY));
  }
  let countryCenters: Array<[number, number]> = countryNodes.map((n) => [n.x ?? CX, n.y ?? CY]);

  // ── Step 2: cluster city placement (the key fix) ──────────────────────────
  // Each LLM district becomes a cluster city. We treat the cluster — NOT the
  // individual conversation — as the first-class layout entity. Each cluster
  // is a node in a force simulation:
  //   - country pull keeps clusters inside their country region
  //   - collide based on builtUpR keeps cluster disks from overlapping
  //   - cross-cluster spring (LLM edges) pulls semantically related clusters
  //     together (especially across countries — the "long cross-canvas
  //     spaghetti road" problem)
  //
  // Conversations (POIs) are then trivially scattered inside their cluster's
  // disk in Step 3 — no inter-POI separation needed because they live in
  // the same neighborhood.
  type ClusterNode = SimulationNodeDatum & {
    countryIdx: number;
    districtIdx: number;
    convIndices: number[];
    builtUpR: number;
  };
  const clusters: ClusterNode[] = [];
  // Map from convIdx → its cluster (so we can wire LLM edges).
  const clusterByConvIdx = new Map<number, ClusterNode>();
  for (let ci = 0; ci < ai.countries.length; ci++) {
    const districts = ai.countries[ci].districts ?? [];
    for (let di = 0; di < districts.length; di++) {
      const idxs = (districts[di].cityIndexes ?? []).filter(
        (i): i is number => Number.isInteger(i) && i >= 0,
      );
      if (idxs.length === 0) continue;
      // Same formula as terraform persistence so layout matches render size.
      const builtUpR = Math.max(60, 32 * Math.sqrt(idxs.length));
      // Initial position: jittered around country center.
      const jitter = mulberry32(seed + ci * 9871 + di * 113);
      const ang = jitter() * Math.PI * 2;
      const dist = jitter() * 60;
      const node: ClusterNode = {
        countryIdx: ci,
        districtIdx: di,
        convIndices: idxs,
        builtUpR,
        x: countryCenters[ci][0] + Math.cos(ang) * dist,
        y: countryCenters[ci][1] + Math.sin(ang) * dist,
      };
      clusters.push(node);
      for (const idx of idxs) clusterByConvIdx.set(idx, node);
    }
  }

  // Cluster-level edge springs from LLM edges.
  type ClusterLink = { source: ClusterNode; target: ClusterNode; strength: number };
  const clusterLinks: ClusterLink[] = [];
  for (const e of ai.edges ?? []) {
    const s = clusterByConvIdx.get(e.fromCity);
    const t = clusterByConvIdx.get(e.toCity);
    if (!s || !t || s === t) continue;
    const sameCountry = s.countryIdx === t.countryIdx;
    // Cross-country edges pull harder (those are the cross-canvas roads
    // we need to compress); same-country edges pull weakly because the
    // country-pull force already keeps siblings close.
    clusterLinks.push({
      source: s,
      target: t,
      strength: sameCountry ? 0.05 : 0.25,
    });
  }

  const clusterSim = forceSimulation<ClusterNode>(clusters)
    // Country pull: each cluster gets pulled toward its country center.
    .force("country", () => {
      for (const c of clusters) {
        const center = countryCenters[c.countryIdx];
        const dx = center[0] - (c.x ?? 0);
        const dy = center[1] - (c.y ?? 0);
        c.x = (c.x ?? 0) + dx * 0.05;
        c.y = (c.y ?? 0) + dy * 0.05;
      }
    })
    // Cluster collide: disks shouldn't overlap. Slightly bigger than
    // builtUpR so there's a visible "street" margin between cluster cores.
    .force("collide", forceCollide<ClusterNode>((d) => d.builtUpR * 1.05).strength(0.9))
    // Cluster repel: long-range push so clusters spread out nicely.
    .force("repel", forceManyBody().strength(-300))
    // Edge attraction.
    .force("edges", () => {
      for (const l of clusterLinks) {
        const dx = (l.target.x ?? 0) - (l.source.x ?? 0);
        const dy = (l.target.y ?? 0) - (l.source.y ?? 0);
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        // Target distance: clusters touching with a small gap.
        const targetLen = (l.source.builtUpR + l.target.builtUpR) * 1.15;
        const f = (d - targetLen) * l.strength;
        l.source.x = (l.source.x ?? 0) + (dx / d) * f * 0.5;
        l.source.y = (l.source.y ?? 0) + (dy / d) * f * 0.5;
        l.target.x = (l.target.x ?? 0) - (dx / d) * f * 0.5;
        l.target.y = (l.target.y ?? 0) - (dy / d) * f * 0.5;
      }
    })
    // Canvas edge: keep clusters inside the canvas (with builtUpR margin).
    .force("canvas", () => {
      for (const c of clusters) {
        const m = c.builtUpR + 30;
        if ((c.x ?? 0) < m) c.x = m;
        if ((c.x ?? 0) > VIEW_W - m) c.x = VIEW_W - m;
        if ((c.y ?? 0) < m) c.y = m;
        if ((c.y ?? 0) > VIEW_H - m) c.y = VIEW_H - m;
      }
    })
    .stop();

  // Run for plenty of ticks — cluster sim is small (≤ 150 nodes) so cheap.
  for (let t = 0; t < 400; t++) clusterSim.tick();

  // ── Step 3: POI scatter inside cluster disks ──────────────────────────────
  // Each conversation lands at a random point inside its cluster's built-up
  // disk (sqrt-distributed for uniform area density). No inter-POI
  // separation is enforced — they live in the same cluster, allowed to
  // be close together (matches Manhattan POI density).
  const positions = new Map<number, [number, number]>();
  for (const c of clusters) {
    let s = (deterministicSeed([`cluster-${c.countryIdx}-${c.districtIdx}`]) ^ 0xdeadbeef) >>> 0;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    for (const convIdx of c.convIndices) {
      // sqrt for uniform-area distribution; 0.05 inner padding.
      const r = Math.sqrt(0.05 + 0.95 * next()) * c.builtUpR * 0.85;
      const ang = next() * Math.PI * 2;
      positions.set(convIdx, [
        (c.x ?? 0) + Math.cos(ang) * r,
        (c.y ?? 0) + Math.sin(ang) * r,
      ]);
    }
  }

  // Recompute country centers as the centroid of THEIR clusters' final
  // positions — used downstream for country polygon construction.
  const cAcc: { x: number; y: number; count: number }[] = countryCenters.map(() => ({
    x: 0, y: 0, count: 0,
  }));
  for (const c of clusters) {
    cAcc[c.countryIdx].x += c.x ?? 0;
    cAcc[c.countryIdx].y += c.y ?? 0;
    cAcc[c.countryIdx].count++;
  }
  const finalCenters: Array<[number, number]> = countryCenters.map((cur, i) =>
    cAcc[i].count > 0 ? [cAcc[i].x / cAcc[i].count, cAcc[i].y / cAcc[i].count] : cur,
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

  // Wipe existing geography. Roads first (FK to Place), then Places, then
  // we'll let cascades clean PlaceConversation rows.
  await prisma.$transaction([
    prisma.road.deleteMany({ where: { mapId } }),
    prisma.place.deleteMany({ where: { mapId } }),
  ]);

  // Phase 1 keeps the existing "1 conv = 1 city" model — we just persist
  // every level=country and level=city node as a Place row. Phase 2 will
  // add the real cluster-with-POIs hierarchy (multiple convs per city).
  // Schema-wise the new Place table can already represent that; this layer
  // is intentionally still flat to keep the diff focused.

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
    // Country anchor = centroid of its city positions.
    const cx = cityPositions.reduce((s, p) => s + p[0], 0) / cityPositions.length;
    const cy = cityPositions.reduce((s, p) => s + p[1], 0) / cityPositions.length;
    const country = await prisma.place.create({
      data: {
        mapId,
        level: "country",
        name: c.name,
        nameJa: c.nameJa ?? null,
        theme: c.theme ?? null,
        color: c.color || COUNTRY_COLORS[i % COUNTRY_COLORS.length],
        polygon,
        positionX: cx,
        positionY: cy,
        ordinal: i,
      },
      select: { id: true },
    });
    countryIdByIdx.set(i, country.id);
  }

  // Phase 2: each LLM "district" becomes a level=city Place — i.e. a CLUSTER
  // of related conversations rather than a single conversation. Conversations
  // attach as POIs to their cluster city via PlaceConversation.
  //
  // The aiResult.cities[] (per-conv topic / summary / rank) becomes per-POI
  // metadata: rank stays advisory for label-prominence, but the structural
  // place hierarchy is country → city.
  let cityOrdinal = 0;
  // Map from (countryIdx + ":" + districtIdx) → place.id of the city.
  const cityIdByDistrict = new Map<string, string>();
  // Track each city's POI conv positions so we can compute its centroid /
  // built-up radius.
  const poisByDistrict = new Map<string, Array<{ convIdx: number; pos: [number, number] }>>();

  for (const [convIdx, asgn] of assignments) {
    const pos = positions.get(convIdx);
    if (!pos) continue;
    const key = `${asgn.countryIdx}:${asgn.districtIdx}`;
    const arr = poisByDistrict.get(key) ?? [];
    arr.push({ convIdx, pos });
    poisByDistrict.set(key, arr);
  }

  for (const [key, pois] of poisByDistrict) {
    const [cIdxStr, dIdxStr] = key.split(":");
    const countryIdx = Number(cIdxStr);
    const districtIdx = Number(dIdxStr);
    const countryId = countryIdByIdx.get(countryIdx);
    if (!countryId) continue;
    const district = aiResult.countries[countryIdx]?.districts?.[districtIdx];
    if (!district) continue;

    // Centroid of POI positions = city anchor.
    const cx = pois.reduce((s, p) => s + p.pos[0], 0) / pois.length;
    const cy = pois.reduce((s, p) => s + p.pos[1], 0) / pois.length;
    // Built-up radius scales with POI count (sqrt so it doesn't explode for
    // large clusters). Larger floor + multiplier than v1 — the user wants
    // cities to feel substantial and contain their POIs visibly rather
    // than being tiny pinhead-sized disks at default zoom.
    //   1 POI:   max(60, 32) = 60
    //   5 POIs:  max(60, 72) = 72
    //   20 POIs: 143
    //   50 POIs: 226
    const builtUpR = Math.max(60, 32 * Math.sqrt(pois.length));

    // Determine the cluster's "capital" POI (LLM-flagged in aiResult.cities,
    // falling back to the most-substantial conversation by message count).
    let cityRank: "capital" | "city" | "town" = "town";
    const capitalConv = pois.find((p) => {
      const ai = aiResult.cities.find((c) => c.conversationIndex === p.convIdx);
      return ai?.rank === "capital";
    });
    if (capitalConv) cityRank = "capital";
    else if (pois.length >= 5) cityRank = "city";

    const city = await prisma.place.create({
      data: {
        mapId,
        parentId: countryId,
        level: "city",
        name: district.name,
        nameJa: district.nameJa ?? null,
        cityRank,
        positionX: cx,
        positionY: cy,
        builtUpR,
        ordinal: cityOrdinal++,
      },
      select: { id: true },
    });
    cityIdByDistrict.set(key, city.id);

    // Phase 3: scatter POIs uniformly inside the city's built-up disk
    // (radius = builtUpR * 0.85 so they stay clear of the city outline).
    // Force-layout positions are noisy at the cluster level — a single
    // big force-layouted conv could be placed far from the centroid we
    // just computed. Re-scattering here gives an even, predictable
    // distribution and keeps every POI inside its parent's polygon.
    let rng = (deterministicSeed([city.id, "pois"]) ^ 0x9e3779b9) >>> 0;
    const next = (): number => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng / 0xffffffff;
    };
    // Whitelist for the LLM-supplied 'kind'. Anything outside falls back
    // to "question" (most generic, gray pin) so the renderer always has
    // a valid color to map to.
    const validKinds = new Set<AiCityKind>([
      "code",
      "research",
      "personal",
      "question",
      "creative",
      "decision",
    ]);

    for (const poi of pois) {
      const conv = inputs[poi.convIdx];
      // sqrt for uniform area distribution in a disk; 0.05 inner padding
      // so POIs aren't all stacked at the centroid for very small clusters.
      const r = (Math.sqrt(0.05 + 0.95 * next())) * builtUpR * 0.85;
      const ang = next() * Math.PI * 2;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      const aiCity = aiResult.cities.find((c) => c.conversationIndex === poi.convIdx);
      const rawKind = aiCity?.kind as AiCityKind | undefined;
      const kind: AiCityKind | null =
        rawKind && validKinds.has(rawKind) ? rawKind : null;
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { poiX: px, poiY: py, poiKind: kind ?? "question" },
      });
      await prisma.placeConversation.create({
        data: { placeId: city.id, conversationId: conv.id },
      });
    }
  }

  // ── Roads: from LLM-identified semantic edges only ─────────────────────────
  //
  // The LLM emits `edges` as conversation-to-conversation links it judged
  // semantically related. We map each endpoint's conv to its cluster city
  // and persist one road per UNIQUE (clusterA, clusterB) pair. Multiple
  // edges spanning the same two clusters are collapsed; intra-cluster edges
  // are dropped (no road between a city and itself). The cascading
  // bundleSharedTrunks renderer in Atlas.tsx then merges parallel trunks.
  const cityIdByConvIdx = new Map<number, string>();
  for (const [convIdx, asgn] of assignments) {
    const key = `${asgn.countryIdx}:${asgn.districtIdx}`;
    const cityId = cityIdByDistrict.get(key);
    if (cityId) cityIdByConvIdx.set(convIdx, cityId);
  }

  type EdgeAgg = {
    fromCityId: string;
    toCityId: string;
    type: "highway" | "regular" | "trail" | "ferry";
    weight: number;
    label: string | null;
  };
  const edgesByPair = new Map<string, EdgeAgg>();
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  // "type" priority — when multiple LLM edges land in the same cluster pair,
  // we keep the strongest type.
  const typePriority = { highway: 3, regular: 2, trail: 1, ferry: 0 } as const;

  // Whitelist of valid RoadType strings — the LLM occasionally hallucinates
  // unrelated values like "town" or "main", which would crash the persist
  // step. Anything outside the whitelist falls back to "regular".
  const validTypes = new Set<EdgeAgg["type"]>(["highway", "regular", "trail", "ferry"]);
  for (const e of aiResult.edges ?? []) {
    if (!Number.isInteger(e.fromCity) || !Number.isInteger(e.toCity)) continue;
    const fromId = cityIdByConvIdx.get(e.fromCity);
    const toId = cityIdByConvIdx.get(e.toCity);
    if (!fromId || !toId || fromId === toId) continue;
    const rawType = (e.type ?? "regular") as EdgeAgg["type"];
    const t: EdgeAgg["type"] = validTypes.has(rawType) ? rawType : "regular";
    const k = edgeKey(fromId, toId);
    const existing = edgesByPair.get(k);
    if (!existing) {
      edgesByPair.set(k, {
        fromCityId: fromId,
        toCityId: toId,
        type: t,
        weight: 1,
        label: e.concept ?? null,
      });
    } else {
      existing.weight += 1;
      // Promote to a stronger road type if a later edge says so.
      if (typePriority[t] > typePriority[existing.type]) existing.type = t;
    }
  }

  // ── Build a HIERARCHICAL road network instead of dumping every edge ─────────
  // Real urban networks (Boeing 2017, FHWA functional classification) are
  // tree-like at the highway level with a few bypass loops, not full meshes.
  // We previously persisted every aggregated edge (183) which produced the
  // crisscross spaghetti the user kept seeing. New algorithm:
  //
  //   1. Sort all aggregated edges by weight (highest first).
  //   2. Run Kruskal's MST: greedy pick that grows a spanning tree of the
  //      cluster graph. Result: ~(N-1) edges, every cluster reachable, no
  //      cycles. This is the highway TRUNK.
  //   3. Add top 15% of non-MST edges by weight as "alpha" — bypass loops
  //      mirroring how real metros have a few extra cross-links beyond a
  //      strict tree.
  //   4. Tier-assign types by MST weight rank:
  //        top 25%  → highway (boldest)
  //        next 50% → regular
  //        bottom 25% + all alpha → trail (thinnest)
  //      This gives the FHWA-style 4-tier visual hierarchy.
  //   5. Discard the ~67% of LLM edges that are neither MST nor alpha. They
  //      were semantic but not infrastructure-level — keeping them all was
  //      what made the map read as a neural-net diagram, not a city.

  const allEdges = Array.from(edgesByPair.values());
  // Kruskal's: highest-weight edge first (we want strong connections in the tree).
  allEdges.sort((a, b) => b.weight - a.weight);

  const ufParent = new Map<string, string>();
  const ufFind = (x: string): string => {
    let p = ufParent.get(x);
    if (p === undefined) {
      ufParent.set(x, x);
      return x;
    }
    while (p !== ufParent.get(p)) {
      const grand = ufParent.get(ufParent.get(p)!);
      if (grand !== undefined) ufParent.set(p, grand);
      p = ufParent.get(p)!;
    }
    ufParent.set(x, p);
    return p;
  };
  const ufUnion = (a: string, b: string): boolean => {
    const ra = ufFind(a);
    const rb = ufFind(b);
    if (ra === rb) return false;
    ufParent.set(ra, rb);
    return true;
  };

  const mstEdges: EdgeAgg[] = [];
  const nonMstEdges: EdgeAgg[] = [];
  for (const e of allEdges) {
    if (ufUnion(e.fromCityId, e.toCityId)) mstEdges.push(e);
    else nonMstEdges.push(e);
  }

  // Tier assignment by MST rank.
  const N = mstEdges.length;
  const highwayCount = Math.max(1, Math.round(N * 0.25));
  const regularCount = Math.max(1, Math.round(N * 0.5));
  for (let i = 0; i < N; i++) {
    if (i < highwayCount) mstEdges[i].type = "highway";
    else if (i < highwayCount + regularCount) mstEdges[i].type = "regular";
    else mstEdges[i].type = "trail";
  }

  // Alpha: top 15% non-MST edges by weight, all rendered as "trail".
  const alphaCount = Math.max(0, Math.round(N * 0.15));
  const alphaEdges = nonMstEdges.slice(0, alphaCount);
  for (const e of alphaEdges) e.type = "trail";

  const finalEdges = [...mstEdges, ...alphaEdges];

  console.log(
    `[terraform] road hierarchy: ${highwayCount} highway / ${regularCount} regular / ${N - highwayCount - regularCount + alphaCount} trail (out of ${allEdges.length} candidate edges; ${allEdges.length - finalEdges.length} dropped as non-infrastructure semantic links)`,
  );

  const roadIds: string[] = [];
  for (const e of finalEdges) {
    const road = await prisma.road.create({
      data: {
        mapId,
        fromId: e.fromCityId,
        toId: e.toCityId,
        type: e.type,
        label: e.label,
        weight: e.weight,
      },
      select: { id: true },
    });
    roadIds.push(road.id);
  }

  return {
    countriesCreated: countryIdByIdx.size,
    citiesCreated: cityIdByDistrict.size,
    roadsCreated: roadIds.length,
    roadsCandidates: aiResult.edges?.length ?? 0,
    conversationsPlaced: assignments.size,
    conversationsSkipped,
  };
}
