"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Result = {
  countriesCreated: number;
  citiesCreated: number;
  roadsCreated: number;
  conversationsPlaced: number;
};

export function TerraformPanel({
  mapId,
  conversationCount,
  cityCount,
}: {
  mapId: string;
  conversationCount: number;
  cityCount: number;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  const run = async () => {
    setStatus("running");
    setError("");
    setResult(null);
    const res = await fetch(`/api/maps/${mapId}/terraform`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message ?? data.error ?? "Terraform failed");
      setStatus("error");
      return;
    }
    setResult(data as Result);
    setStatus("done");
    router.refresh();
  };

  if (status === "done" && result) {
    return (
      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span className="text-emerald-600">
          ✓ {result.citiesCreated} cities placed in {result.countriesCreated} countries
        </span>
        <button
          onClick={() => { setStatus("idle"); setResult(null); }}
          className="text-stone-400 hover:text-stone-600"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      {conversationCount > 0 && (
        <button
          onClick={run}
          disabled={status === "running"}
          className="px-3 py-1.5 text-xs bg-stone-800 text-white rounded hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "running"
            ? "Terraforming…"
            : cityCount > 0
            ? "Re-terraform"
            : "✦ Terraform map"}
        </button>
      )}
    </div>
  );
}
