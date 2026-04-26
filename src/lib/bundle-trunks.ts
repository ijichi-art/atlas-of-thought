// Shared-trunk road bundling.
//
// At each city that is the endpoint of multiple roads, group those roads by
// outgoing bearing. For each group of ≥2 roads heading in nearly the same
// direction, insert a shared waypoint so they merge into one trunk near the
// city and fork at the trunk's far end.
//
// Bundling is geometric: the same waypoint coordinate is added to every road
// in the cluster, and Road.tsx's curve scheme hashes control points off the
// segment endpoints — so the (city, waypoint) trunk segment renders bit-
// identically across the bundled roads. They overlap on the trunk, diverge
// at the fork.

import type { CityData, Point, RoadData } from "@/types/atlas";

const BEARING_TOLERANCE_DEG = 25; // roads within this bearing of each other bundle
const TRUNK_FRACTION = 0.4; // shared trunk = this fraction of the shortest road in the cluster

type Adj = {
  roadIdx: number;
  thisIsFrom: boolean;
  bearing: number;
  distance: number;
};

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

export function bundleSharedTrunks(
  roads: readonly RoadData[],
  cities: readonly CityData[],
): RoadData[] {
  const cityPos = new Map<string, Point>();
  for (const c of cities) cityPos.set(c.id, c.position);

  const out: RoadData[] = roads.map((r) => ({
    ...r,
    waypoints: r.waypoints ? [...r.waypoints] : [],
  }));

  // Index each road from both endpoints so we can detect fans at either end.
  const adjacency = new Map<string, Adj[]>();
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    const fp = cityPos.get(r.fromCityId);
    const tp = cityPos.get(r.toCityId);
    if (!fp || !tp) continue;
    const dx = tp[0] - fp[0];
    const dy = tp[1] - fp[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 1) continue;

    const fromBearing = Math.atan2(dy, dx);
    const toBearing = Math.atan2(-dy, -dx);

    let listFrom = adjacency.get(r.fromCityId);
    if (!listFrom) adjacency.set(r.fromCityId, (listFrom = []));
    listFrom.push({ roadIdx: i, thisIsFrom: true, bearing: fromBearing, distance: dist });

    let listTo = adjacency.get(r.toCityId);
    if (!listTo) adjacency.set(r.toCityId, (listTo = []));
    listTo.push({ roadIdx: i, thisIsFrom: false, bearing: toBearing, distance: dist });
  }

  const tolRad = (BEARING_TOLERANCE_DEG * Math.PI) / 180;

  for (const [cityId, neighbors] of adjacency) {
    if (neighbors.length < 2) continue;
    const cp = cityPos.get(cityId);
    if (!cp) continue;

    // Greedy bearing clustering. Anchor on the first unused neighbor and
    // sweep up everything within tolRad of its bearing.
    const used = new Array(neighbors.length).fill(false);
    for (let i = 0; i < neighbors.length; i++) {
      if (used[i]) continue;
      const cluster: number[] = [i];
      used[i] = true;
      for (let j = i + 1; j < neighbors.length; j++) {
        if (used[j]) continue;
        if (angleDiff(neighbors[i].bearing, neighbors[j].bearing) < tolRad) {
          cluster.push(j);
          used[j] = true;
        }
      }
      if (cluster.length < 2) continue;

      // Mean bearing via vector mean (avoids ±π wrap-around).
      let sx = 0;
      let sy = 0;
      for (const idx of cluster) {
        sx += Math.cos(neighbors[idx].bearing);
        sy += Math.sin(neighbors[idx].bearing);
      }
      const meanBearing = Math.atan2(sy, sx);

      // Trunk length = TRUNK_FRACTION of the shortest road in the cluster.
      let minDist = Infinity;
      for (const idx of cluster) {
        if (neighbors[idx].distance < minDist) minDist = neighbors[idx].distance;
      }
      const trunkLen = minDist * TRUNK_FRACTION;
      const W: Point = [
        cp[0] + Math.cos(meanBearing) * trunkLen,
        cp[1] + Math.sin(meanBearing) * trunkLen,
      ];

      // Insert W into each road in the cluster. Whichever side of the road
      // the shared city is, we put W on that side: prepend if this city is
      // the road's `from`, append otherwise.
      for (const idx of cluster) {
        const n = neighbors[idx];
        const r = out[n.roadIdx];
        if (n.thisIsFrom) r.waypoints!.unshift(W);
        else r.waypoints!.push(W);
      }
    }
  }

  // Drop empty waypoints to keep the wire shape unchanged for unbundled roads.
  return out.map((r) => ({
    ...r,
    waypoints: r.waypoints && r.waypoints.length > 0 ? r.waypoints : undefined,
  }));
}
