"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MapMeta = { id: string; title: string; _count: { conversations: number; cities: number } };

export function MapList({ maps: initial }: { maps: MapMeta[] }) {
  const [maps, setMaps] = useState(initial);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const createMap = async () => {
    setCreating(true);
    const res = await fetch("/api/maps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New Atlas" }),
    });
    if (res.ok) {
      const { map } = await res.json();
      router.push(`/atlas/${map.id}`);
    }
    setCreating(false);
  };

  const deleteMap = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This removes all conversations and cities.`)) return;
    const res = await fetch(`/api/maps/${id}`, { method: "DELETE" });
    if (res.ok) setMaps((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-stone-500">My maps</h2>
        <button
          onClick={createMap}
          disabled={creating}
          className="text-xs px-2.5 py-1.5 border border-stone-300 rounded hover:bg-stone-100 disabled:opacity-50 transition-colors"
        >
          {creating ? "Creating…" : "+ New map"}
        </button>
      </div>

      {maps.length === 0 ? (
        <p className="text-sm text-stone-400">
          No maps yet.{" "}
          <a href="/import" className="underline text-stone-600 hover:text-stone-900">
            Import conversations
          </a>{" "}
          to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {maps.map((m) => (
            <li key={m.id} className="flex items-center gap-2 group">
              <a
                href={`/atlas/${m.id}`}
                className="flex-1 flex items-center justify-between px-4 py-3 bg-white border border-stone-200 rounded hover:border-stone-400 transition-colors"
              >
                <span className="font-medium text-stone-800 group-hover:text-stone-900 text-sm">
                  {m.title}
                </span>
                <span className="text-xs text-stone-400">
                  {m._count.conversations} conversations · {m._count.cities} cities →
                </span>
              </a>
              <button
                onClick={() => deleteMap(m.id, m.title)}
                title="Delete map"
                className="text-stone-300 hover:text-red-500 px-1 transition-colors opacity-0 group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
