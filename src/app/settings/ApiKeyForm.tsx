"use client";

import { useState, useTransition } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "testing" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function ApiKeyForm({ hasExisting }: { hasExisting: boolean }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: "saving" });
    const res = await fetch("/api/keys/anthropic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, label: label || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus({ kind: "error", message: body.error ?? "Failed to save key" });
      return;
    }
    setStatus({ kind: "testing" });
    const test = await fetch("/api/keys/anthropic/test", { method: "POST" });
    const body = await test.json().catch(() => ({}));
    if (!test.ok) {
      setStatus({ kind: "error", message: body.error ?? "Saved, but test call failed" });
      return;
    }
    setStatus({ kind: "ok", message: `Verified — model ${body.model ?? "ok"}` });
    setKey("");
    startTransition(() => {
      // Force a re-fetch of the server component metadata.
      window.location.reload();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs text-stone-500 mb-1">API key</label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder={hasExisting ? "Replace with a new key…" : "sk-ant-…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full font-mono text-sm px-3 py-2 border border-stone-300 rounded focus:border-stone-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Label (optional)</label>
        <input
          type="text"
          placeholder="e.g. personal, work"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full text-sm px-3 py-2 border border-stone-300 rounded focus:border-stone-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={status.kind === "saving" || status.kind === "testing"}
        className="py-2 px-4 bg-stone-800 text-white rounded hover:bg-stone-700 disabled:opacity-50 text-sm"
      >
        {status.kind === "saving" ? "Saving…" : status.kind === "testing" ? "Testing…" : "Save and test"}
      </button>
      {status.kind === "ok" && (
        <p className="text-sm text-emerald-700">✓ {status.message}</p>
      )}
      {status.kind === "error" && (
        <p className="text-sm text-red-700">✗ {status.message}</p>
      )}
    </form>
  );
}
