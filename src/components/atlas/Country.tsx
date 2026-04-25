import type { CountryData } from "@/types/atlas";

function polygonCentroid(points: [number, number][]): [number, number] {
  const [sx, sy] = points.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / points.length, sy / points.length];
}

// Smooth a polygon by Catmull-Rom interpolation → soft, organic coastlines.
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
    // Catmull-Rom → Bezier
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
  const [cx, cy] = polygonCentroid(data.polygon);
  const inv = 1 / scale;
  const path = smoothPath(data.polygon);

  return (
    <g data-country-id={data.id}>
      {/* Soft halo behind the country (subtle "land glow" against the sea) */}
      <path d={path} fill={data.color} opacity={0.4} transform={`translate(0 4)`} filter="url(#country-inset)" />
      {/* Main land mass */}
      <path
        d={path}
        fill={data.color}
        stroke="#9aa3aa"
        strokeWidth={1.1}
        strokeLinejoin="round"
        filter="url(#country-inset)"
      />

      {/* Country label — large, uppercase, wide letter-spacing — Google Maps city-name style. */}
      <g transform={`translate(${cx} ${cy}) scale(${inv})`} pointerEvents="none">
        <text
          textAnchor="middle"
          fontFamily='"Helvetica Neue", -apple-system, system-ui, sans-serif'
          fontSize={20}
          fontWeight={500}
          fill="#3a3a36"
          letterSpacing={5}
          style={{
            paintOrder: "stroke fill",
            stroke: "#f5f3ef",
            strokeWidth: 5,
            strokeLinejoin: "round",
            textTransform: "uppercase",
            opacity: 0.78,
          }}
        >
          {data.name.toUpperCase()}
        </text>
        {data.nameJa && (
          <text
            textAnchor="middle"
            y={20}
            fontFamily='"Helvetica Neue", -apple-system, system-ui, sans-serif'
            fontSize={13}
            fontWeight={400}
            fill="#6a655e"
            letterSpacing={3}
            style={{
              paintOrder: "stroke fill",
              stroke: "#f5f3ef",
              strokeWidth: 4,
              strokeLinejoin: "round",
              opacity: 0.78,
            }}
          >
            {data.nameJa}
          </text>
        )}
      </g>
    </g>
  );
}
