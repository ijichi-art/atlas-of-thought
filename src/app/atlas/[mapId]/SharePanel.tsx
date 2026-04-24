"use client";

import { useEffect, useRef, useState } from "react";

type Visibility = "private" | "unlisted" | "public";
type ShareState = { visibility: Visibility; shareUrl: string | null };

export function SharePanel({ mapId }: { mapId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ShareState | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || state) return;
    fetch(`/api/maps/${mapId}/share`)
      .then((r) => r.json())
      .then((d) => setState(d as ShareState));
  }, [open, mapId, state]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const update = async (visibility: Visibility) => {
    setSaving(true);
    const res = await fetch(`/api/maps/${mapId}/share`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    const data = await res.json();
    setState(data as ShareState);
    setSaving(false);
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedCode = state?.shareUrl
    ? `<iframe src="${state.shareUrl.replace(origin, origin)}/embed" width="100%" height="500" style="border:none;border-radius:8px;" allowfullscreen></iframe>`
    : null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1.5 text-xs border border-stone-300 rounded hover:bg-stone-100 transition-colors"
      >
        Share
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-80 bg-white border border-stone-200 rounded-lg shadow-lg p-4 z-50 space-y-4">
          <h3 className="text-sm font-medium text-stone-800">Share this map</h3>

          {/* Visibility selector */}
          <div className="space-y-1.5">
            {(["private", "unlisted", "public"] as Visibility[]).map((v) => (
              <label key={v} className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={state?.visibility === v}
                  onChange={() => update(v)}
                  disabled={saving}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm text-stone-700 group-hover:text-stone-900">
                    {v === "private" ? "Private" : v === "unlisted" ? "Anyone with the link" : "Public"}
                  </span>
                  <span className="block text-xs text-stone-400">
                    {v === "private"
                      ? "Only you can see this"
                      : v === "unlisted"
                      ? "Not listed publicly, but shareable"
                      : "Listed on your public profile"}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {/* Share URL */}
          {state?.shareUrl && (
            <div className="space-y-2 border-t border-stone-100 pt-3">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={state.shareUrl}
                  className="flex-1 text-xs font-mono border border-stone-200 rounded px-2 py-1.5 bg-stone-50 text-stone-600"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={() => copy(state.shareUrl!)}
                  className="text-xs px-2 py-1.5 border border-stone-200 rounded hover:bg-stone-50 whitespace-nowrap"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              {/* Embed */}
              {embedCode && (
                <div>
                  <p className="text-xs text-stone-500 mb-1">Embed code</p>
                  <div className="flex items-start gap-2">
                    <textarea
                      readOnly
                      value={embedCode}
                      rows={3}
                      className="flex-1 text-xs font-mono border border-stone-200 rounded px-2 py-1.5 bg-stone-50 text-stone-600 resize-none"
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      onClick={() => copy(embedCode)}
                      className="text-xs px-2 py-1.5 border border-stone-200 rounded hover:bg-stone-50 whitespace-nowrap"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {saving && <p className="text-xs text-stone-400">Saving…</p>}
        </div>
      )}
    </div>
  );
}
