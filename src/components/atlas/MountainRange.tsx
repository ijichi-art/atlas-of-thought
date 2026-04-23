import type { MountainRangeData } from "@/types/atlas";

// Google-Maps-style: a few small flat triangle markers in a muted green-gray.
// No snow caps, no shadow, no italic Latin name floating in space.
export function MountainRange({ data }: { data: MountainRangeData }) {
  if (data.spine.length < 1) return null;

  return (
    <g data-mountain-id={data.id} pointerEvents="none">
      {data.spine.map(([x, y], i) => {
        const w = 7;
        const h = 9;
        const tri = `${x - w},${y + h * 0.4} ${x},${y - h * 0.6} ${x + w},${y + h * 0.4}`;
        return (
          <polygon
            key={`${data.id}-${i}`}
            points={tri}
            fill="#b8b8a8"
            stroke="#a0a090"
            strokeWidth={0.5}
          />
        );
      })}
    </g>
  );
}
