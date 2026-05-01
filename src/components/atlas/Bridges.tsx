import type { CityData, RiverData, RoadData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// Bridge ticks at every road×river crossing — small white capsules drawn
// perpendicular to the road direction, wide enough to cover the river band.
//
// Intersection is computed against straight-line approximations of both
// curves (road = from→waypoints→to as polyline; river = its waypoint
// polyline). The visible bezier wobble in Road.tsx shifts the actual
// crossing by a few px, but a bridge tick wide enough to cap the river
// absorbs that — no need to sample the exact bezier.

type Seg = { a: [number, number]; b: [number, number] };

function segmentsFromPoints(points: [number, number][]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({ a: points[i], b: points[i + 1] });
  }
  return segs;
}

// Standard 2D segment intersection. Returns the crossing point or null.
function intersect(s1: Seg, s2: Seg): [number, number] | null {
  const [x1, y1] = s1.a;
  const [x2, y2] = s1.b;
  const [x3, y3] = s2.a;
  const [x4, y4] = s2.b;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

export function Bridges({
  roads,
  cities,
  rivers,
  scale,
}: {
  roads: RoadData[];
  cities: CityData[];
  rivers: RiverData[];
  scale: number;
}) {
  if (rivers.length === 0) return null;
  const cityById = new Map(cities.map((c) => [c.id, c]));

  // Pre-build river segments once (rivers are static across the canvas).
  const riverSegs: Seg[] = [];
  for (const r of rivers) riverSegs.push(...segmentsFromPoints(r.path));
  if (riverSegs.length === 0) return null;

  type Bridge = { center: [number, number]; angle: number; type: RoadData["type"] };
  const bridges: Bridge[] = [];
  for (const road of roads) {
    const style = ATLAS_STYLE.road[road.type];
    if (scale < style.minScale) continue;
    if (style.maxScale !== undefined && scale > style.maxScale) continue;
    const w = road.weight ?? 1;
    if (style.weightFloor !== undefined && w < style.weightFloor) continue;
    const from = cityById.get(road.fromCityId);
    const to = cityById.get(road.toCityId);
    if (!from || !to) continue;
    const points: [number, number][] = [
      from.position,
      ...(road.waypoints ?? []),
      to.position,
    ];
    const roadSegs = segmentsFromPoints(points);
    for (const rs of roadSegs) {
      for (const ws of riverSegs) {
        const p = intersect(rs, ws);
        if (!p) continue;
        const dx = rs.b[0] - rs.a[0];
        const dy = rs.b[1] - rs.a[1];
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        bridges.push({ center: p, angle, type: road.type });
      }
    }
  }

  if (bridges.length === 0) return null;

  return (
    <g pointerEvents="none">
      {bridges.map((b, i) => {
        const style = ATLAS_STYLE.road[b.type];
        // Bridge length spans across the river band (~14 user-units; sea
        // stroke width). Width matches the road casing so it looks like the
        // road is bridging over the river rather than a separate object.
        const len = 22 / scale;
        const halfW = ((style.casing?.width ?? style.fill.width) + 2) / 2 / scale;
        const casing = style.casing?.color ?? "#a87a3a";
        return (
          <g
            key={`bridge-${i}`}
            transform={`translate(${b.center[0]} ${b.center[1]}) rotate(${b.angle})`}
          >
            <rect
              x={-len / 2}
              y={-halfW}
              width={len}
              height={halfW * 2}
              fill="#ffffff"
              stroke={casing}
              strokeWidth={1 / scale}
            />
          </g>
        );
      })}
    </g>
  );
}
