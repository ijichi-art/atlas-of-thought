// Re-scatter POI positions inside each cluster city's built-up disk using
// the center-biased distribution (linear r → 1/r areal density). Reuses
// the existing cluster assignments and built-up radii — no LLM, no layout,
// no schema changes. Run after editing the scatter formula in
// src/lib/terraform.ts.
//
// Usage:
//   set -a && source .env.local && set +a
//   npx tsx scripts/rescatter-pois.ts <mapId>

import { prisma } from "@/lib/prisma";

function deterministicSeed(parts: string[]): number {
  let h = 2166136261;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

// Distance from point (px, py) to the line segment (ax, ay)→(bx, by).
function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

async function main() {
  const mapId = process.argv[2];
  if (!mapId) {
    console.error("usage: npx tsx scripts/rescatter-pois.ts <mapId>");
    process.exit(2);
  }

  // Pull the river polyline so POI rejection-sampling can keep them off it.
  // River.tsx renders with strokeWidth=14 user-units, so the visual band is
  // ±7 from the centerline. Buffer slightly more (10) so POIs aren't
  // touching the river edge either.
  const RIVER_BUFFER = 10;
  const rivers = await prisma.terrainFeature.findMany({
    where: { mapId, type: "river" },
    select: { geometry: true },
  });
  const riverSegments: Array<[number, number, number, number]> = [];
  for (const r of rivers) {
    const g = r.geometry as { kind?: string; coords?: [number, number][] } | null;
    if (!g || g.kind !== "polyline" || !Array.isArray(g.coords)) continue;
    for (let i = 0; i < g.coords.length - 1; i++) {
      const [ax, ay] = g.coords[i];
      const [bx, by] = g.coords[i + 1];
      riverSegments.push([ax, ay, bx, by]);
    }
  }
  console.log(`river segments: ${riverSegments.length} (buffer=${RIVER_BUFFER}px)`);

  const inRiver = (px: number, py: number): boolean => {
    for (const [ax, ay, bx, by] of riverSegments) {
      if (distPointToSegment(px, py, ax, ay, bx, by) < RIVER_BUFFER) return true;
    }
    return false;
  };

  const cities = await prisma.place.findMany({
    where: { mapId, level: "city" },
    select: {
      id: true,
      name: true,
      positionX: true,
      positionY: true,
      builtUpR: true,
      conversations: {
        select: { conversationId: true },
      },
    },
  });
  console.log(`map ${mapId}: ${cities.length} cluster cities`);

  let totalPois = 0;
  let updated = 0;
  let nudgedFromRiver = 0;
  for (const city of cities) {
    // Recompute builtUpR with the new tighter formula and cap.
    const builtUpR = Math.min(150, Math.max(60, 10 * Math.sqrt(city.conversations.length)));
    await prisma.place.update({ where: { id: city.id }, data: { builtUpR } });
    const cx = city.positionX;
    const cy = city.positionY;
    let s = (deterministicSeed([city.id, "pois"]) ^ 0x9e3779b9) >>> 0;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    for (const link of city.conversations) {
      // Linear scatter to 0.6R — fits inside polygon's narrowest direction.
      // Rejection-sample up to 20 attempts to land off the river. If every
      // attempt lands in-river (cluster center literally on the river),
      // accept the last position rather than loop forever.
      let px = cx;
      let py = cy;
      let placed = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const r = (0.05 + 0.95 * next()) * builtUpR * 0.6;
        const ang = next() * Math.PI * 2;
        px = cx + Math.cos(ang) * r;
        py = cy + Math.sin(ang) * r;
        if (!inRiver(px, py)) {
          placed = true;
          break;
        }
      }
      if (!placed) nudgedFromRiver++;
      await prisma.conversation.update({
        where: { id: link.conversationId },
        data: { poiX: px, poiY: py },
      });
      updated++;
      totalPois++;
    }
  }
  console.log(
    `rescattered ${updated}/${totalPois} POIs across ${cities.length} cities; ${nudgedFromRiver} kept on-river (cluster center too close)`,
  );
}

main().then(() => process.exit(0));
