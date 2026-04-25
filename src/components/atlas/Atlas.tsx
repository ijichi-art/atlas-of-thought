"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import type { SampleMap } from "@/types/atlas";
import { AtlasDefs, MapBackdrop } from "./AtlasDefs";
import { Sea } from "./Sea";
import { Country } from "./Country";
import { River } from "./River";
import { MountainRange } from "./MountainRange";
import { Compass } from "./Compass";
import { City } from "./City";
import { Road } from "./Road";
import { Legend } from "./Legend";
import { CityDetailPanel } from "./CityDetailPanel";
import { Districts } from "./Districts";
import { ATLAS_STYLE } from "@/lib/atlas-style";

const MIN_SCALE = ATLAS_STYLE.zoom.min;
const MAX_SCALE = ATLAS_STYLE.zoom.max;

export function Atlas({ map }: { map: SampleMap }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contentRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [scale, setScale] = useState(1);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
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

  const { width, height } = map.viewBox;

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: ATLAS_STYLE.sea.color }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full cursor-grab active:cursor-grabbing block"
        onClick={() => setSelectedCityId(null)}
      >
        <AtlasDefs />
        <g ref={contentRef}>
          <MapBackdrop width={width} height={height} />
          <Sea width={width} height={height} color={map.sea.color} />
          {map.countries.map((c) => (
            <Country
              key={c.id}
              data={c}
              scale={scale}
              cities={citiesByCountry.get(c.id) ?? []}
            />
          ))}
          {map.rivers.map((r) => (
            <River key={r.id} data={r} />
          ))}
          {map.mountainRanges.map((m) => (
            <MountainRange key={m.id} data={m} />
          ))}
          {map.roads.map((r, i) => (
            <Road key={r.id} data={r} cityById={cityById} scale={scale} number={i + 1} />
          ))}
          {map.cities.map((c) => (
            <City
              key={c.id}
              data={c}
              selected={selectedCityId === c.id}
              onSelect={setSelectedCityId}
              scale={scale}
            />
          ))}
          <Districts cities={map.cities} scale={scale} />
        </g>
      </svg>

      {/* Floating chrome — kept minimal, Google-Maps-ish */}
      <div className="absolute top-3 left-3 bg-white rounded-md shadow-md px-3 py-2 text-sm text-stone-700">
        <span className="font-medium">{map.title}</span>
      </div>

      <div className="absolute top-3 right-3">
        <Compass size={40} />
      </div>

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
