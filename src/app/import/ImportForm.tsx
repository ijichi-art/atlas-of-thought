"use client";

import { useRef, useState } from "react";
import type { ParseIssue } from "@/lib/parsers/types";

type MapMeta = { id: string; title: string };

type ImportResult = {
  imported: number;
  skipped: number;
  issues: ParseIssue[];
  estimatedTokens: number;
};

const SOURCE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "chatgpt", label: "ChatGPT export (conversations.json)" },
  { value: "claude", label: "Claude.ai export (conversations.json)" },
  { value: "claude_code", label: "Claude Code session (.jsonl)" },
  { value: "paste", label: "Pasted transcript" },
];

export function ImportForm({ maps }: { maps: MapMeta[] }) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState("auto");
  const [title, setTitle] = useState("");
  const [mapId, setMapId] = useState(maps[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setText("");
    setTitle("");
    setSource("auto");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapId) return;

    const hasContent = mode === "file" ? !!file : !!text.trim();
    if (!hasContent) {
      setErrorMsg(mode === "file" ? "Please select a file." : "Please enter some text.");
      return;
    }

    setStatus("loading");
    setErrorMsg("");

    const form = new FormData();
    form.set("mapId", mapId);
    form.set("source", source);
    if (title.trim()) form.set("title", title.trim());
    if (mode === "file" && file) {
      form.set("file", file);
    } else {
      form.set("text", text);
    }

    try {
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Import failed.");
        setStatus("error");
        return;
      }
      setResult(data as ImportResult);
      setStatus("done");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  };

  if (status === "done" && result) {
    return (
      <div className="bg-white border border-stone-200 rounded p-6 space-y-4">
        <div className="text-lg font-serif">Import complete</div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <Stat label="Imported" value={result.imported} />
          <Stat label="Skipped (dup)" value={result.skipped} />
          <Stat label="~Tokens" value={result.estimatedTokens.toLocaleString()} />
        </div>
        {result.issues.length > 0 && (
          <ul className="text-xs text-stone-500 space-y-1 border-t border-stone-100 pt-4">
            {result.issues.map((issue, i) => (
              <li key={i} className={issue.level === "error" ? "text-red-600" : ""}>
                {issue.level === "warning" ? "⚠ " : "✕ "}
                {issue.message}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-3 pt-2">
          <a
            href={`/atlas/${mapId}`}
            className="px-4 py-2 bg-stone-800 text-stone-50 text-sm rounded hover:bg-stone-700"
          >
            View atlas →
          </a>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm border border-stone-200 rounded hover:bg-stone-50"
          >
            Import more
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Map selector */}
      {maps.length > 1 && (
        <div>
          <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">
            Import into
          </label>
          <select
            value={mapId}
            onChange={(e) => setMapId(e.target.value)}
            className="w-full border border-stone-200 rounded px-3 py-2 text-sm bg-white"
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mode tabs */}
      <div>
        <div className="flex gap-1 mb-4 border-b border-stone-200">
          {(["file", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
                mode === m
                  ? "border-stone-800 text-stone-800"
                  : "border-transparent text-stone-400 hover:text-stone-600"
              }`}
            >
              {m === "file" ? "Upload file" : "Paste text"}
            </button>
          ))}
        </div>

        {mode === "file" ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              dragging
                ? "border-stone-400 bg-stone-100"
                : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.jsonl,.txt"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="space-y-1">
                <div className="text-sm font-medium text-stone-700">{file.name}</div>
                <div className="text-xs text-stone-400">{(file.size / 1024).toFixed(1)} KB</div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="text-xs text-stone-400 hover:text-stone-600 underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="text-stone-400 text-sm space-y-1">
                <div>Drop a file here, or click to browse</div>
                <div className="text-xs">.json · .jsonl · .txt</div>
              </div>
            )}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"User: hello\nAssistant: hi there\n…"}
            rows={10}
            className="w-full border border-stone-200 rounded px-3 py-2 text-sm font-mono resize-y"
          />
        )}
      </div>

      {/* Source selector */}
      <div>
        <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">
          Format
        </label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full border border-stone-200 rounded px-3 py-2 text-sm bg-white"
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Title override (paste mode only) */}
      {(mode === "text" || source === "paste") && (
        <div>
          <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">
            Title <span className="normal-case text-stone-400">(optional)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-generated from first message"
            className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
          />
        </div>
      )}

      {errorMsg && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full py-2.5 bg-stone-800 text-stone-50 text-sm rounded hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {status === "loading" ? "Importing…" : "Import"}
      </button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-stone-50 rounded p-3">
      <div className="text-xl font-serif text-stone-800">{value}</div>
      <div className="text-xs text-stone-500 mt-0.5">{label}</div>
    </div>
  );
}
