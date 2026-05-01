import type { CityData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";
import { builtUpPolygon, builtUpRadius, hashStr, smoothClosedPath } from "@/lib/city-geom";
import { CityBlocks } from "./CityBlocks";

// Single render pass for cluster city built-up areas, across ALL countries.
// Lives outside <Country> because country polygons on this map heavily
// overlap (each country's hull-plus-padding spans most of the canvas due
// to loose layout grouping). When built-ups were drawn inside per-country
// clipped <g> elements, a later country's opaque fill painted over the
// previous country's built-up — only the last one or two were visible.
// Hoisting the layer ensures every cluster above the density threshold
// renders on top of all country fills regardless of draw order.

const MIN_POIS_FOR_BUILT_UP = 7;
// Scale applied to the persisted builtUpR (which sizes the POI scatter at
// 0.6×R). Polygon expands ~60% past the POI cluster so the urban ring is
// visible around the dot cloud rather than being overwritten by it.
const POLY_SCALE = 1.6;

function effectiveBuiltUpR(city: CityData): number {
  const baseR = city.builtUpR ?? builtUpRadius(city.rank);
  return baseR * POLY_SCALE;
}

type BuildingRect = { x: number; y: number; w: number; h: number; rot: number };

function buildingsForCity(city: CityData): BuildingRect[] {
  const r = effectiveBuiltUpR(city);
  const target = Math.min(80, Math.max(16, Math.round((Math.PI * r * r) / 300)));
  let s = hashStr(city.id) ^ 0xc0ffee00;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const rot = (next() - 0.5) * (Math.PI / 6);
  const buildings: BuildingRect[] = [];
  let attempts = 0;
  while (buildings.length < target && attempts < target * 5) {
    attempts++;
    const ru = Math.sqrt(next()) * r * 0.85;
    const ang = next() * Math.PI * 2;
    const bx = city.position[0] + Math.cos(ang) * ru;
    const by = city.position[1] + Math.sin(ang) * ru;
    const w = 8 + next() * 12;
    const h = 8 + next() * 12;
    buildings.push({ x: bx, y: by, w, h, rot });
  }
  return buildings;
}

export function BuiltUpLayer({
  cities,
  scale,
}: {
  cities: CityData[];
  scale: number;
}) {
  const civ = ATLAS_STYLE.civil;
  const builtUpCities = cities.filter(
    (c) => (c.poiCount ?? 0) >= MIN_POIS_FOR_BUILT_UP,
  );

  return (
    <g pointerEvents="none">
      {/* Cluster built-up cores (darker beige) */}
      {builtUpCities.map((c) => {
        const poly = builtUpPolygon(c.position, effectiveBuiltUpR(c), hashStr(c.id));
        return <path key={`core-${c.id}`} d={smoothClosedPath(poly)} fill={civ.blobColor} />;
      })}

      {/* Building footprints */}
      {builtUpCities.flatMap((c) =>
        buildingsForCity(c).map((b, i) => (
          <rect
            key={`bldg-${c.id}-${i}`}
            x={b.x - b.w / 2}
            y={b.y - b.h / 2}
            width={b.w}
            height={b.h}
            fill="#a8916e"
            transform={`rotate(${(b.rot * 180) / Math.PI} ${b.x} ${b.y})`}
          />
        )),
      )}

      {/* Internal city street grid — visible only at street-level zoom.
          Pass ALL cities as Voronoi sites so each grid is bounded by its
          cluster's territory and adjacent clusters' grids don't overlap. */}
      <CityBlocks cities={builtUpCities} allCities={cities} scale={scale} />
    </g>
  );
}
