"use client";

import { useEffect, useState } from "react";
import { Atlas } from "@/components/atlas/Atlas";
import type { SampleMap } from "@/types/atlas";

export function AtlasView({ mapId, cityCount }: { mapId: string; cityCount: number }) {
  const [map, setMap] = useState<SampleMap | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cityCount === 0) return;
    fetch(`/api/maps/${mapId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => setMap(data as SampleMap))
      .catch(() => setError("Failed to load map data."));
  }, [mapId, cityCount]);

  if (cityCount === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-stone-400 gap-3">
        <p className="text-sm">No cities yet.</p>
        <p className="text-xs max-w-xs text-center">
          Import some conversations then click <strong>✦ Terraform map</strong> to let Claude
          arrange them into countries and cities.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-stone-400 text-sm">{error}</div>
    );
  }

  if (!map) {
    return (
      <div className="h-full flex items-center justify-center text-stone-400 text-sm">
        Loading…
      </div>
    );
  }

  return <Atlas map={map} />;
}
