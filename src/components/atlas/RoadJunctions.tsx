import type { CityData, RoadData, RoadType } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// Two overlays drawn at cluster nodes, above roads but below city pins:
//
// 1. Junction smoothing — a filled disc in the casing color of the thickest
//    road meeting at that cluster. Covers the ragged overlap of round caps
//    where roads of different widths meet, so the cluster reads as a single
//    interchange hub instead of three separate strokes ending at a point.
//
// 2. Interchange marker — a ringed circle in highway color, drawn only at
//    clusters that bind ≥2 highway-tier roads. Mirrors the visual idiom of
//    US interstate cloverleafs / Japanese 高速 IC where two trunk routes
//    intersect.

const TYPE_RANK: Record<RoadType, number> = {
  highway: 3,
  regular: 2,
  trail: 1,
  ferry: 0,
};

export function RoadJunctions({
  roads,
  cities,
  scale,
}: {
  roads: RoadData[];
  cities: CityData[];
  scale: number;
}) {
  // Per-cluster aggregate: count of incident roads + the strongest type.
  const cityById = new Map(cities.map((c) => [c.id, c]));
  type Agg = { count: number; highwayCount: number; topType: RoadType };
  const agg = new Map<string, Agg>();
  const bump = (id: string, t: RoadType) => {
    const cur = agg.get(id);
    if (!cur) {
      agg.set(id, { count: 1, highwayCount: t === "highway" ? 1 : 0, topType: t });
      return;
    }
    cur.count++;
    if (t === "highway") cur.highwayCount++;
    if (TYPE_RANK[t] > TYPE_RANK[cur.topType]) cur.topType = t;
  };
  for (const r of roads) {
    // Apply the same zoom/weight visibility filter as Road.tsx — a hub is
    // only meaningful for roads that are actually drawn at this scale.
    const style = ATLAS_STYLE.road[r.type];
    if (scale < style.minScale) continue;
    if (style.maxScale !== undefined && scale > style.maxScale) continue;
    const w = r.weight ?? 1;
    if (style.weightFloor !== undefined && w < style.weightFloor) continue;
    bump(r.fromCityId, r.type);
    bump(r.toCityId, r.type);
  }

  const elements: React.ReactNode[] = [];
  for (const [cityId, a] of agg) {
    if (a.count < 2) continue;
    const city = cityById.get(cityId);
    if (!city) continue;
    const [x, y] = city.position;
    const top = ATLAS_STYLE.road[a.topType];
    const casingWidth = top.casing?.width ?? top.fill.width;
    const casingColor = top.casing?.color ?? top.fill.color;
    // Disc radius = casing half-width, scaled to canvas units (casings use
    // non-scaling-stroke, i.e. they are drawn at `casingWidth` screen pixels
    // regardless of zoom — match that by dividing by `scale`).
    const r = (casingWidth / 2) / scale;
    elements.push(
      <circle
        key={`junc-${cityId}`}
        cx={x}
        cy={y}
        r={r}
        fill={casingColor}
      />,
    );

    // Interchange hub: only when ≥2 highway-tier roads meet here. Drawn as
    // a small white-cored disc rimmed in the highway casing color — reads
    // as an actual IC ring, not just another road cap.
    if (a.highwayCount >= 2) {
      const hwy = ATLAS_STYLE.road.highway;
      const ringR = 4.5 / scale;
      const innerR = 2 / scale;
      elements.push(
        <g key={`ic-${cityId}`}>
          <circle
            cx={x}
            cy={y}
            r={ringR}
            fill={hwy.fill.color}
            stroke={hwy.casing?.color ?? "#a87a3a"}
            strokeWidth={1.4 / scale}
          />
          <circle cx={x} cy={y} r={innerR} fill="#ffffff" />
        </g>,
      );
    }
  }

  return <g pointerEvents="none">{elements}</g>;
}
