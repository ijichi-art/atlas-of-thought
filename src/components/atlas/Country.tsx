import type { CountryData, CityData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";
import {
  builtUpPolygon,
  builtUpRadius,
  hashStr,
  smoothClosedPath,
} from "@/lib/city-geom";
import { CityBlocks } from "./CityBlocks";

function polygonCentroid(points: [number, number][]): [number, number] {
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / points.length, sy / points.length];
}

// Deterministic biome (forest vs desert) per country name.
function pickBiome(name: string): "forest" | "desert" {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = (h * 16777619) | 0;
  }
  return ((h >>> 0) & 1) === 0 ? "forest" : "desert";
}

// City-level built-up disk radius. Cluster cities now ship a builtUpR field
// from terraform (sized by POI count); fall back to rank-based defaults for
// any leftover legacy data.
function effectiveBuiltUpR(city: CityData): number {
  return city.builtUpR ?? builtUpRadius(city.rank);
}

// Country-level parks: 5-10 green polygons scattered inside each country
// to break up the otherwise-uniform beige and match real Google Maps where
// the city is mostly built-up with the occasional Bryant Park / Central
// Park / Pershing Square. Sized small relative to the country and placed
// AWAY from cluster cities so they look like genuine open space, not
// chunks bitten out of the urban fabric.
function countryLevelParks(
  countryPath: [number, number][],
  cities: CityData[],
  countryId: string,
): Array<[number, number][]> {
  if (countryPath.length < 3) return [];
  // Country bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of countryPath) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const cityCenters = cities.map((c) => ({ pos: c.position, r: effectiveBuiltUpR(c) }));

  // 5-10 parks scaled by country area.
  const target = Math.min(10, Math.max(4, Math.round(Math.sqrt(w * h) / 200)));
  let s = hashStr(countryId) ^ 0xb33fb33f;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const polys: Array<[number, number][]> = [];
  let attempts = 0;
  while (polys.length < target && attempts < target * 30) {
    attempts++;
    const cx = minX + next() * w;
    const cy = minY + next() * h;
    // Park radius: 25-55 px.
    const r = 25 + next() * 30;
    // Reject if it would land inside any cluster city's built-up disk
    // (keep parks visually outside dense beige cores).
    let tooClose = false;
    for (const cc of cityCenters) {
      const dx = cc.pos[0] - cx;
      const dy = cc.pos[1] - cy;
      if (Math.hypot(dx, dy) < cc.r + r * 0.5) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    polys.push(builtUpPolygon([cx, cy], r, s));
  }
  return polys;
}

// Building footprints inside a cluster city's built-up disk. Small light
// rectangles, irregular grid — gives the beige interior the Manhattan-style
// "thousands of buildings packed together" texture instead of reading as
// a flat blob. Count scales with the city's built-up R.
type BuildingRect = { x: number; y: number; w: number; h: number; rot: number };
function buildingsForCity(city: CityData): BuildingRect[] {
  const r = effectiveBuiltUpR(city);
  // Doubled density — Manhattan reads as a dense field of buildings, not a
  // few sparse rects. Capped 80 to keep render cost reasonable.
  const target = Math.min(80, Math.max(16, Math.round((Math.PI * r * r) / 300)));
  let s = hashStr(city.id) ^ 0xc0ffee00;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  // Per-city rotation (orientation of the "block" — buildings line up).
  const rot = (next() - 0.5) * (Math.PI / 6); // ±15°
  const buildings: BuildingRect[] = [];
  let attempts = 0;
  while (buildings.length < target && attempts < target * 5) {
    attempts++;
    // Position uniformly in disk (sqrt for area uniformity).
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

export function Country({
  data,
  scale,
  cities,
}: {
  data: CountryData;
  scale: number;
  cities: CityData[];
}) {
  const T = ATLAS_STYLE.country;
  const civ = ATLAS_STYLE.civil;
  const [cx, cy] = polygonCentroid(data.polygon);
  const inv = 1 / scale;
  const path = smoothClosedPath(data.polygon);

  // Country labels fade out as the user zooms in (full at wide view → 0 at detail).
  const fadeFactor =
    scale <= T.label.fadeStart
      ? 1
      : scale >= T.label.fadeEnd
        ? 0
        : 1 - (scale - T.label.fadeStart) / (T.label.fadeEnd - T.label.fadeStart);
  const labelOpacity = T.label.opacity * fadeFactor;

  const biomeKey = pickBiome(data.name);
  const fillColor = T.useUniformFill ? T.fillColor : ATLAS_STYLE.biome[biomeKey];

  const clipId = `country-clip-${data.id}`;

  return (
    <g data-country-id={data.id}>
      <defs>
        <clipPath id={clipId}>
          <path d={path} />
        </clipPath>
      </defs>

      {/* Soft halo behind the country (no-op when haloOpacity=0) */}
      {T.haloOpacity > 0 && (
        <path
          d={path}
          fill={fillColor}
          opacity={T.haloOpacity}
          transform={`translate(0 ${T.haloOffsetY})`}
        />
      )}

      {/* Land mass — flat fill (no inner shadow). */}
      <path d={path} fill={fillColor} />

      {/* Country interior — composed bottom-to-top:
            1. Country-level park overlays (green) — exception against the
               otherwise-uniform beige country fill.
            2. Cluster city built-up cores (slightly darker beige).
            3. Building footprints inside cluster cities (Manhattan texture).
            4. Internal street grids (CityBlocks).
          All clipped to the country polygon. */}
      <g clipPath={`url(#${clipId})`}>
        {/* Country-level parks */}
        {countryLevelParks(data.polygon, cities, data.id).map((poly, i) => (
          <path
            key={`park-${data.id}-${i}`}
            d={smoothClosedPath(poly)}
            fill={ATLAS_STYLE.biome.forest}
          />
        ))}

        {/* Cluster city built-up cores */}
        {cities.map((c) => {
          const poly = builtUpPolygon(c.position, effectiveBuiltUpR(c), hashStr(c.id));
          return <path key={c.id} d={smoothClosedPath(poly)} fill={civ.blobColor} />;
        })}

        {/* Building footprints */}
        {cities.flatMap((c) =>
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

        {/* Internal city street grid — visible only at street-level zoom. */}
        <CityBlocks cities={cities} scale={scale} />
      </g>

      {/* Country border — dotted line, modern map style. */}
      <path
        d={path}
        fill="none"
        stroke={T.strokeColor}
        strokeWidth={T.strokeWidth}
        strokeDasharray={T.strokeDash}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Country label — hidden once fully faded out at high zoom. */}
      {labelOpacity > 0 && (
        <g transform={`translate(${cx} ${cy}) scale(${inv})`} pointerEvents="none">
          <text
            textAnchor="middle"
            fontSize={T.label.fontSize}
            fontWeight={T.label.fontWeight}
            fill={T.label.color}
            letterSpacing={T.label.letterSpacing}
            style={{
              fontFamily: ATLAS_STYLE.font.family,
              paintOrder: "stroke fill",
              stroke: T.label.haloColor,
              strokeWidth: T.label.haloWidth,
              strokeLinejoin: "round",
              textTransform: T.label.uppercase ? "uppercase" : "none",
              opacity: labelOpacity,
            }}
          >
            {T.label.uppercase ? data.name.toUpperCase() : data.name}
          </text>
          {data.nameJa && (
            <text
              textAnchor="middle"
              y={T.label.jaOffsetY}
              fontSize={T.label.jaFontSize}
              fontWeight={T.label.jaFontWeight}
              fill={T.label.jaColor}
              letterSpacing={T.label.jaLetterSpacing}
              style={{
                fontFamily: ATLAS_STYLE.font.family,
                paintOrder: "stroke fill",
                stroke: T.label.haloColor,
                strokeWidth: T.label.jaHaloWidth,
                strokeLinejoin: "round",
                opacity: labelOpacity,
              }}
            >
              {data.nameJa}
            </text>
          )}
        </g>
      )}
    </g>
  );
}
