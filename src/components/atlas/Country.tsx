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

  const biomeKey = pickBiome(data.name);
  const fillColor = T.useUniformFill ? T.fillColor : ATLAS_STYLE.biome[biomeKey];

  const clipId = `country-clip-${data.id}`;
  const gradientId = `civil-grad-${data.id}`;

  return (
    <g data-country-id={data.id}>
      <defs>
        <clipPath id={clipId}>
          <path d={path} />
        </clipPath>
        {/* Per-city radial gradient: white at center, fading to transparent. */}
        <radialGradient id={gradientId}>
          <stop offset={`${civ.blobInnerStop * 100}%`} stopColor="#fbf7ee" stopOpacity={civ.blobInnerOpacity} />
          <stop offset={`${civ.blobOuterStop * 100}%`} stopColor="#fbf7ee" stopOpacity={civ.blobOuterOpacity} />
        </radialGradient>
      </defs>

      {/* Soft halo behind the country (no-op when haloOpacity=0) */}
      {T.haloOpacity > 0 && (
        <path
          d={path}
          fill={fillColor}
          opacity={T.haloOpacity}
          transform={`translate(0 ${T.haloOffsetY})`}
          filter="url(#country-inset)"
        />
      )}

      {/* Land mass — biome colour fills the country. */}
      <path
        d={path}
        fill={fillColor}
        filter="url(#country-inset)"
      />

      {/* Civil "white" blobs over each city, clipped to this country only.
          Their radial gradients fade out — far-from-cities areas keep the biome colour. */}
      <g clipPath={`url(#${clipId})`}>
        {cities.map((c) => (
          <circle
            key={c.id}
            cx={c.position[0]}
            cy={c.position[1]}
            r={civ.blobRadius}
            fill={`url(#${gradientId})`}
          />
        ))}
      </g>

      {/* Country border (drawn over the biome+blobs) */}
      <path
        d={path}
        fill="none"
        stroke={T.strokeColor}
        strokeWidth={T.strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Country label */}
      <g transform={`translate(${cx} ${cy}) scale(${inv})`} pointerEvents="none">
        <text
          textAnchor="middle"
          fontFamily={ATLAS_STYLE.font.family}
          fontSize={T.label.fontSize}
          fontWeight={T.label.fontWeight}
          fill={T.label.color}
          letterSpacing={T.label.letterSpacing}
          style={{
            paintOrder: "stroke fill",
            stroke: T.label.haloColor,
            strokeWidth: T.label.haloWidth,
            strokeLinejoin: "round",
            textTransform: T.label.uppercase ? "uppercase" : "none",
            opacity: T.label.opacity,
          }}
        >
          {T.label.uppercase ? data.name.toUpperCase() : data.name}
        </text>
        {data.nameJa && (
          <text
            textAnchor="middle"
            y={T.label.jaOffsetY}
            fontFamily={ATLAS_STYLE.font.family}
            fontSize={T.label.jaFontSize}
            fontWeight={T.label.jaFontWeight}
            fill={T.label.jaColor}
            letterSpacing={T.label.jaLetterSpacing}
            style={{
              paintOrder: "stroke fill",
              stroke: T.label.haloColor,
              strokeWidth: T.label.jaHaloWidth,
              strokeLinejoin: "round",
              opacity: T.label.opacity,
            }}
          >
            {data.nameJa}
          </text>
        )}
      </g>
    </g>
  );
}
