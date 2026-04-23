import type { RiverData } from "@/types/atlas";

// Catmull-Rom-ish smoothing so rivers don't render as zig-zag polylines.
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

export function River({ data }: { data: RiverData }) {
  // Google-Maps-style river: flat pale blue line, no shadow / no double stroke.
  return (
    <g data-river-id={data.id} pointerEvents="none">
      <path
        d={smoothPath(data.path)}
        stroke="#aaccdd"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}
