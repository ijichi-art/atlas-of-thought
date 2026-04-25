import type { CityData, RoadData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// Catmull-Rom smoothing.
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }
  const segs: string[] = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    segs.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`);
  }
  return segs.join(" ");
}

export function Road({
  data,
  cityById,
  scale,
  number,
}: {
  data: RoadData;
  cityById: Map<string, CityData>;
  scale: number;
  number: number;
}) {
  const from = cityById.get(data.fromCityId);
  const to = cityById.get(data.toCityId);
  if (!from || !to) return null;

  const style = ATLAS_STYLE.road[data.type];
  // Hide roads below their type's minScale to declutter at wide view.
  if (scale < style.minScale) return null;

  const points: [number, number][] = [
    from.position,
    ...(data.waypoints ?? []),
    to.position,
  ];
  const d = smoothPath(points);
  const inv = 1 / scale;

  // Midpoint of the line (close enough — for waypoint-less roads it's exact).
  const midPts = data.waypoints && data.waypoints.length > 0
    ? data.waypoints[Math.floor(data.waypoints.length / 2)]
    : ([
        (from.position[0] + to.position[0]) / 2,
        (from.position[1] + to.position[1]) / 2,
      ] as [number, number]);

  const showBadge = scale >= ATLAS_STYLE.roadNumber.minScale;
  const badge = ATLAS_STYLE.roadNumber;

  return (
    <g data-road-id={data.id} pointerEvents="none">
      {/* No casing — single solid stroke. vector-effect keeps stroke width
          constant on screen regardless of the SVG zoom transform. */}
      <path
        d={d}
        fill="none"
        stroke={style.fill.color}
        strokeWidth={style.fill.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={style.fill.opacity}
        vectorEffect="non-scaling-stroke"
      />

      {/* Number badge — inverse-scaled so it stays a constant size. */}
      {showBadge && (
        <g transform={`translate(${midPts[0]} ${midPts[1]}) scale(${inv})`}>
          <rect
            x={-badge.bgWidth / 2}
            y={-badge.bgHeight / 2}
            width={badge.bgWidth}
            height={badge.bgHeight}
            rx={badge.bgRadius}
            ry={badge.bgRadius}
            fill={badge.bgFill}
            stroke={badge.bgStroke}
            strokeWidth={badge.bgStrokeWidth}
          />
          <text
            x={0}
            y={badge.fontSize * 0.36}
            textAnchor="middle"
            fontFamily={ATLAS_STYLE.font.family}
            fontSize={badge.fontSize}
            fontWeight={badge.fontWeight}
            fill={badge.textColor}
          >
            {number}
          </text>
        </g>
      )}
    </g>
  );
}
