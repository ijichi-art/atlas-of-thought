"use client";

import { Atlas } from "@/components/atlas/Atlas";
import type { SampleMap } from "@/types/atlas";

export function PublicAtlasView({ map }: { map: SampleMap }) {
  return <Atlas map={map} />;
}
