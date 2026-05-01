// Shared city/country geometry helpers used by Country and CityBlocks.
// Single seed per city.id so built-up polygon and street grid stay in sync.

import type { CityData, Point } from "@/types/atlas";

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function builtUpRadius(rank: CityData["rank"]): number {
  switch (rank) {
    case "capital":
      return 100; // spec rule B: 80–120
    case "city":
      return 65; // 50–80
    case "town":
      return 30; // 25–50
  }
}

// Irregular polygon: 12 radial points with seeded random radii.
export function builtUpPolygon(center: Point, baseR: number, seed: number): Point[] {
  const N = 12;
  let s = seed >>> 0;
  const pts: Point[] = [];
  for (let i = 0; i < N; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const r = baseR * (0.65 + 0.35 * (s / 0xffffffff));
    const angle = (i / N) * Math.PI * 2;
    pts.push([center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r]);
  }
  return pts;
}

// Closed Catmull-Rom path through points (used for built-up + park outlines).
export function smoothClosedPath(points: Point[]): string {
  if (points.length < 3) return "";
  const n = points.length;
  const cmds: string[] = [];
  cmds.push(`M ${points[0][0]} ${points[0][1]}`);
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const tension = 0.5;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    cmds.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0]} ${p2[1]}`,
    );
  }
  cmds.push("Z");
  return cmds.join(" ");
}

// Street-block grid for a city. Two perpendicular axes at a per-city seeded
// rotation in [-15°, +15°] (spec rule C step 4). Spacing matches a typical
// urban block on screen at zoom = 1.5 (where blocks first become visible).
//
// `arterials` are the two through-city axes; `collectors` are the parallel
// streets filling the grid in between. Lines extend slightly beyond the
// built-up polygon — clipping to that polygon happens at render time.
export type Segment = [number, number, number, number];

export function streetGrid(
  center: Point,
  builtUpR: number,
  seed: number,
): { arterials: Segment[]; collectors: Segment[]; subCollectors: Segment[] } {
  let s = (seed ^ 0x5a5a5a5a) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  const rotation = (((s / 0xffffffff) * 30 - 15) * Math.PI) / 180;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const r = builtUpR * 1.25;
  const SPACING = 24;
  const count = Math.ceil(r / SPACING);
  const [cx, cy] = center;

  const collectors: Segment[] = [];
  // Lines parallel to axis 1, offset perpendicular along axis 2.
  for (let i = -count; i <= count; i++) {
    if (i === 0) continue; // axis 0 is the arterial
    const offset = i * SPACING;
    const ox = -sin * offset;
    const oy = cos * offset;
    collectors.push([cx + ox - cos * r, cy + oy - sin * r, cx + ox + cos * r, cy + oy + sin * r]);
  }
  // Lines parallel to axis 2, offset perpendicular along axis 1.
  for (let i = -count; i <= count; i++) {
    if (i === 0) continue;
    const offset = i * SPACING;
    const ox = cos * offset;
    const oy = sin * offset;
    collectors.push([cx + ox + sin * r, cy + oy - cos * r, cx + ox - sin * r, cy + oy + cos * r]);
  }

  // Sub-collectors bisect each collector block — drawn only at high zoom
  // (CityBlocks gates by scale). Halves a 24×24 block into 12×12 quarters,
  // matching the "5 POIs per block" complaint at neighbourhood zoom.
  const subCollectors: Segment[] = [];
  for (let i = -count; i <= count; i++) {
    const offset = (i + 0.5) * SPACING;
    if (Math.abs(offset) > r) continue;
    const ox = -sin * offset;
    const oy = cos * offset;
    subCollectors.push([cx + ox - cos * r, cy + oy - sin * r, cx + ox + cos * r, cy + oy + sin * r]);
  }
  for (let i = -count; i <= count; i++) {
    const offset = (i + 0.5) * SPACING;
    if (Math.abs(offset) > r) continue;
    const ox = cos * offset;
    const oy = sin * offset;
    subCollectors.push([cx + ox + sin * r, cy + oy - cos * r, cx + ox - sin * r, cy + oy + cos * r]);
  }

  const arterials: Segment[] = [
    [cx - cos * r, cy - sin * r, cx + cos * r, cy + sin * r],
    [cx + sin * r, cy - cos * r, cx - sin * r, cy + cos * r],
  ];

  return { arterials, collectors, subCollectors };
}
