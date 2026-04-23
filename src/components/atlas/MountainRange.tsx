import type { MountainRangeData, Point } from "@/types/atlas";

// Google-Maps-style mountains: not pin icons but a continuous forest-green
// area with organic edges and a south-east hill shadow. Each spine point
// becomes the center of a translucent green blob; consecutive blobs overlap
// so the range reads as one ridge of forested peaks.

const FOREST_OUTER = "#bccdb0";
const FOREST_INNER = "#9eb695";

// Deterministic PRNG so blobs don't reshuffle between renders.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Build an irregular blob polygon path centered at (cx, cy) with average
// radius ~r and ±jitter on each radial sample. The polygon is closed.
function blobPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  jitter: number,
  rng: () => number,
  samples = 14
): string {
  const pts: Point[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const j = 1 + (rng() * 2 - 1) * jitter;
    const x = cx + Math.cos(t) * rx * j;
    const y = cy + Math.sin(t) * ry * j;
    pts.push([x, y]);
  }
  // Smooth via Catmull-Rom-ish for organic curves.
  const p = pts;
  const n = p.length;
  const segs: string[] = [`M ${p[0][0]} ${p[0][1]}`];
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n];
    const p1 = p[i];
    const p2 = p[(i + 1) % n];
    const p3 = p[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    segs.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`);
  }
  segs.push("Z");
  return segs.join(" ");
}

export function MountainRange({ data }: { data: MountainRangeData }) {
  if (data.spine.length < 1) return null;
  const rng = mulberry32(hashId(data.id));

  return (
    <g data-mountain-id={data.id} pointerEvents="none">
      {/* Outer forest blobs (lighter, larger, with hill shadow) */}
      <g filter="url(#hill-shade)">
        {data.spine.map(([x, y], i) => (
          <path
            key={`${data.id}-outer-${i}`}
            d={blobPath(x, y, 36, 30, 0.18, rng)}
            fill={FOREST_OUTER}
            opacity={0.78}
          />
        ))}
      </g>
      {/* Inner darker patches for depth */}
      {data.spine.map(([x, y], i) => (
        <path
          key={`${data.id}-inner-${i}`}
          d={blobPath(x + 2, y + 1, 22, 18, 0.22, rng)}
          fill={FOREST_INNER}
          opacity={0.55}
        />
      ))}
    </g>
  );
}
