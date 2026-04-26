import type { CountryData, CityData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

function polygonCentroid(points: [number, number][]): [number, number] {
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / points.length, sy / points.length];
}

// Catmull-Rom interpolation → soft, organic coastlines.
function smoothPath(points: [number, number][]): string {
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
    cmds.push(`C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0]} ${p2[1]}`);
  }
  cmds.push("Z");
  return cmds.join(" ");
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

// Per-city built-up area: irregular polygon (12 radial points with seeded
// random radii) instead of a perfect circle, so urban regions look like real
// city footprints rather than blobs. Radius scales with city rank.
function builtUpRadius(rank: CityData["rank"]): number {
  switch (rank) {
    case "capital":
      return 100; // spec: 80–120
    case "city":
      return 65; // spec: 50–80
    case "town":
      return 30; // spec: 25–50
  }
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function builtUpPolygon(
  center: [number, number],
  baseR: number,
  seed: number,
): [number, number][] {
  const N = 12;
  let s = seed >>> 0;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const r = baseR * (0.65 + 0.35 * (s / 0xffffffff));
    const angle = (i / N) * Math.PI * 2;
    pts.push([center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r]);
  }
  return pts;
}

// Synthetic parks scattered inside each city's built-up area. Clipped to the
// country polygon so parks never spill outside borders. Per spec rule F:
// 1–3 parks per city, var(--map-park) green, irregular polygon.
function parksForCity(city: CityData): Array<[number, number][]> {
  const count = city.rank === "capital" ? 2 : city.rank === "city" ? 1 : 0;
  if (count === 0) return [];
  const parkBaseR = city.rank === "capital" ? 32 : 22;
  const cityR = builtUpRadius(city.rank);
  let s = hashStr(city.id) ^ 0xa5a5a5a5;
  const polys: Array<[number, number][]> = [];
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const angle = (s / 0xffffffff) * Math.PI * 2;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const dist = (s / 0xffffffff) * cityR * 0.55;
    const px = city.position[0] + Math.cos(angle) * dist;
    const py = city.position[1] + Math.sin(angle) * dist;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const r = parkBaseR * (0.75 + 0.35 * (s / 0xffffffff));
    polys.push(builtUpPolygon([px, py], r, s));
  }
  return polys;
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
  const path = smoothPath(data.polygon);

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

      {/* Built-up areas + parks per city, both clipped to the country so they
          never spill across borders. Built-up beige first, parks layered over. */}
      <g clipPath={`url(#${clipId})`}>
        {cities.map((c) => {
          const poly = builtUpPolygon(c.position, builtUpRadius(c.rank), hashStr(c.id));
          return <path key={c.id} d={smoothPath(poly)} fill={civ.blobColor} />;
        })}
        {cities.flatMap((c) =>
          parksForCity(c).map((poly, i) => (
            <path
              key={`park-${c.id}-${i}`}
              d={smoothPath(poly)}
              fill={ATLAS_STYLE.biome.forest}
            />
          )),
        )}
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
