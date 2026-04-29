"use client";

import type { POIData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// One POI = one underlying conversation, scattered inside its parent city's
// built-up disk by terraform's Phase 3 layout. Visible only at street-level
// zoom — at lower zooms we'd just be drawing a swarm of overlapping dots.

export function POILayer({
  pois,
  scale,
  selectedId,
  onSelect,
}: {
  pois: POIData[];
  scale: number;
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
}) {
  const cfg = ATLAS_STYLE.poi;
  if (scale < cfg.minScale) return null;
  // Label visibility kicks in at a tighter zoom — at the dot-only zoom range,
  // labels would clutter the cluster heavily.
  const showLabel = scale >= cfg.labelMinScale;
  const inv = 1 / scale;

  return (
    <g data-poi-layer pointerEvents="auto">
      {pois.map((p) => {
        const isSelected = selectedId === p.conversationId;
        return (
          <g
            key={p.id}
            transform={`translate(${p.position[0]} ${p.position[1]}) scale(${inv})`}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(p.conversationId);
            }}
          >
            {isSelected && (
              <circle
                cx={0}
                cy={0}
                r={cfg.outerR + cfg.selectionPad}
                fill={cfg.selectionHaloColor}
                opacity={cfg.selectionHaloOpacity}
              />
            )}
            <circle
              cx={0}
              cy={0}
              r={cfg.outerR}
              fill={cfg.fill}
              stroke={cfg.stroke}
              strokeWidth={cfg.strokeWidth}
            />
            {showLabel && (
              <text
                y={cfg.labelDy}
                textAnchor="middle"
                fontSize={cfg.fontSize}
                fontWeight={cfg.fontWeight}
                fill={cfg.color}
                style={{
                  fontFamily: ATLAS_STYLE.font.family,
                  paintOrder: "stroke fill",
                  stroke: cfg.haloColor,
                  strokeWidth: cfg.haloWidth,
                  strokeLinejoin: "round",
                  pointerEvents: "none",
                }}
              >
                {truncate(p.label, 28)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
