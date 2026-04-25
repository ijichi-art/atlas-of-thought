import type { CountryData } from "@/types/atlas";

function polygonCentroid(points: [number, number][]): [number, number] {
  const [sx, sy] = points.reduce(
    ([ax, ay], [x, y]) => [ax + x, ay + y],
    [0, 0]
  );
  return [sx / points.length, sy / points.length];
}

export function Country({ data, scale }: { data: CountryData; scale: number }) {
  const path = data.polygon.map(([x, y]) => `${x},${y}`).join(" ");
  const [cx, cy] = polygonCentroid(data.polygon);
  const inv = 1 / scale;

  return (
    <g data-country-id={data.id}>
      {/* Land mass — flat pastel fill, very thin border (Google Maps style) */}
      <polygon
        points={path}
        fill={data.color}
        stroke="#c8c2b6"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      {/* Country label — inverse-scaled to keep on-screen size constant across zoom */}
      <g transform={`translate(${cx} ${cy}) scale(${inv})`} pointerEvents="none">
        <text
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, 'Helvetica Neue', sans-serif"
          fontSize={13}
          fontWeight={500}
          fill="#7a7166"
          letterSpacing={4}
          style={{ textTransform: "uppercase" }}
        >
          {data.name.toUpperCase()}
        </text>
        {data.nameJa && (
          <text
            textAnchor="middle"
            y={15}
            fontFamily="system-ui, -apple-system, sans-serif"
            fontSize={10}
            fill="#9c9388"
            letterSpacing={2}
          >
            {data.nameJa}
          </text>
        )}
      </g>
    </g>
  );
}
