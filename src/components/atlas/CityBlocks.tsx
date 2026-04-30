import type { CityData } from "@/types/atlas";
import { ATLAS_STYLE } from "@/lib/atlas-style";
import {
  builtUpPolygon,
  builtUpRadius,
  hashStr,
  smoothClosedPath,
  streetGrid,
  type Segment,
} from "@/lib/city-geom";

// Internal street grid for a major city: 2 arterials + a perpendicular grid
// of collectors, clipped to the city's built-up polygon. Visible only at
// scale >= ATLAS_STYLE.cityBlocks.minScale (street-level zoom).
//
// Each line is drawn twice (casing + fill) for the Google-Maps double-stroke
// look — same as Road.tsx, but using straight lines rather than beziers.

function StreetSegments({
  segments,
  fillColor,
  fillWidth,
  casing,
  keyPrefix,
}: {
  segments: Segment[];
  fillColor: string;
  fillWidth: number;
  casing: { color: string; width: number } | undefined;
  keyPrefix: string;
}) {
  return (
    <>
      {casing &&
        segments.map(([x1, y1, x2, y2], i) => (
          <line
            key={`${keyPrefix}-c-${i}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={casing.color}
            strokeWidth={casing.width}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {segments.map(([x1, y1, x2, y2], i) => (
        <line
          key={`${keyPrefix}-f-${i}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={fillColor}
          strokeWidth={fillWidth}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

export function CityBlocks({ cities, scale }: { cities: CityData[]; scale: number }) {
  const cfg = ATLAS_STYLE.cityBlocks;
  if (scale < cfg.minScale) return null;

  // Render street grids for ALL cluster cities — even small ones. Skipping
  // 'town' rank used to leave large beige holes with POIs but no streets,
  // because terraform's cluster sizes (driven by POI count) are bigger than
  // the legacy rank-based defaults.
  const eligible = cities;

  // City grid is uniformly the collector style (white + light casing).
  // Through-streets (the two center axes that streetGrid returns as
  // `arterials`) render in the SAME white style so the inside of a city
  // reads as a flat grid rather than two yellow trunks bisecting the blocks.
  // Inter-city arterials (yellow) are rendered separately by Road.tsx and
  // pass over the grid where applicable.
  const collectorStyle = ATLAS_STYLE.road.trail;

  return (
    <g pointerEvents="none">
      {eligible.map((c) => {
        const seed = hashStr(c.id);
        // Use the city's actual built-up radius (driven by POI count) so
        // the grid fills the entire visible cluster polygon. Falling back
        // to rank-based radius would leave the outer ~60% of large
        // clusters with POIs but no streets — visible bug in the screenshot.
        const baseR = c.builtUpR ?? builtUpRadius(c.rank);
        const grid = streetGrid(c.position, baseR, seed);
        const polyForClip = builtUpPolygon(c.position, baseR, seed);
        const clipId = `city-block-clip-${c.id}`;

        return (
          <g key={c.id}>
            <defs>
              <clipPath id={clipId}>
                <path d={smoothClosedPath(polyForClip)} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
              <StreetSegments
                segments={grid.collectors}
                fillColor={collectorStyle.fill.color}
                fillWidth={collectorStyle.fill.width}
                casing={collectorStyle.casing}
                keyPrefix="col"
              />
              <StreetSegments
                segments={grid.arterials}
                fillColor={collectorStyle.fill.color}
                fillWidth={collectorStyle.fill.width}
                casing={collectorStyle.casing}
                keyPrefix="art"
              />
            </g>
          </g>
        );
      })}
    </g>
  );
}
