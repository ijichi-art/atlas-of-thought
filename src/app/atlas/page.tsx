import Link from "next/link";
import { Atlas } from "@/components/atlas/Atlas";
import { fetchMap } from "@/lib/fetch-map";

export const metadata = {
  title: "Atlas — demo · Atlas of Thought",
};

export default async function AtlasDemoPage() {
  let errorMessage: string | null = null;
  let map = null;
  try {
    map = await fetchMap("demo");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between text-sm">
        <Link href="/" className="text-stone-500 hover:text-stone-800">
          ← Home
        </Link>
        <span className="text-stone-400">Phase 1 demo · data via /api/maps/demo</span>
      </header>
      <div className="flex-1 min-h-0">
        {map ? (
          <Atlas map={map} />
        ) : (
          <div className="h-full flex items-center justify-center text-stone-500 text-sm">
            Failed to load demo map{errorMessage ? `: ${errorMessage}` : ""}.
          </div>
        )}
      </div>
    </div>
  );
}
