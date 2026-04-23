import Link from "next/link";
import { Atlas } from "@/components/atlas/Atlas";
import sampleMap from "@/data/sample-map.json";
import type { SampleMap } from "@/types/atlas";

export const metadata = {
  title: "Atlas — demo · Atlas of Thought",
};

export default function AtlasDemoPage() {
  return (
    <div className="h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between text-sm">
        <Link href="/" className="text-stone-500 hover:text-stone-800">
          ← Home
        </Link>
        <span className="text-stone-400">Phase 1 PR-1 · static demo · no pins yet</span>
      </header>
      <div className="flex-1 min-h-0">
        <Atlas map={sampleMap as SampleMap} />
      </div>
    </div>
  );
}
