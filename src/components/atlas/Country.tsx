import type { CountryData } from "@/types/atlas";
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

export function Country({ data, scale }: { data: CountryData; scale: number }) {
  const T = ATLAS_STYLE.country;
  const [cx, cy] = polygonCentroid(data.polygon);
  const inv = 1 / scale;
  const path = smoothPath(data.polygon);

  return (
    <g data-country-id={data.id}>
      {/* Soft halo behind the country */}
      <path
        d={path}
        fill={data.color}
        opacity={T.haloOpacity}
        transform={`translate(0 ${T.haloOffsetY})`}
        filter="url(#country-inset)"
      />
      {/* Main land mass */}
      <path
        d={path}
        fill={data.color}
        stroke={T.strokeColor}
        strokeWidth={T.strokeWidth}
        strokeLinejoin="round"
        filter="url(#country-inset)"
      />

      {/* Country label — large, uppercase, wide letter-spacing. Inverse-scaled. */}
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
