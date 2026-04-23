import type { CityData } from "@/types/atlas";

// Simple deterministic PRNG so each city's "skyline" layout stays stable
// across renders without us shipping a heavyweight RNG.
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

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PIN = {
  capital: {
    outerR: 9,
    innerR: 5,
    centerR: 1.8,
    fontSize: 13,
    fontWeight: 600,
    labelDy: 22,
  },
  city: { outerR: 6, innerR: 3.5, centerR: 0, fontSize: 11, fontWeight: 500, labelDy: 17 },
  town: { outerR: 3.2, innerR: 0, centerR: 0, fontSize: 9.5, fontWeight: 400, labelDy: 12 },
} as const;

function densityBuildings(city: CityData) {
  const d = Math.max(0, Math.min(10, city.urbanDensity));
  if (d < 1) return [];
  const count = Math.round(d * 1.4);
  const rng = mulberry32(hashId(city.id));
  const [cx, cy] = city.position;
  const ring = PIN[city.rank].outerR + 6;
  const span = 18 + d * 1.4;
  return Array.from({ length: count }, (_, i) => {
    const angle = rng() * Math.PI * 2;
    const radius = ring + rng() * span;
    const w = 2.4 + rng() * 2.6;
    const h = 4 + rng() * (4 + d * 0.6);
    const bx = cx + Math.cos(angle) * radius - w / 2;
    const by = cy + Math.sin(angle) * radius - h;
    return { key: `${city.id}-bldg-${i}`, x: bx, y: by, w, h };
  });
}

export function City({
  data,
  selected,
  onSelect,
}: {
  data: CityData;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const style = PIN[data.rank];
  const [cx, cy] = data.position;
  const buildings = densityBuildings(data);

  return (
    <g
      data-city-id={data.id}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(data.id);
      }}
      className="cursor-pointer"
    >
      {/* Density skyline (rendered behind the pin) */}
      {buildings.map((b) => (
        <rect
          key={b.key}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill="#9b9384"
          opacity={0.55}
        />
      ))}

      {/* Selection ring */}
      {selected && (
        <circle
          cx={cx}
          cy={cy}
          r={style.outerR + 6}
          fill="none"
          stroke="#3367d6"
          strokeWidth={2}
          opacity={0.85}
        />
      )}

      {/* Pin */}
      {data.rank === "capital" && (
        <>
          <circle cx={cx} cy={cy} r={style.outerR} fill="#ffffff" stroke="#3a3a36" strokeWidth={1.4} />
          <circle cx={cx} cy={cy} r={style.innerR} fill="#3a3a36" />
          <circle cx={cx} cy={cy} r={style.centerR} fill="#ffffff" />
        </>
      )}
      {data.rank === "city" && (
        <>
          <circle cx={cx} cy={cy} r={style.outerR} fill="#3a3a36" stroke="#ffffff" strokeWidth={1.6} />
        </>
      )}
      {data.rank === "town" && (
        <circle cx={cx} cy={cy} r={style.outerR} fill="#3a3a36" />
      )}

      {/* Label */}
      <text
        x={cx}
        y={cy + style.labelDy}
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize={style.fontSize}
        fontWeight={style.fontWeight}
        fill="#3a3a36"
        pointerEvents="none"
        style={{
          paintOrder: "stroke fill",
          stroke: "#f5f3ef",
          strokeWidth: 3,
          strokeLinejoin: "round",
        }}
      >
        {data.label}
      </text>
      {data.labelJa && data.rank !== "town" && (
        <text
          x={cx}
          y={cy + style.labelDy + style.fontSize + 1}
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontSize={Math.round(style.fontSize * 0.8)}
          fill="#7a7166"
          pointerEvents="none"
          style={{
            paintOrder: "stroke fill",
            stroke: "#f5f3ef",
            strokeWidth: 3,
            strokeLinejoin: "round",
          }}
        >
          {data.labelJa}
        </text>
      )}
    </g>
  );
}
