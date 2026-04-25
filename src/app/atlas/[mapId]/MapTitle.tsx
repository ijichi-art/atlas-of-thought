"use client";

import { useRef, useState } from "react";

export function MapTitle({ mapId, initial }: { mapId: string; initial: string }) {
  const [title, setTitle] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === title) { setEditing(false); return; }
    setSaving(true);
    const res = await fetch(`/api/maps/${mapId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (res.ok) setTitle(trimmed);
    setSaving(false);
    setEditing(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKey}
        disabled={saving}
        className="font-medium text-stone-800 bg-white border border-stone-300 rounded px-2 py-0.5 text-sm w-48 focus:outline-none focus:border-stone-500"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      title="Click to rename"
      className="font-medium text-stone-800 hover:text-stone-600 hover:underline decoration-dashed underline-offset-2 text-sm"
    >
      {title}
    </button>
  );
}
