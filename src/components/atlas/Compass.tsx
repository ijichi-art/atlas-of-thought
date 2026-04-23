// Minimal Google-Maps-style compass. Flat, white background, simple needle.

export function Compass({ size = 44 }: { size?: number }) {
  const r = size / 2;
  const c = r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))" }}
    >
      <circle cx={c} cy={c} r={r - 1} fill="#ffffff" stroke="#d8d4cc" strokeWidth={1} />
      {/* North needle */}
      <polygon
        points={`${c},${c - (r - 6)} ${c - 5},${c} ${c + 5},${c}`}
        fill="#d04040"
      />
      {/* South needle */}
      <polygon
        points={`${c},${c + (r - 6)} ${c - 5},${c} ${c + 5},${c}`}
        fill="#7a7166"
      />
      <circle cx={c} cy={c} r={1.6} fill="#3a3a36" />
    </svg>
  );
}
