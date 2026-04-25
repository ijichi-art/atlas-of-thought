"use client";

import { useMemo } from "react";
import type { CityData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// District labels — centered on the centroid of all cities sharing the same
// (countryId, district), inverse-scaled, fade in at mid zoom.
export function Districts({ cities, scale }: { cities: CityData[]; scale: number }) {
  const T = ATLAS_STYLE.district;
  const districts = useMemo(() => {
    const groups = new Map<
      string,
      { name: string; nameJa?: string; xs: number[]; ys: number[]; count: number }
    >();
    for (const c of cities) {
      if (!c.district) continue;
      const key = `${c.countryId}::${c.district}`;
      const g = groups.get(key) ?? {
        name: c.district,
        nameJa: c.districtJa,
        xs: [],
        ys: [],
        count: 0,
      };
      g.xs.push(c.position[0]);
      g.ys.push(c.position[1]);
      g.count++;
      groups.set(key, g);
    }
    return Array.from(groups.values()).map((g) => ({
      name: g.name,
      nameJa: g.nameJa,
      x: g.xs.reduce((a, b) => a + b, 0) / g.xs.length,
      y: g.ys.reduce((a, b) => a + b, 0) / g.ys.length,
    }));
  }, [cities]);

  const inv = 1 / scale;
  const opacity = Math.min(
    1,
    Math.max(0, (scale - T.fadeInScale.min) / (T.fadeInScale.max - T.fadeInScale.min)),
  );
  if (opacity <= 0) return null;

  const lab = T.label;

  return (
    <g style={{ opacity }} pointerEvents="none">
      {districts.map((d, i) => (
        <g key={i} transform={`translate(${d.x} ${d.y + lab.yOffsetPx * inv}) scale(${inv})`}>
          <text
            textAnchor="middle"
            fontFamily={ATLAS_STYLE.font.family}
            fontSize={lab.fontSize}
            fontWeight={lab.fontWeight}
            fill={lab.color}
            letterSpacing={lab.letterSpacing}
            style={{
              paintOrder: "stroke fill",
              stroke: lab.haloColor,
              strokeWidth: lab.haloWidth,
              strokeLinejoin: "round",
              textTransform: lab.uppercase ? "uppercase" : "none",
            }}
          >
            {lab.uppercase ? d.name.toUpperCase() : d.name}
          </text>
          {d.nameJa && (
            <text
              textAnchor="middle"
              y={lab.jaOffsetY}
              fontFamily={ATLAS_STYLE.font.family}
              fontSize={lab.jaFontSize}
              fill={lab.jaColor}
              letterSpacing={lab.jaLetterSpacing}
              style={{
                paintOrder: "stroke fill",
                stroke: lab.haloColor,
                strokeWidth: lab.jaHaloWidth,
                strokeLinejoin: "round",
              }}
            >
              {d.nameJa}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
