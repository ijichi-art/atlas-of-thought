import type { CityData, RoadData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// Pure linear path. Catmull-Rom was producing visually-parallel "ghost" roads
// between bundled paths because each curve segment's control points depend on
// the FAR endpoints of the road (not just the local segment). Two roads going
// city A → SAME centroid A → SAME centroid B → city B would have IDENTICAL
// waypoints but still curve apart, since their distinct city endpoints
// influenced the Catmull-Rom control points along the entire path.
//
// Linear segments guarantee that any two roads sharing a (waypoint_i,
// waypoint_{i+1}) pair render the EXACT same line for that segment → physical
// bundling on the trunk, divergence only at the city endpoints.
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i][0]} ${points[i][1]}`;
  }
  return path;
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
      {/* Casing (drawn first, wider) — gives roads the Google-Maps double-stroke look. */}
      {style.casing && (
        <path
          d={d}
          fill="none"
          stroke={style.casing.color}
          strokeWidth={style.casing.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* Fill (drawn on top, narrower). vector-effect keeps stroke width
          constant on screen regardless of the SVG zoom transform. */}
      <path
        d={d}
        fill="none"
        stroke={style.fill.color}
        strokeWidth={style.fill.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={style.fill.opacity}
        strokeDasharray={style.fill.dash}
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
