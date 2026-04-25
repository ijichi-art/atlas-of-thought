import type { CityData } from "@/types/atlas";

// City rank → visual style. Constant-on-screen sizing is achieved by the
// inverse-scale group that wraps each label, fed by the live zoom `scale`.
const PIN = {
  capital: {
    outerR: 6.5,
    innerR: 3,
    fontSize: 13,
    fontWeight: 700,
    labelDy: 18,
    minScale: 0,
  },
  city: {
    outerR: 4.5,
    innerR: 2,
    fontSize: 11,
    fontWeight: 600,
    labelDy: 14,
    minScale: 0.55,
  },
  town: {
    outerR: 3,
    innerR: 0,
    fontSize: 9.5,
    fontWeight: 500,
    labelDy: 11,
    minScale: 1.0,
  },
} as const;

export function City({
  data,
  selected,
  onSelect,
  scale,
}: {
  data: CityData;
  selected: boolean;
  onSelect: (id: string) => void;
  scale: number;
}) {
  const style = PIN[data.rank];
  const [cx, cy] = data.position;
  const inv = 1 / scale;
  const showLabel = scale >= style.minScale;
  const isCapital = data.rank === "capital";

  return (
    <g
      data-city-id={data.id}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(data.id);
      }}
      className="cursor-pointer"
    >
      {/* Selection halo */}
      {selected && (
        <circle
          cx={cx}
          cy={cy}
          r={style.outerR + 5}
          fill="#3367d6"
          opacity={0.18}
        />
      )}

      {/* Pin: capital is white-on-dark double ring; city is filled dot; town is small dot. */}
      {isCapital ? (
        <g filter="url(#pin-shadow)">
          <circle cx={cx} cy={cy} r={style.outerR} fill="#ffffff" stroke="#3a3a36" strokeWidth={1.4} />
          <circle cx={cx} cy={cy} r={style.innerR} fill="#3a3a36" />
        </g>
      ) : data.rank === "city" ? (
        <g filter="url(#pin-shadow)">
          <circle cx={cx} cy={cy} r={style.outerR} fill="#3a3a36" stroke="#ffffff" strokeWidth={1.2} />
        </g>
      ) : (
        <circle cx={cx} cy={cy} r={style.outerR} fill="#5a5650" />
      )}

      {/* Label — inverse-scaled so on-screen size stays constant regardless of zoom. */}
      {showLabel && (
        <g transform={`translate(${cx} ${cy + style.labelDy * inv}) scale(${inv})`} pointerEvents="none">
          {/* Halo for legibility against terrain */}
          <text
            textAnchor="middle"
            fontFamily='"Helvetica Neue", -apple-system, system-ui, sans-serif'
            fontSize={style.fontSize}
            fontWeight={style.fontWeight}
            fill="#1f1d1a"
            style={{
              paintOrder: "stroke fill",
              stroke: "#f5f3ef",
              strokeWidth: 4,
              strokeLinejoin: "round",
              letterSpacing: isCapital ? "0.3px" : "0px",
            }}
          >
            {data.label}
          </text>
          {data.labelJa && data.rank !== "town" && (
            <text
              y={style.fontSize + 1}
              textAnchor="middle"
              fontFamily='"Helvetica Neue", -apple-system, system-ui, sans-serif'
              fontSize={Math.round(style.fontSize * 0.78)}
              fontWeight={400}
              fill="#5a5650"
              style={{
                paintOrder: "stroke fill",
                stroke: "#f5f3ef",
                strokeWidth: 3.5,
                strokeLinejoin: "round",
              }}
            >
              {data.labelJa}
            </text>
          )}
        </g>
      )}
    </g>
  );
}
