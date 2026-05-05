"use client";

import type { POIData, POIKind } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";

// One POI = one underlying conversation, scattered inside its parent city's
// built-up disk by terraform's Phase 3 layout. Visible only at street-level
// zoom — at lower zooms we'd just be drawing a swarm of overlapping dots.

// Pin color per POI kind (categorised by the cartographer LLM).
// Mirrors how Google Maps colors its category pins so a city interior
// reads as a mix (red restaurants, purple shops, blue services) rather
// than a swarm of identical dots.
const KIND_FILL: Record<POIKind, string> = {
  code: "#1976d2", // blue (services / dev)
  research: "#7e57c2", // purple (academic / scholarly)
  personal: "#ec407a", // pink (personal / lifestyle)
  question: "#757575", // gray (utility)
  creative: "#fb8c00", // orange (creative)
  decision: "#43a047", // green (decision / planning)
};

function poiFill(kind?: POIKind): string {
  if (!kind) return "#d65a4a"; // legacy fallback red — only hits unclassified data
  return KIND_FILL[kind];
}

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
              fill={poiFill(p.kind)}
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
