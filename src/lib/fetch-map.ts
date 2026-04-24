import { SampleMapSchema, type ParsedSampleMap } from "@/lib/atlas-schema";

// Typed fetch for a map. Phase 1 only serves "demo" from a bundled JSON;
// Phase 2+ will serve real user maps from the database through the same
// endpoint shape.
export async function fetchMap(id: string, baseUrl?: string): Promise<ParsedSampleMap> {
  const origin = baseUrl ?? process.env.AUTH_URL ?? "http://localhost:3002";
  const res = await fetch(`${origin}/api/maps/${encodeURIComponent(id)}`, {
    // Server components run on the server — the Next cache layer will
    // deduplicate identical fetches within a single request.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Map fetch failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  return SampleMapSchema.parse(body);
}
