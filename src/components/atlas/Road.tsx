import type { CityData, RoadData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// Per-segment quadratic-bezier path. Each segment (W_i → W_{i+1}) gets a
// control point that is the segment midpoint pushed perpendicular. Both the
// magnitude AND the side of the perpendicular are derived from a hash of the
// two endpoints — i.e. the curve is a property of the SEGMENT, not the road.
// This is what makes bundling actually work: when two roads share a trunk
// segment (same endpoints, often after bundleSharedTrunks insertion), they
// render BIT-IDENTICALLY on that segment regardless of road type. Earlier
// versions varied magnitude by road type, which produced ghost-parallel
// strokes whenever a highway and an arterial bundled onto a shared trunk.
function hashSegment(p1: [number, number], p2: [number, number]): number {
  // Order-independent: segment (A,B) hashes the same as (B,A).
  const [a, b] = p1[0] + p1[1] * 1e3 < p2[0] + p2[1] * 1e3 ? [p1, p2] : [p2, p1];
  let h = 2166136261;
  for (const n of [a[0], a[1], b[0], b[1]]) {
    h ^= Math.round(n * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function controlPoint(
  p1: [number, number],
  p2: [number, number],
): [number, number] {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  if (len < 1) return [mx, my];
  const nx = -dy / len;
  const ny = dx / len;
  const h = hashSegment(p1, p2);
  // Magnitude in [0.07, 0.20] from the low bits of the hash; signed bend
  // direction from the high bits. Variety per segment, but consistent
  // across any road that traces it.
  const magnitude = 0.07 + ((h & 0xff) / 0xff) * 0.13;
  const signed = ((((h >>> 8) & 0xffff) % 2000) / 1000) - 1;
  const offset = magnitude * len * signed;
  return [mx + nx * offset, my + ny * offset];
}

function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [cx, cy] = controlPoint(points[i - 1], points[i]);
    path += ` Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${points[i][0]} ${points[i][1]}`;
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

  const labelStyle = ATLAS_STYLE.roadLabel;
  const showLabel =
    !!data.label &&
    scale >= labelStyle.minScale &&
    labelStyle.showOnTypes.includes(data.type);
  const labelPathId = `road-label-path-${data.id}`;

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
        id={labelPathId}
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

      {/* Road label along the path. fontSize / haloWidth divide by scale so
          the label stays a constant size on screen as the user zooms. */}
      {showLabel && (
        <text
          fontSize={labelStyle.fontSize / scale}
          fontWeight={labelStyle.fontWeight}
          fill={labelStyle.color}
          letterSpacing={labelStyle.letterSpacing / scale}
          style={{
            fontFamily: ATLAS_STYLE.font.family,
            paintOrder: "stroke fill",
            stroke: labelStyle.haloColor,
            strokeWidth: labelStyle.haloWidth / scale,
            strokeLinejoin: "round",
          }}
        >
          <textPath
            href={`#${labelPathId}`}
            startOffset="50%"
            textAnchor="middle"
          >
            {data.label}
          </textPath>
        </text>
      )}

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
            fontSize={badge.fontSize}
            fontWeight={badge.fontWeight}
            fill={badge.textColor}
            style={{ fontFamily: ATLAS_STYLE.font.family }}
          >
            {number}
          </text>
        </g>
      )}
    </g>
  );
}
