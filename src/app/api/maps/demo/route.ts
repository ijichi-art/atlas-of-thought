import { NextResponse } from "next/server";
import sampleMap from "@/data/sample-map.json";
import { SampleMapSchema } from "@/lib/atlas-schema";

// Static demo map. The same shape will be served from /api/maps/[id] for
// real user maps in Phase 2+ — this endpoint lets us validate the pipe
// (Zod parse + network round-trip) today while the data source is still a
// bundled JSON.

export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET() {
  const parsed = SampleMapSchema.safeParse(sampleMap);
  if (!parsed.success) {
    console.error("sample-map.json failed schema validation", parsed.error.flatten());
    return NextResponse.json(
      { error: "Demo map is malformed on the server" },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=3600" },
  });
}
