import { describe, expect, it, vi } from "vitest";
import { clusterBatched, type AiResult, type ConvInput } from "./terraform";
import type { AiClient } from "./ai-client";

// BATCH_SIZE inside terraform.ts is 80; tests below use input sizes that
// produce a deterministic batch count.

// Build a fake AiClient that emits a pre-determined JSON for each successive
// call. Used to drive clusterBatched deterministically without hitting any
// real LLM. Each scripted reply represents one batch's response.
function fakeAi(replies: AiResult[]): AiClient {
  let i = 0;
  return {
    provider: "deepseek",
    model: "test",
    async *stream() {
      const reply = replies[i++];
      if (!reply) throw new Error(`fakeAi: ran out of scripted replies (called ${i} times)`);
      yield JSON.stringify(reply);
    },
  };
}

function conv(id: string, idx: number): ConvInput {
  return {
    id,
    title: id,
    preview: `preview ${idx}`,
    messageCount: 5,
    totalChars: 1000,
  };
}

// 81 inputs → 2 batches (80 + 1).
// 161 inputs → 3 batches (80 + 80 + 1).

describe("clusterBatched — index remapping (local → global)", () => {
  it("remaps cities[].conversationIndex to global indices across batches", async () => {
    // 81 inputs = 2 batches: 80 + 1.
    const inputs: ConvInput[] = Array.from({ length: 81 }, (_, i) => conv(`c${i}`, i));

    // Batch 1 (convs 0..79, local indices 0..79): two cities at local 0 and 79.
    const batch1: AiResult = {
      countries: [
        {
          name: "Architectura",
          theme: "design",
          color: "#aaa",
          neighbors: [],
          districts: [{ name: "DistA", cityIndexes: [0, 79] }],
        },
      ],
      cities: [
        { conversationIndex: 0, topic: "t0", summary: "s0", rank: "capital" },
        { conversationIndex: 79, topic: "t79", summary: "s79", rank: "city" },
      ],
      edges: [{ fromCity: 0, toCity: 79, type: "highway", concept: "shared" }],
    };
    // Batch 2 (conv 80, local index 0): one city.
    const batch2: AiResult = {
      countries: [
        {
          name: "Architectura",
          theme: "design",
          color: "#aaa",
          neighbors: [],
          districts: [{ name: "DistB", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t80", summary: "s80", rank: "city" }],
      edges: [],
    };

    const out = await clusterBatched(inputs, fakeAi([batch1, batch2]), null);

    expect(out.cities).toHaveLength(3);
    // Local 0 and 79 (batch1) → global 0 and 79; local 0 (batch2) → global 80.
    expect(out.cities.map((c) => c.conversationIndex).sort((a, b) => a - b)).toEqual([
      0, 79, 80,
    ]);
    expect(out.edges).toEqual([
      { fromCity: 0, toCity: 79, type: "highway", concept: "shared" },
    ]);
  });

  it("dedupes countries by case-insensitive name and keeps first batch's color/theme", async () => {
    // 161 inputs = 3 batches (80 + 80 + 1).
    const inputs: ConvInput[] = Array.from({ length: 161 }, (_, i) => conv(`c${i}`, i));
    const batch1: AiResult = {
      countries: [
        {
          name: "Architectura",
          theme: "first description",
          color: "#firstcolor",
          neighbors: [],
          districts: [{ name: "D1", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "capital" }],
    };
    const batch2: AiResult = {
      countries: [
        {
          name: "ARCHITECTURA", // different case — must dedupe
          theme: "second description (ignored)",
          color: "#wrongcolor",
          neighbors: [],
          districts: [{ name: "D2", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "city" }],
    };
    const batch3: AiResult = {
      countries: [
        {
          name: "Cognitio", // genuinely new
          theme: "knowledge",
          color: "#cognitiocolor",
          neighbors: [],
          districts: [{ name: "D3", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "capital" }],
    };

    const out = await clusterBatched(inputs, fakeAi([batch1, batch2, batch3]), null);

    expect(out.countries).toHaveLength(2);
    const arch = out.countries.find((c) => c.name === "Architectura")!;
    expect(arch.theme).toBe("first description");
    expect(arch.color).toBe("#firstcolor");
    expect(arch.districts).toHaveLength(2);
    expect(arch.districts!.map((d) => d.name).sort()).toEqual(["D1", "D2"]);

    const cog = out.countries.find((c) => c.name === "Cognitio")!;
    expect(cog).toBeDefined();
    expect(cog.color).toBe("#cognitiocolor");
  });

  it("demotes duplicate capitals so each country has at most one", async () => {
    // 81 inputs = 2 batches.
    const inputs: ConvInput[] = Array.from({ length: 81 }, (_, i) => conv(`c${i}`, i));
    const country = {
      name: "Architectura",
      theme: "x",
      color: "#aaa",
      neighbors: [],
    };
    const batch1: AiResult = {
      countries: [{ ...country, districts: [{ name: "D1", cityIndexes: [0] }] }],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "capital" }],
    };
    const batch2: AiResult = {
      countries: [{ ...country, districts: [{ name: "D2", cityIndexes: [0] }] }],
      cities: [
        { conversationIndex: 0, topic: "t", summary: "s", rank: "capital" }, // also capital!
      ],
    };

    const out = await clusterBatched(inputs, fakeAi([batch1, batch2]), null);
    const capitals = out.cities.filter((c) => c.rank === "capital");
    expect(capitals).toHaveLength(1);
    // Earliest global index wins.
    expect(capitals[0].conversationIndex).toBe(0);
  });

  it("aggregates skip lists across batches with global indices", async () => {
    const inputs: ConvInput[] = Array.from({ length: 81 }, (_, i) => conv(`c${i}`, i));
    const batch1: AiResult = {
      countries: [
        {
          name: "X",
          theme: "x",
          color: "#aaa",
          neighbors: [],
          districts: [{ name: "D", cityIndexes: [5] }],
        },
      ],
      cities: [{ conversationIndex: 5, topic: "t", summary: "s", rank: "capital" }],
      skipDefinitive: [{ conversationIndex: 5, reason: "matches directive" }],
    };
    const batch2: AiResult = {
      countries: [
        {
          name: "X",
          theme: "x",
          color: "#aaa",
          neighbors: [],
          districts: [{ name: "D2", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "city" }],
      skipAmbiguous: [{ conversationIndex: 0, reason: "maybe matches" }],
    };

    const out = await clusterBatched(inputs, fakeAi([batch1, batch2]), "skip foo");
    expect(out.skipDefinitive?.[0].conversationIndex).toBe(5);
    expect(out.skipAmbiguous?.[0].conversationIndex).toBe(80); // batch2 idx 0 → global 80
  });

  it("filters out-of-range indices that the LLM might hallucinate", async () => {
    const inputs: ConvInput[] = Array.from({ length: 81 }, (_, i) => conv(`c${i}`, i));
    const batch1: AiResult = {
      countries: [
        {
          name: "X",
          theme: "x",
          color: "#aaa",
          neighbors: [],
          districts: [{ name: "D", cityIndexes: [0, 999] }], // 999 out of range
        },
      ],
      cities: [
        { conversationIndex: 0, topic: "t", summary: "s", rank: "capital" },
        { conversationIndex: 9999, topic: "t", summary: "s", rank: "city" }, // bogus
      ],
      edges: [
        { fromCity: 0, toCity: 1, type: "highway", concept: "ok" },
        { fromCity: 0, toCity: 9999, type: "highway", concept: "bogus" },
      ],
    };
    const batch2: AiResult = {
      countries: [
        {
          name: "X",
          theme: "x",
          color: "#aaa",
          neighbors: [],
          districts: [{ name: "D2", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "city" }],
    };

    const out = await clusterBatched(inputs, fakeAi([batch1, batch2]), null);
    // 999 dropped from cityIndexes
    expect(out.countries[0].districts!.map((d) => d.cityIndexes).flat().sort((a, b) => a - b)).toEqual([
      0, 80,
    ]);
    // bogus city dropped, valid ones kept
    expect(out.cities.every((c) => c.conversationIndex < inputs.length)).toBe(true);
    // bogus edge dropped, real edge kept
    expect(out.edges).toEqual([{ fromCity: 0, toCity: 1, type: "highway", concept: "ok" }]);
  });
});

describe("clusterBatched — basic structure", () => {
  it("returns countries in first-seen insertion order even when batches order them differently", async () => {
    // 161 inputs = 3 batches.
    const inputs: ConvInput[] = Array.from({ length: 161 }, (_, i) => conv(`c${i}`, i));
    const batch1: AiResult = {
      countries: [
        {
          name: "Alpha",
          theme: "a",
          color: "#a",
          neighbors: [],
          districts: [{ name: "D", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "capital" }],
    };
    const batch2: AiResult = {
      countries: [
        {
          name: "Beta",
          theme: "b",
          color: "#b",
          neighbors: [],
          districts: [{ name: "D", cityIndexes: [0] }],
        },
        {
          name: "Alpha",
          theme: "a",
          color: "#a",
          neighbors: [],
          districts: [{ name: "D2", cityIndexes: [1] }],
        },
      ],
      cities: [
        { conversationIndex: 0, topic: "t", summary: "s", rank: "capital" },
        { conversationIndex: 1, topic: "t", summary: "s", rank: "city" },
      ],
    };
    const batch3: AiResult = {
      countries: [
        {
          name: "Alpha",
          theme: "a",
          color: "#a",
          neighbors: [],
          districts: [{ name: "D3", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "city" }],
    };

    const out = await clusterBatched(inputs, fakeAi([batch1, batch2, batch3]), null);
    expect(out.countries.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
  });

  it("survives a failing batch without crashing the whole run", async () => {
    const inputs: ConvInput[] = Array.from({ length: 81 }, (_, i) => conv(`c${i}`, i));
    const batch1: AiResult = {
      countries: [
        {
          name: "X",
          theme: "x",
          color: "#aaa",
          neighbors: [],
          districts: [{ name: "D", cityIndexes: [0] }],
        },
      ],
      cities: [{ conversationIndex: 0, topic: "t", summary: "s", rank: "capital" }],
    };
    // Batch 2 returns garbage that fails JSON parsing.
    let calls = 0;
    const garbageAi: AiClient = {
      provider: "deepseek",
      model: "test",
      async *stream() {
        const i = calls++;
        if (i === 0) {
          yield JSON.stringify(batch1);
        } else {
          yield "not valid json {{{";
        }
      },
    };

    // Suppress the expected console.error so the test output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await clusterBatched(inputs, garbageAi, null);
    errSpy.mockRestore();

    // Batch 1's data is preserved; batch 2 is silently dropped.
    expect(out.countries).toHaveLength(1);
    expect(out.cities).toHaveLength(1);
    expect(out.cities[0].conversationIndex).toBe(0);
  });
});
