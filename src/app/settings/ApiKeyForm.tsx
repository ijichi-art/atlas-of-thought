"use client";

import { useState } from "react";
import { PROVIDER_MODELS, type Provider } from "@/lib/providers";

type KeyMeta = { hint: string; model: string; label: string | null; lastUsedAt: Date | null };
type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

const PROVIDER_PLACEHOLDERS: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  deepseek: "sk-…",
};

function ProviderSection({
  provider,
  meta,
  isActive,
  onSaved,
}: {
  provider: Provider;
  meta: KeyMeta | null;
  isActive: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(!!meta || isActive);
  const [keyVal, setKeyVal] = useState("");
  const [model, setModel] = useState(meta?.model ?? "");
  const [label, setLabel] = useState(meta?.label ?? "");
  const [setActive, setSetActive] = useState(!meta);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const info = PROVIDER_MODELS[provider];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: "saving" });
    const res = await fetch(`/api/keys/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: keyVal, model: model || undefined, label: label || undefined, setActive }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({ kind: "error", message: body.error ?? "Failed to save" });
      return;
    }
    setStatus({ kind: "ok", message: "Saved." });
    setKeyVal("");
    onSaved();
  };

  const remove = async () => {
    await fetch(`/api/keys/${provider}`, { method: "DELETE" });
    onSaved();
  };

  return (
    <div className="border border-stone-200 rounded overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm bg-white hover:bg-stone-50"
      >
        <span className="flex items-center gap-2 font-medium text-stone-700">
          {info.label}
          {isActive && (
            <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
              active
            </span>
          )}
          {meta && !isActive && (
            <span className="text-[10px] text-stone-400">key on file</span>
          )}
        </span>
        <span className="text-stone-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 bg-white border-t border-stone-100 space-y-3">
          {meta && (
            <div className="text-xs text-stone-500 bg-stone-50 rounded px-3 py-2 flex items-center justify-between">
              <span>
                Key: <code className="bg-stone-100 px-1 rounded">{meta.hint}</code>
                {meta.model ? ` · ${meta.model}` : ""}
              </span>
              <button
                type="button"
                onClick={remove}
                className="text-red-400 hover:text-red-600 ml-4"
              >
                Remove
              </button>
            </div>
          )}

          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="block text-xs text-stone-500 mb-1">
                {meta ? "Replace key" : "API key"}
              </label>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                placeholder={PROVIDER_PLACEHOLDERS[provider]}
                value={keyVal}
                onChange={(e) => setKeyVal(e.target.value)}
                className="w-full font-mono text-sm px-3 py-2 border border-stone-300 rounded focus:border-stone-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-500 mb-1">
                Model <span className="text-stone-400">(optional — empty = best available model)</span>
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-stone-300 rounded focus:border-stone-500 focus:outline-none bg-white"
              >
                <option value="">— auto (best for this provider) —</option>
                {info.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-stone-500 mb-1">Label (optional)</label>
              <input
                type="text"
                placeholder="personal, work…"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-stone-300 rounded focus:border-stone-500 focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={setActive}
                onChange={(e) => setSetActive(e.target.checked)}
                className="rounded"
              />
              Use this provider for chat
            </label>

            <button
              type="submit"
              disabled={status.kind === "saving"}
              className="py-2 px-4 bg-stone-800 text-white rounded hover:bg-stone-700 disabled:opacity-50 text-sm"
            >
              {status.kind === "saving" ? "Saving…" : "Save"}
            </button>

            {status.kind === "ok" && <p className="text-sm text-emerald-700">✓ {status.message}</p>}
            {status.kind === "error" && <p className="text-sm text-red-700">✗ {status.message}</p>}
          </form>
        </div>
      )}
    </div>
  );
}

export function ApiKeyForm({
  initialKeys,
  initialActiveProvider,
}: {
  initialKeys: { provider: string; hint: string; model: string; label: string | null; lastUsedAt: Date | null }[];
  initialActiveProvider: Provider;
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [activeProvider, setActiveProvider] = useState<Provider>(initialActiveProvider);

  const refresh = async () => {
    const res = await fetch("/api/keys");
    if (!res.ok) return;
    const data = await res.json();
    setKeys(data.keys);
    setActiveProvider(data.activeProvider);
  };

  return (
    <div className="space-y-2">
      {(["anthropic", "openai", "deepseek"] as Provider[]).map((p) => {
        const meta = keys.find((k) => k.provider === p) ?? null;
        return (
          <ProviderSection
            key={p}
            provider={p}
            meta={meta as KeyMeta | null}
            isActive={activeProvider === p}
            onSaved={refresh}
          />
        );
      })}
    </div>
  );
}
