import type { CityData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// City pins are drawn at constant on-screen size: we wrap them in an
// inverse-scale transform so that as the user zooms in, the pin doesn't
// inflate. The same wrapping handles the selection halo.
//
// Pin geometry (radii, stroke widths) is in atlas-style.ts.

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
      {/* Inverse-scaled pin group: shapes drawn at origin, group translated +
          scaled to keep on-screen size constant across zoom levels. */}
      <g transform={`translate(${cx} ${cy}) scale(${inv})`}>
        {selected && (
          <circle
            cx={0}
            cy={0}
            r={pin.outerR + ATLAS_STYLE.cityPin.selectionHaloPad}
            fill={ATLAS_STYLE.cityPin.selectionHaloColor}
            opacity={ATLAS_STYLE.cityPin.selectionHaloOpacity}
          />
        )}

        {isCapital ? (
          <g filter={pin.shadow ? "url(#pin-shadow)" : undefined}>
            <circle
              cx={0}
              cy={0}
              r={pin.outerR}
              fill={pin.fillOuter}
              stroke={pin.strokeColor}
              strokeWidth={pin.strokeWidth}
            />
            <circle
              cx={0}
              cy={0}
              r={ATLAS_STYLE.cityPin.capital.innerR}
              fill={ATLAS_STYLE.cityPin.capital.fillInner}
            />
          </g>
        ) : isCity ? (
          <g filter={pin.shadow ? "url(#pin-shadow)" : undefined}>
            <circle
              cx={0}
              cy={0}
              r={pin.outerR}
              fill={pin.fillOuter}
              stroke={pin.strokeColor}
              strokeWidth={pin.strokeWidth}
            />
          </g>
        ) : (
          <circle cx={0} cy={0} r={pin.outerR} fill={pin.fillOuter} />
        )}
      </g>

      {/* Label — inverse-scaled so on-screen size stays constant. */}
      {showLabel && (
        <g
          transform={`translate(${cx} ${cy + lab.labelDy * inv}) scale(${inv})`}
          pointerEvents="none"
        >
          <text
            textAnchor="middle"
            fontSize={lab.fontSize}
            fontWeight={lab.fontWeight}
            fill={lab.color}
            style={{
              fontFamily: ATLAS_STYLE.font.family,
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
              fontSize={Math.round(lab.fontSize * lab.jaFontSizeRatio)}
              fontWeight={lab.jaFontWeight}
              fill={lab.jaColor}
              style={{
                fontFamily: ATLAS_STYLE.font.family,
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
