"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import type { SampleMap } from "@/types/atlas";
import { AtlasDefs, MapBackdrop } from "./AtlasDefs";
import { Country } from "./Country";
import { BuiltUpLayer } from "./BuiltUpLayer";
import { River } from "./River";
import { City } from "./City";
import { Road } from "./Road";
import { RoadJunctions } from "./RoadJunctions";
import { Bridges } from "./Bridges";
import { Legend } from "./Legend";
import { CityDetailPanel } from "./CityDetailPanel";
import { Districts } from "./Districts";
import { POILayer } from "./POILayer";
import { SearchBox, type SearchTarget } from "./SearchBox";
import { SearchPin } from "./SearchPin";
import { ATLAS_STYLE } from "@/lib/atlas-style";
import { bundleSharedTrunks } from "@/lib/bundle-trunks";

const MIN_SCALE = ATLAS_STYLE.zoom.min;
const MAX_SCALE = ATLAS_STYLE.zoom.max;

export function Atlas({ map }: { map: SampleMap }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contentRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [scale, setScale] = useState(1);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  // Drop-pin shown at the target of a search selection. Cleared when the
  // user clicks empty map area or picks a new search result.
  const [searchPin, setSearchPin] = useState<{ x: number; y: number } | null>(null);
  const pois = useMemo(() => map.pois ?? [], [map.pois]);
  const cityById = useMemo(() => new Map(map.cities.map((c) => [c.id, c])), [map.cities]);
  const countryById = useMemo(
    () => new Map(map.countries.map((c) => [c.id, c])),
    [map.countries],
  );
  const citiesByCountry = useMemo(() => {
    const m = new Map<string, typeof map.cities>();
    for (const c of map.cities) {
      const arr = m.get(c.countryId) ?? [];
      arr.push(c);
      m.set(c.countryId, arr);
    }
    return m;
  }, [map.cities]);
  // Use the persisted roads directly. terraform.ts now emits a Euclidean
  // MST that's planar by construction — there are no parallel paths
  // through the same corridor, so bundleSharedTrunks would only add
  // unnecessary waypoints that bend otherwise-straight roads.
  const bundledRoads = useMemo(() => map.roads, [map.roads]);
  void bundleSharedTrunks;
  const selectedCity = selectedCityId ? cityById.get(selectedCityId) ?? null : null;
  const selectedCountry = selectedCity ? countryById.get(selectedCity.countryId) ?? null : null;

  useEffect(() => {
    const svg = svgRef.current;
    const content = contentRef.current;
    if (!svg || !content) return;

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .on("zoom", (event) => {
        const { x, y, k } = event.transform;
        content.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
        setScale(k);
      });

    zoomRef.current = behavior;
    select(svg).call(behavior).call(behavior.transform, zoomIdentity);

    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const stepZoom = (factor: number) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    select(svg).transition().duration(200).call(behavior.scaleBy, factor);
  };

  // Fly the camera to a search-result target. The d3-zoom transform maps
  // canvas coords (cx, cy) to screen position (W/2, H/2) at scale k via:
  //   transform = translate(W/2 - cx*k, H/2 - cy*k).scale(k)
  // viewBox already maps the SVG coord system, so passing the viewBox W/H
  // is correct here.
  const flyTo = (target: SearchTarget) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    const { width: vw, height: vh } = map.viewBox;
    const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, target.zoomTo));
    const [cx, cy] = target.position;
    const tx = vw / 2 - cx * k;
    const ty = vh / 2 - cy * k;
    select(svg)
      .transition()
      .duration(600)
      .call(behavior.transform, zoomIdentity.translate(tx, ty).scale(k));

    // Drop a Google-Maps-style red pin at the target so the user can see
    // exactly where they landed even if the area is dense.
    setSearchPin({ x: cx, y: cy });

    // Side-effects: highlight the target so the user sees what they
    // landed on. POIs select both POI + parent city so the detail panel
    // shows context.
    if (target.kind === "city") {
      setSelectedCityId(target.id.replace(/^city-/, ""));
      setSelectedConvId(null);
    } else if (target.kind === "poi") {
      const poi = pois.find((p) => p.id === target.id);
      if (poi) {
        setSelectedConvId(poi.conversationId);
        setSelectedCityId(poi.cityId);
      }
    } else {
      setSelectedCityId(null);
      setSelectedConvId(null);
    }
  };

  const { width, height } = map.viewBox;

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: ATLAS_STYLE.sea.color }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full cursor-grab active:cursor-grabbing block"
        onClick={() => {
          setSelectedCityId(null);
          setSelectedConvId(null);
          setSearchPin(null);
        }}
      >
        <AtlasDefs />
        <g ref={contentRef}>
          <MapBackdrop width={width} height={height} />
          {map.countries.map((c) => (
            <Country
              key={c.id}
              data={c}
              scale={scale}
              cities={citiesByCountry.get(c.id) ?? []}
            />
          ))}
          {/* Built-up cores hoisted above every country fill so later
              country fills don't paint over earlier countries' Manhattan. */}
          <BuiltUpLayer cities={map.cities} scale={scale} />
          {map.rivers.map((r) => (
            <River key={r.id} data={r} />
          ))}
          {/* MountainRange: hidden (old-map element, replaced by Google-Maps style). */}
          {bundledRoads.map((r, i) => (
            <Road key={r.id} data={r} cityById={cityById} scale={scale} number={i + 1} />
          ))}
          <RoadJunctions roads={bundledRoads} cities={map.cities} scale={scale} />
          <Bridges
            roads={bundledRoads}
            cities={map.cities}
            rivers={map.rivers}
            scale={scale}
          />
          {map.cities.map((c) => (
            <City
              key={c.id}
              data={c}
              selected={selectedCityId === c.id}
              onSelect={setSelectedCityId}
              scale={scale}
            />
          ))}
          <POILayer
            pois={pois}
            scale={scale}
            selectedId={selectedConvId}
            onSelect={(convId) => {
              setSelectedConvId(convId);
              // Auto-select the parent city too so the side panel knows context.
              const poi = pois.find((p) => p.conversationId === convId);
              if (poi) setSelectedCityId(poi.cityId);
            }}
          />
          <Districts cities={map.cities} scale={scale} />
          {searchPin && (
            <SearchPin
              x={searchPin.x}
              y={searchPin.y}
              scale={scale}
              onDismiss={() => setSearchPin(null)}
            />
          )}
        </g>
      </svg>

      {/* Floating chrome — kept minimal, Google-Maps-ish */}
      <div className="absolute top-3 left-3 flex items-start gap-2">
        <div className="bg-white rounded-md shadow-md px-3 py-2 text-sm text-stone-700 h-10 flex items-center">
          <span className="font-medium">{map.title}</span>
        </div>
        <SearchBox
          cities={map.cities}
          countries={map.countries}
          pois={pois}
          onSelect={flyTo}
        />
      </div>


      {/* Compass: hidden (decorative compass roses are forbidden in modern map style). */}

      {/* Zoom controls — bottom-right, like Google Maps */}
      <div className="absolute bottom-6 right-3 flex flex-col rounded-md overflow-hidden shadow-md bg-white">
        <button
          aria-label="Zoom in"
          onClick={() => stepZoom(1.3)}
          className="w-9 h-9 text-lg text-stone-700 hover:bg-stone-100 border-b border-stone-200 leading-none"
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => stepZoom(1 / 1.3)}
          className="w-9 h-9 text-lg text-stone-700 hover:bg-stone-100 leading-none"
        >
          −
        </button>
      </div>

      <div className="absolute bottom-3 left-3">
        <Legend />
      </div>

      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-stone-500 font-mono select-none">
        {Math.round(scale * 100)}% · scroll to zoom · drag to pan
      </div>

      <CityDetailPanel
        city={selectedCity}
        country={selectedCountry}
        onClose={() => setSelectedCityId(null)}
        allCities={map.cities}
        countryById={countryById}
      />
    </div>
  );
}
