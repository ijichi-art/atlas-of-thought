import type { CityData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

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
  const pin = ATLAS_STYLE.cityPin[data.rank];
  const lab = ATLAS_STYLE.cityLabel[data.rank];
  const [cx, cy] = data.position;
  const inv = 1 / scale;
  const showLabel = scale >= lab.minScale;
  const isCapital = data.rank === "capital";
  const isCity = data.rank === "city";

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
          r={pin.outerR + ATLAS_STYLE.cityPin.selectionHaloPad}
          fill={ATLAS_STYLE.cityPin.selectionHaloColor}
          opacity={ATLAS_STYLE.cityPin.selectionHaloOpacity}
        />
      )}

      {/* Pin */}
      {isCapital ? (
        <g filter={pin.shadow ? "url(#pin-shadow)" : undefined}>
          <circle
            cx={cx}
            cy={cy}
            r={pin.outerR}
            fill={pin.fillOuter}
            stroke={pin.strokeColor}
            strokeWidth={pin.strokeWidth}
          />
          <circle cx={cx} cy={cy} r={ATLAS_STYLE.cityPin.capital.innerR} fill={ATLAS_STYLE.cityPin.capital.fillInner} />
        </g>
      ) : isCity ? (
        <g filter={pin.shadow ? "url(#pin-shadow)" : undefined}>
          <circle
            cx={cx}
            cy={cy}
            r={pin.outerR}
            fill={pin.fillOuter}
            stroke={pin.strokeColor}
            strokeWidth={pin.strokeWidth}
          />
        </g>
      ) : (
        <circle cx={cx} cy={cy} r={pin.outerR} fill={pin.fillOuter} />
      )}

      {/* Label — inverse-scaled so on-screen size stays constant. */}
      {showLabel && (
        <g
          transform={`translate(${cx} ${cy + lab.labelDy * inv}) scale(${inv})`}
          pointerEvents="none"
        >
          <text
            textAnchor="middle"
            fontFamily={ATLAS_STYLE.font.family}
            fontSize={lab.fontSize}
            fontWeight={lab.fontWeight}
            fill={lab.color}
            style={{
              paintOrder: "stroke fill",
              stroke: lab.haloColor,
              strokeWidth: lab.haloWidth,
              strokeLinejoin: "round",
              letterSpacing: `${lab.letterSpacing}px`,
            }}
          >
            {data.label}
          </text>
          {data.labelJa && lab.showJa && (
            <text
              y={lab.fontSize + 1}
              textAnchor="middle"
              fontFamily={ATLAS_STYLE.font.family}
              fontSize={Math.round(lab.fontSize * lab.jaFontSizeRatio)}
              fontWeight={lab.jaFontWeight}
              fill={lab.jaColor}
              style={{
                paintOrder: "stroke fill",
                stroke: lab.haloColor,
                strokeWidth: lab.jaHaloWidth,
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
