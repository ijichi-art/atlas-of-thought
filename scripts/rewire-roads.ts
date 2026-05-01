// Rebuild the road network from the existing per-cluster edges in the DB
// without re-running the LLM. Mirrors terraform.ts road generation:
//   1. Pull existing roads → use as candidate edge graph (with weights)
//   2. Degree-capped Kruskal's MST
//   3. Geographic component bridging (any cluster left out gets the
//      shortest-distance edge to the nearest reachable cluster)
//   4. Orphan + alpha top-up for bypass redundancy
//   5. Tier: spanning tree → highway, alpha → regular
//   6. FDEB bundling on the resulting polylines
//   7. Wipe roads + insert new
//
// Use this when you've changed road-tier / connectivity logic but don't
// want to wait on a full LLM re-cluster.
//
// Usage:
//   set -a && source .env.local && set +a
//   npx tsx scripts/rewire-roads.ts <mapId>

import { Delaunay } from "d3";
import { prisma } from "@/lib/prisma";

type Edge = {
  fromCityId: string;
  toCityId: string;
  type: "highway" | "regular" | "trail" | "ferry";
  weight: number;
  label: string | null;
};

async function main() {
  const mapId = process.argv[2];
  if (!mapId) {
    console.error("usage: npx tsx scripts/rewire-roads.ts <mapId>");
    process.exit(2);
  }

  // Pull cluster positions.
  const cities = await prisma.place.findMany({
    where: { mapId, level: "city" },
    select: { id: true, positionX: true, positionY: true },
  });
  const cityPos = new Map<string, [number, number]>();
  for (const c of cities) cityPos.set(c.id, [c.positionX, c.positionY]);
  console.log(`map ${mapId}: ${cities.length} cluster cities`);

  // ── Euclidean MST (planar) ───────────────────────────────────────────────
  // Build candidate edge list from the Delaunay triangulation of cluster
  // centers. Euclidean MST is a subset of Delaunay, so it's GUARANTEED
  // planar — no crossing highways. Previous LLM-weight MST connected
  // semantically-close clusters regardless of geographic position, which
  // produced the tangled criss-cross the user kept seeing.
  const cityList = cities; // alias for clarity
  const points: [number, number][] = cityList.map((c) => [c.positionX, c.positionY]);
  const delaunay = Delaunay.from(points);
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set<string>();
  const allEdges: Edge[] = [];
  // delaunay.triangles is a flat int32 array, every 3 indices = a triangle.
  for (let t = 0; t < delaunay.triangles.length; t += 3) {
    const a = delaunay.triangles[t];
    const b = delaunay.triangles[t + 1];
    const c = delaunay.triangles[t + 2];
    for (const [i, j] of [[a, b], [b, c], [a, c]] as Array<[number, number]>) {
      const fromId = cityList[i].id;
      const toId = cityList[j].id;
      const k = edgeKey(fromId, toId);
      if (seen.has(k)) continue;
      seen.add(k);
      const dist = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
      allEdges.push({
        fromCityId: fromId,
        toCityId: toId,
        type: "highway",
        weight: dist, // shorter = preferred (Kruskal sorts ascending below)
        label: null,
      });
    }
  }
  // Sort ASCENDING by distance — shortest edges first for Kruskal.
  allEdges.sort((a, b) => a.weight - b.weight);
  console.log(`Delaunay candidate edges: ${allEdges.length}`);

  // Plain Kruskal on Euclidean distances. No degree cap — Delaunay
  // already constrains the graph to nearest neighbours, so star patterns
  // can't form.
  const ufParent = new Map<string, string>();
  const ufFind = (x: string): string => {
    let p = ufParent.get(x);
    if (p === undefined) { ufParent.set(x, x); return x; }
    while (p !== ufParent.get(p)) {
      const grand = ufParent.get(ufParent.get(p)!);
      if (grand !== undefined) ufParent.set(p, grand);
      p = ufParent.get(p)!;
    }
    ufParent.set(x, p);
    return p;
  };
  const ufUnion = (a: string, b: string): boolean => {
    const ra = ufFind(a); const rb = ufFind(b);
    if (ra === rb) return false;
    ufParent.set(ra, rb);
    return true;
  };
  const mstEdges: Edge[] = [];
  for (const e of allEdges) {
    if (ufUnion(e.fromCityId, e.toCityId)) mstEdges.push(e);
  }

  // ── Detour-shortcut bypass edges ─────────────────────────────────────────
  // Pick non-MST Delaunay edges with the highest "MST detour ratio" — the
  // ratio of the cluster pair's shortest path through the MST to the
  // direct Euclidean distance. High ratio = pair is geographically close
  // but the MST forces a long detour. These shortcuts stay planar
  // (Delaunay-adjacent only) and are capped at BYPASS_COUNT to keep the
  // network minimal.
  const BYPASS_COUNT = 5;
  const mstAdj = new Map<string, Array<{ to: string; dist: number }>>();
  const pushAdj = (a: string, b: string, d: number) => {
    const arr = mstAdj.get(a) ?? [];
    arr.push({ to: b, dist: d });
    mstAdj.set(a, arr);
  };
  for (const e of mstEdges) {
    pushAdj(e.fromCityId, e.toCityId, e.weight);
    pushAdj(e.toCityId, e.fromCityId, e.weight);
  }
  const mstPathDist = (from: string, to: string): number => {
    const visited = new Set<string>([from]);
    const queue: Array<{ id: string; d: number }> = [{ id: from, d: 0 }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.id === to) return cur.d;
      for (const nb of mstAdj.get(cur.id) ?? []) {
        if (visited.has(nb.to)) continue;
        visited.add(nb.to);
        queue.push({ id: nb.to, d: cur.d + nb.dist });
      }
    }
    return Infinity;
  };
  const mstSet = new Set(mstEdges.map((e) => edgeKey(e.fromCityId, e.toCityId)));
  const scored = allEdges
    .filter((e) => !mstSet.has(edgeKey(e.fromCityId, e.toCityId)))
    .map((e) => ({ edge: e, ratio: mstPathDist(e.fromCityId, e.toCityId) / e.weight }))
    .sort((a, b) => b.ratio - a.ratio);
  const bypass = scored.slice(0, BYPASS_COUNT).map((s) => ({ ...s.edge, type: "highway" as const }));
  mstEdges.push(...bypass);
  console.log(
    `roads: MST=${mstEdges.length - bypass.length} + bypass=${bypass.length} = ${mstEdges.length} highways total`,
  );
  if (bypass.length > 0) {
    console.log(
      "bypass detour ratios:",
      scored.slice(0, BYPASS_COUNT).map((s) => `×${s.ratio.toFixed(1)}`).join(", "),
    );
  }

  // Wipe + insert as straight-line roads. No FDEB / no waypoints — the
  // Euclidean MST is already planar, so there's nothing to bundle and any
  // intermediate waypoints would only add visual wiggle.
  await prisma.road.deleteMany({ where: { mapId } });
  for (const e of mstEdges) {
    await prisma.road.create({
      data: {
        mapId,
        fromId: e.fromCityId,
        toId: e.toCityId,
        type: e.type,
        label: e.label,
        weight: 1, // visual weight equal across spanning tree
        waypoints: undefined,
      },
    });
  }
  console.log(`wrote ${mstEdges.length} roads`);
}

main().then(() => process.exit(0));
