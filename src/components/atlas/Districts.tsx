"use client";

import { useMemo } from "react";
import type { CityData } from "@/types/atlas";

// Render district labels above their cities. Positioned at the centroid of
// all cities sharing the same (countryId, district). Visible only at
// medium-to-high zoom — fade in around 1.4×.
export function Districts({ cities, scale }: { cities: CityData[]; scale: number }) {
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
    return Array.from(groups.values())
      .filter((g) => g.count >= 1)
      .map((g) => ({
        name: g.name,
        nameJa: g.nameJa,
        x: g.xs.reduce((a, b) => a + b, 0) / g.xs.length,
        y: g.ys.reduce((a, b) => a + b, 0) / g.ys.length,
      }));
  }, [cities]);

  const inv = 1 / scale;
  // Fade in between 1.2× and 1.6× zoom
  const opacity = Math.min(1, Math.max(0, (scale - 1.2) / 0.4));
  if (opacity <= 0) return null;

  return (
    <g style={{ opacity }} pointerEvents="none">
      {districts.map((d, i) => (
        <g key={i} transform={`translate(${d.x} ${d.y - 28 * inv}) scale(${inv})`}>
          <text
            textAnchor="middle"
            fontFamily='"Helvetica Neue", -apple-system, system-ui, sans-serif'
            fontSize={11}
            fontWeight={500}
            fill="#736a5e"
            letterSpacing={2.5}
            style={{
              paintOrder: "stroke fill",
              stroke: "#f5f3ef",
              strokeWidth: 4,
              strokeLinejoin: "round",
              textTransform: "uppercase",
            }}
          >
            {d.name.toUpperCase()}
          </text>
          {d.nameJa && (
            <text
              textAnchor="middle"
              y={11}
              fontFamily='"Helvetica Neue", -apple-system, system-ui, sans-serif'
              fontSize={9}
              fill="#8a8175"
              letterSpacing={2}
              style={{
                paintOrder: "stroke fill",
                stroke: "#f5f3ef",
                strokeWidth: 3,
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
