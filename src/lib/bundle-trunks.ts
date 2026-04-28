// Cascading shared-trunk road bundling.
//
// Runs multiple passes of bearing-clustering over every PATH ANCHOR — i.e.
// every point on a road's path, whether a city endpoint or a waypoint
// previously inserted by an earlier pass.
//
// Pass 1 is the same as the original endpoint-only bundling: at each city
// with ≥2 outgoing roads heading in similar directions, insert a shared
// waypoint W in the mean direction.
//
// Pass 2+ then operate on those new waypoints W as anchors. If multiple
// roads still continue in similar directions from W toward different but
// nearby destinations, a deeper waypoint W' is inserted further along the
// trunk. The cascade keeps extending the shared trunk until either the
// roads diverge enough to leave the bearing tolerance, or the remaining
// distance to the nearest destination is too short to bother with another
// segment.
//
// Net effect: roads going to nearby cities visually overlap for almost all
// of their length and only fork in the final segment near each destination,
// matching how real road maps look. Compatible with Road.tsx's segment-
// hashed bezier curve — any two roads tracing the same (P1, P2) segment
// render bit-identical curves.

import type { CityData, Point, RoadData } from "@/types/atlas";

const BEARING_TOLERANCE_DEG = 25;
const TRUNK_FRACTION = 0.4;
// Stop cascading when the proposed trunk segment is shorter than this many
// pixels — a no-op visually and guards against runaway recursion when two
// roads have near-identical paths to the very end.
const MIN_TRUNK_LEN = 8;
// Hard cap on cascade depth (defense against pathological inputs).
const MAX_DEPTH = 8;

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

// Anchor key: round to 0.1 px so floating-point drift doesn't split what
// should be the same anchor across roads sharing a waypoint.
function ptKey(p: Point): string {
  return `${Math.round(p[0] * 10) / 10},${Math.round(p[1] * 10) / 10}`;
}

// One leaf = "this road has anchor at path position pathIdx and continues
// toward path[pathIdx + dir]." dir ∈ {+1, -1} for forward / backward.
type Leaf = {
  roadIdx: number;
  pathIdx: number;
  spliceIdx: number; // where to insert in the road's waypoints array
  bearing: number;
  distance: number;
  // Quantized coords of the immediate neighbor on this road's path. Used to
  // skip clusters whose leaves all already point at the SAME neighbor: those
  // are already bundled on that segment, subdividing them further is just
  // pathological recursion.
  neighborKey: string;
};

export function bundleSharedTrunks(
  roads: readonly RoadData[],
  cities: readonly CityData[],
): RoadData[] {
  const cityPos = new Map<string, Point>();
  for (const c of cities) cityPos.set(c.id, c.position);

  // Mutable per-road waypoint arrays. We add to them in-place across passes.
  const out: RoadData[] = roads.map((r) => ({
    ...r,
    waypoints: r.waypoints ? [...r.waypoints] : [],
  }));

  const pathOf = (r: RoadData): Point[] => {
    const from = cityPos.get(r.fromCityId);
    const to = cityPos.get(r.toCityId);
    if (!from || !to) return [];
    return [from, ...(r.waypoints ?? []), to];
  };

  const tolRad = (BEARING_TOLERANCE_DEG * Math.PI) / 180;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    // Build anchor map: each unique point on any road's path collects its
    // forward-and-backward leaves.
    const anchorLeaves = new Map<string, { pos: Point; leaves: Leaf[] }>();

    for (let ri = 0; ri < out.length; ri++) {
      const path = pathOf(out[ri]);
      if (path.length < 2) continue;
      for (let i = 0; i < path.length; i++) {
        const k = ptKey(path[i]);
        let bucket = anchorLeaves.get(k);
        if (!bucket) {
          bucket = { pos: path[i], leaves: [] };
          anchorLeaves.set(k, bucket);
        }
        // Forward leaf — segment (path[i], path[i+1]).
        if (i + 1 < path.length) {
          const dx = path[i + 1][0] - path[i][0];
          const dy = path[i + 1][1] - path[i][1];
          const d = Math.hypot(dx, dy);
          if (d >= 1) {
            bucket.leaves.push({
              roadIdx: ri,
              pathIdx: i,
              spliceIdx: i, // insert between path[i] and path[i+1] = waypoints index i
              bearing: Math.atan2(dy, dx),
              distance: d,
              neighborKey: ptKey(path[i + 1]),
            });
          }
        }
        // Backward leaf — segment (path[i], path[i-1]). Same map direction
        // as a forward leaf from path[i-1] to path[i] would be opposite, so
        // these need their own bearing.
        if (i - 1 >= 0) {
          const dx = path[i - 1][0] - path[i][0];
          const dy = path[i - 1][1] - path[i][1];
          const d = Math.hypot(dx, dy);
          if (d >= 1) {
            bucket.leaves.push({
              roadIdx: ri,
              pathIdx: i,
              spliceIdx: i - 1, // insert between path[i-1] and path[i]
              bearing: Math.atan2(dy, dx),
              distance: d,
              neighborKey: ptKey(path[i - 1]),
            });
          }
        }
      }
    }

    // Cluster leaves at each anchor and plan insertions.
    type Insertion = { roadIdx: number; spliceIdx: number; W: Point };
    const insertions: Insertion[] = [];

    for (const { pos: anchorPos, leaves } of anchorLeaves.values()) {
      if (leaves.length < 2) continue;

      const used = new Array(leaves.length).fill(false);
      for (let i = 0; i < leaves.length; i++) {
        if (used[i]) continue;
        const cluster: number[] = [i];
        used[i] = true;
        for (let j = i + 1; j < leaves.length; j++) {
          if (used[j]) continue;
          if (angleDiff(leaves[i].bearing, leaves[j].bearing) < tolRad) {
            cluster.push(j);
            used[j] = true;
          }
        }
        if (cluster.length < 2) continue;

        // Roads are bundled, not segments — if the same road shows up twice
        // in the cluster (a self-loop / cycle), don't double-count it.
        const distinctRoads = new Set(cluster.map((idx) => leaves[idx].roadIdx));
        if (distinctRoads.size < 2) continue;

        // If every leaf in the cluster already points at the SAME neighbor,
        // the trunk segment between this anchor and that neighbor is already
        // shared. Subdividing it just adds redundant waypoints and confuses
        // the bezier-curve invariant. Skip.
        const distinctNeighbors = new Set(cluster.map((idx) => leaves[idx].neighborKey));
        if (distinctNeighbors.size < 2) continue;

        // Mean bearing via vector mean (avoids ±π wrap-around).
        let sx = 0;
        let sy = 0;
        for (const idx of cluster) {
          sx += Math.cos(leaves[idx].bearing);
          sy += Math.sin(leaves[idx].bearing);
        }
        const meanBearing = Math.atan2(sy, sx);

        let minDist = Infinity;
        for (const idx of cluster) {
          if (leaves[idx].distance < minDist) minDist = leaves[idx].distance;
        }
        const trunkLen = minDist * TRUNK_FRACTION;
        if (trunkLen < MIN_TRUNK_LEN) continue;

        const W: Point = [
          anchorPos[0] + Math.cos(meanBearing) * trunkLen,
          anchorPos[1] + Math.sin(meanBearing) * trunkLen,
        ];

        for (const idx of cluster) {
          const leaf = leaves[idx];
          insertions.push({ roadIdx: leaf.roadIdx, spliceIdx: leaf.spliceIdx, W });
        }
      }
    }

    if (insertions.length === 0) break;

    // Apply insertions per road, splicing from highest index to lowest so
    // earlier splices don't shift later splice positions.
    const byRoad = new Map<number, Insertion[]>();
    for (const ins of insertions) {
      let arr = byRoad.get(ins.roadIdx);
      if (!arr) byRoad.set(ins.roadIdx, (arr = []));
      arr.push(ins);
    }
    for (const [roadIdx, list] of byRoad) {
      list.sort((a, b) => b.spliceIdx - a.spliceIdx);
      const wps = out[roadIdx].waypoints!;
      // Dedup: don't insert the same W at the same position twice (forward
      // leaf at P from one cluster + backward leaf at next-anchor from the
      // same cluster can both target the same gap).
      const seen = new Set<string>();
      for (const ins of list) {
        const key = `${ins.spliceIdx}@${ptKey(ins.W)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        wps.splice(ins.spliceIdx, 0, ins.W);
      }
    }
  }

  return out.map((r) => ({
    ...r,
    waypoints: r.waypoints && r.waypoints.length > 0 ? r.waypoints : undefined,
  }));
}
