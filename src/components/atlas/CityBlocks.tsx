import { Delaunay } from "d3";
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

export function CityBlocks({
  cities,
  allCities,
  scale,
}: {
  cities: CityData[];
  allCities: CityData[];
  scale: number;
}) {
  const cfg = ATLAS_STYLE.cityBlocks;
  if (scale < cfg.minScale) return null;

  // Render street grids for ALL cluster cities — even small ones. Skipping
  // 'town' rank used to leave large beige holes with POIs but no streets,
  // because terraform's cluster sizes (driven by POI count) are bigger than
  // the legacy rank-based defaults.
  const eligible = cities;

  // Voronoi cells from every cluster center — used to bound each cluster's
  // grid to its own territory so adjacent clusters with overlapping
  // built-up polygons don't render two rotated grids on top of each other.
  // Sites are deduped so the index alignment with `eligible` works via a
  // direct lookup map. Bound box is generous (canvas + padding) so cells
  // at the edge close cleanly.
  const sitePoints: [number, number][] = allCities.map((c) => [c.position[0], c.position[1]]);
  const siteIndex = new Map<string, number>();
  allCities.forEach((c, i) => siteIndex.set(c.id, i));
  const delaunay = Delaunay.from(sitePoints);
  const voronoi = delaunay.voronoi([-2000, -2000, 4000, 4000]);

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
        // 1.6× matches the POLY_SCALE in Country.tsx — without it the
        // streets would stop at the edge of the (smaller) raw R disk and
        // leave the outer urban ring without grid.
        const baseR = (c.builtUpR ?? builtUpRadius(c.rank)) * 1.6;
        const grid = streetGrid(c.position, baseR, seed);
        const polyForClip = builtUpPolygon(c.position, baseR, seed);
        const clipId = `city-block-clip-${c.id}`;
        const voronoiClipId = `city-block-voronoi-${c.id}`;
        // Voronoi cell as an SVG path. cellPolygon returns null for
        // degenerate sites (e.g. coincident centers); when that happens we
        // fall back to no Voronoi clip so the grid still renders inside
        // its built-up polygon.
        const siteIdx = siteIndex.get(c.id);
        const cellPoly =
          siteIdx !== undefined ? voronoi.cellPolygon(siteIdx) : null;
        const cellPathD = cellPoly
          ? "M " +
            cellPoly.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ") +
            " Z"
          : null;

        return (
          <g key={c.id}>
            <defs>
              <clipPath id={clipId}>
                <path d={smoothClosedPath(polyForClip)} />
              </clipPath>
              {cellPathD && (
                <clipPath id={voronoiClipId}>
                  <path d={cellPathD} />
                </clipPath>
              )}
            </defs>
            <g clipPath={cellPathD ? `url(#${voronoiClipId})` : undefined}>
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
              {/* Sub-block grid at neighbourhood zoom — bisects each
                  collector block into quarters so dense clusters don't
                  show 5+ POIs in a single 24×24 cell. */}
              {scale >= 2.5 && (
                <StreetSegments
                  segments={grid.subCollectors}
                  fillColor={collectorStyle.fill.color}
                  fillWidth={collectorStyle.fill.width * 0.7}
                  casing={
                    collectorStyle.casing
                      ? { color: collectorStyle.casing.color, width: collectorStyle.casing.width * 0.7 }
                      : undefined
                  }
                  keyPrefix="sub"
                />
              )}
            </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}
