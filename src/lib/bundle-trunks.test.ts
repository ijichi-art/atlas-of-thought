import { describe, expect, it } from "vitest";
import { bundleSharedTrunks } from "./bundle-trunks";
import type { CityData, RoadData } from "@/types/atlas";

function city(id: string, x: number, y: number): CityData {
  return {
    id,
    countryId: "c0",
    rank: "city",
    label: id,
    position: [x, y],
    urbanDensity: 5,
  };
}

function road(id: string, fromCityId: string, toCityId: string): RoadData {
  return { id, fromCityId, toCityId, type: "regular" };
}

// Distance from point to segment (p1, p2), used to verify how close two
// roads' paths are at corresponding points.
function pointToSegmentDist(p: [number, number], a: [number, number], b: [number, number]) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1];
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

describe("bundleSharedTrunks — single-pass behavior (regression)", () => {
  it("inserts a shared waypoint when two roads share a from-city and head similar bearings", () => {
    const cities = [city("hub", 0, 0), city("dest1", 100, -10), city("dest2", 100, 10)];
    const roads = [road("r1", "hub", "dest1"), road("r2", "hub", "dest2")];
    const out = bundleSharedTrunks(roads, cities);
    // Both roads should now have at least one waypoint.
    expect(out[0].waypoints?.length).toBeGreaterThanOrEqual(1);
    expect(out[1].waypoints?.length).toBeGreaterThanOrEqual(1);
    // The first waypoint of each should be IDENTICAL (the shared trunk W).
    expect(out[0].waypoints![0]).toEqual(out[1].waypoints![0]);
  });

  it("does not bundle roads whose bearings differ by more than 25°", () => {
    // Two roads from hub heading 90° apart.
    const cities = [city("hub", 0, 0), city("east", 100, 0), city("north", 0, 100)];
    const roads = [road("r1", "hub", "east"), road("r2", "hub", "north")];
    const out = bundleSharedTrunks(roads, cities);
    // No bundling — waypoints empty.
    expect(out[0].waypoints).toBeUndefined();
    expect(out[1].waypoints).toBeUndefined();
  });
});

describe("bundleSharedTrunks — cascading", () => {
  it("extends the trunk with a second waypoint when destinations remain near each other", () => {
    // Two roads from hub to two cities only 20px apart, far away. With one
    // trunk waypoint near hub, the remaining (W → dest) segments would still
    // diverge slightly because the destinations differ — that's the lens-
    // shape bug. Cascade should add a SECOND waypoint to extend the trunk.
    const cities = [
      city("hub", 0, 0),
      city("dest1", 1000, -10),
      city("dest2", 1000, 10),
    ];
    const roads = [road("r1", "hub", "dest1"), road("r2", "hub", "dest2")];
    const out = bundleSharedTrunks(roads, cities);
    // After cascading, both roads should have multiple waypoints.
    expect(out[0].waypoints!.length).toBeGreaterThanOrEqual(2);
    expect(out[1].waypoints!.length).toBeGreaterThanOrEqual(2);
    // The first AND second waypoints should be shared (the trunk).
    expect(out[0].waypoints![0]).toEqual(out[1].waypoints![0]);
    expect(out[0].waypoints![1]).toEqual(out[1].waypoints![1]);
  });

  it("the final shared waypoint is closer to the destinations than the first one", () => {
    const cities = [
      city("hub", 0, 0),
      city("dest1", 1000, -10),
      city("dest2", 1000, 10),
    ];
    const roads = [road("r1", "hub", "dest1"), road("r2", "hub", "dest2")];
    const out = bundleSharedTrunks(roads, cities);
    const wps = out[0].waypoints!;
    // Each successive waypoint should be further along the trunk toward dest.
    for (let i = 1; i < wps.length; i++) {
      expect(wps[i][0]).toBeGreaterThan(wps[i - 1][0]);
    }
    // The last waypoint should be closer to dest1 than the first is.
    const distLastToDest = Math.hypot(1000 - wps[wps.length - 1][0], -10 - wps[wps.length - 1][1]);
    const distFirstToDest = Math.hypot(1000 - wps[0][0], -10 - wps[0][1]);
    expect(distLastToDest).toBeLessThan(distFirstToDest);
  });

  it("the trunk paths of two bundled roads stay close to each other along nearly all their length", () => {
    // Sample the implied straight-line path of each bundled road and check
    // that road2's segments lie within a small tolerance of road1's segments
    // for >= 90% of the distance.
    const cities = [
      city("hub", 0, 0),
      city("dest1", 1000, -10),
      city("dest2", 1000, 10),
    ];
    const roads = [road("r1", "hub", "dest1"), road("r2", "hub", "dest2")];
    const out = bundleSharedTrunks(roads, cities);

    const path1: [number, number][] = [
      [0, 0],
      ...(out[0].waypoints ?? []),
      [1000, -10],
    ];
    const path2: [number, number][] = [
      [0, 0],
      ...(out[1].waypoints ?? []),
      [1000, 10],
    ];

    // Walk path1 in fine steps and find the closest distance to path2 at each.
    let totalLen = 0;
    let bundledLen = 0;
    const STEP = 5;
    const TOL = 4; // px
    for (let i = 0; i < path1.length - 1; i++) {
      const [ax, ay] = path1[i];
      const [bx, by] = path1[i + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(segLen / STEP));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p: [number, number] = [ax + t * (bx - ax), ay + t * (by - ay)];
        let minD = Infinity;
        for (let k = 0; k < path2.length - 1; k++) {
          minD = Math.min(minD, pointToSegmentDist(p, path2[k], path2[k + 1]));
        }
        const w = segLen / steps;
        totalLen += w;
        if (minD < TOL) bundledLen += w;
      }
    }
    const pct = bundledLen / totalLen;
    // Cascade should give us > 85% bundled overlap (vs ~30-40% with single pass).
    expect(pct).toBeGreaterThan(0.85);
  });

  it("five fan-out roads to a tight cluster all share most of their trunk", () => {
    // Hub → 5 cities clustered in a small region 800px away. After cascade,
    // every adjacent pair of paths should be within tolerance for most of
    // the distance.
    const cities = [
      city("hub", 0, 0),
      city("d0", 800, -16),
      city("d1", 800, -8),
      city("d2", 800, 0),
      city("d3", 800, 8),
      city("d4", 800, 16),
    ];
    const roads = [0, 1, 2, 3, 4].map((i) => road(`r${i}`, "hub", `d${i}`));
    const out = bundleSharedTrunks(roads, cities);
    // All roads should accumulate multiple waypoints.
    for (const r of out) {
      expect(r.waypoints!.length).toBeGreaterThanOrEqual(2);
    }
    // The first 2 waypoints should be identical across all roads (shared trunk).
    for (let i = 1; i < out.length; i++) {
      expect(out[i].waypoints![0]).toEqual(out[0].waypoints![0]);
      expect(out[i].waypoints![1]).toEqual(out[0].waypoints![1]);
    }
  });
});

describe("bundleSharedTrunks — does not corrupt unrelated roads", () => {
  it("a single road in the input is returned unchanged", () => {
    const cities = [city("a", 0, 0), city("b", 100, 0)];
    const roads = [road("r1", "a", "b")];
    const out = bundleSharedTrunks(roads, cities);
    expect(out[0].waypoints).toBeUndefined();
  });

  it("preserves road id, type, label", () => {
    const cities = [city("hub", 0, 0), city("d1", 100, -5), city("d2", 100, 5)];
    const r1: RoadData = {
      id: "road-1",
      fromCityId: "hub",
      toCityId: "d1",
      type: "highway",
      label: "I-95",
    };
    const r2: RoadData = {
      id: "road-2",
      fromCityId: "hub",
      toCityId: "d2",
      type: "highway",
      label: "I-90",
    };
    const out = bundleSharedTrunks([r1, r2], cities);
    expect(out[0].id).toBe("road-1");
    expect(out[0].type).toBe("highway");
    expect(out[0].label).toBe("I-95");
    expect(out[1].id).toBe("road-2");
    expect(out[1].label).toBe("I-90");
  });
});
