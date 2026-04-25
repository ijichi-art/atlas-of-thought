import type { CityData, RoadData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// Catmull-Rom smoothing — same family as the river smoother.
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
}: {
  data: RoadData;
  cityById: Map<string, CityData>;
}) {
  const from = cityById.get(data.fromCityId);
  const to = cityById.get(data.toCityId);
  if (!from || !to) return null;
  const points: [number, number][] = [
    from.position,
    ...(data.waypoints ?? []),
    to.position,
  ];
  const d = smoothPath(points);
  const style = ATLAS_STYLE.road[data.type];

  return (
    <g data-road-id={data.id} pointerEvents="none">
      {style.casing && (
        <path
          d={d}
          fill="none"
          stroke={style.casing.color}
          strokeWidth={style.casing.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={style.fill.color}
        strokeWidth={style.fill.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={style.fill.dash}
        opacity={style.fill.opacity}
      />
    </g>
  );
}
