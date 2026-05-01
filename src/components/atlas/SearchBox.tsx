"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import type { CityData, CountryData, POIData } from "@/types/atlas";

// Google-Maps-style search box. Searches across countries, cluster cities,
// and POIs (individual conversations). Results dropdown shows up to 8
// matches; selecting one fires onSelect with the target's canvas-space
// coordinates plus a suggested zoom scale.

export type SearchTarget = {
  id: string;
  kind: "country" | "city" | "poi";
  label: string;
  sublabel?: string;
  position: [number, number];
  // Suggested zoom scale when the camera flies to this target. POIs need
  // a tighter zoom than countries.
  zoomTo: number;
};

const MAX_RESULTS = 8;

function fold(s: string): string {
  // Lowercase + NFKC normalize so half/full-width Japanese matches.
  return s.normalize("NFKC").toLowerCase();
}

export function SearchBox({
  cities,
  countries,
  pois,
  onSelect,
}: {
  cities: CityData[];
  countries: CountryData[];
  pois: POIData[];
  onSelect: (target: SearchTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pre-build the searchable corpus once. We keep folded versions for
  // matching and the original strings for display.
  const corpus = useMemo<SearchTarget[]>(() => {
    const cityById = new Map(cities.map((c) => [c.id, c]));
    const countryById = new Map(countries.map((c) => [c.id, c]));
    const arr: SearchTarget[] = [];
    for (const c of countries) {
      arr.push({
        id: `country-${c.id}`,
        kind: "country",
        label: c.name,
        sublabel: c.nameJa ?? c.theme,
        position: polygonCentroid(c.polygon),
        zoomTo: 0.8,
      });
    }
    for (const c of cities) {
      const country = countryById.get(c.countryId);
      arr.push({
        id: `city-${c.id}`,
        kind: "city",
        label: c.label,
        sublabel: country?.name,
        position: c.position,
        zoomTo: 2.5,
      });
    }
    for (const p of pois) {
      const city = cityById.get(p.cityId);
      arr.push({
        id: p.id,
        kind: "poi",
        label: p.label,
        sublabel: city?.label,
        position: p.position,
        zoomTo: 4,
      });
    }
    return arr;
  }, [cities, countries, pois]);

  const results = useMemo<SearchTarget[]>(() => {
    const q = fold(query.trim());
    if (q.length === 0) return [];
    const matches: { t: SearchTarget; score: number }[] = [];
    for (const t of corpus) {
      const label = fold(t.label);
      const sub = t.sublabel ? fold(t.sublabel) : "";
      let score = 0;
      if (label === q) score = 1000;
      else if (label.startsWith(q)) score = 500;
      else if (label.includes(q)) score = 200;
      else if (sub.includes(q)) score = 50;
      if (score > 0) {
        // Prefer countries > cities > POIs as a tiebreaker (so labels
        // people already see on the map surface to the top).
        const kindBoost = t.kind === "country" ? 30 : t.kind === "city" ? 20 : 0;
        // Shorter labels score slightly higher (e.g. "Health" ranks above
        // "Health & Nutrition Tips").
        const lenPenalty = Math.min(label.length, 80) * 0.1;
        matches.push({ t, score: score + kindBoost - lenPenalty });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, MAX_RESULTS).map((m) => m.t);
  }, [corpus, query]);

  // Reset highlight when results change.
  useEffect(() => {
    setHighlight(0);
  }, [results]);

  // Close dropdown on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const submitSelection = (t: SearchTarget) => {
    onSelect(t);
    setOpen(false);
    setQuery(t.label);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = results[highlight];
      if (t) submitSelection(t);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-72">
      <div className="flex items-center bg-white rounded-md shadow-md px-3 h-10">
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 text-stone-400 mr-2 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search this atlas..."
          className="flex-1 outline-none text-sm text-stone-800 placeholder:text-stone-400 bg-transparent"
        />
        {query.length > 0 && (
          <button
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="text-stone-400 hover:text-stone-600 text-lg leading-none"
          >
            ×
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute top-11 left-0 right-0 bg-white rounded-md shadow-md max-h-80 overflow-y-auto py-1 text-sm">
          {results.map((t, i) => (
            <li
              key={t.id}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => submitSelection(t)}
              className={`px-3 py-2 cursor-pointer flex items-center gap-2 ${
                i === highlight ? "bg-stone-100" : "hover:bg-stone-50"
              }`}
            >
              <KindBadge kind={t.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-stone-800">{t.label}</div>
                {t.sublabel && (
                  <div className="truncate text-xs text-stone-500">{t.sublabel}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && query.trim().length > 0 && results.length === 0 && (
        <div className="absolute top-11 left-0 right-0 bg-white rounded-md shadow-md px-3 py-2 text-sm text-stone-500">
          No matches.
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: SearchTarget["kind"] }) {
  const styles: Record<SearchTarget["kind"], { label: string; color: string }> = {
    country: { label: "国", color: "bg-emerald-100 text-emerald-700" },
    city: { label: "市", color: "bg-amber-100 text-amber-700" },
    poi: { label: "話", color: "bg-stone-200 text-stone-600" },
  };
  const s = styles[kind];
  return (
    <span
      className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-medium ${s.color}`}
    >
      {s.label}
    </span>
  );
}

function polygonCentroid(points: [number, number][]): [number, number] {
  if (points.length === 0) return [0, 0];
  const [sx, sy] = points.reduce(
    ([ax, ay], [x, y]) => [ax + x, ay + y],
    [0, 0],
  );
  return [sx / points.length, sy / points.length];
}
