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

const ACCEPTED_EXT = /\.(json|jsonl|txt)$/i;

export function ImportForm({ maps }: { maps: MapMeta[] }) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [source, setSource] = useState("auto");
  const [title, setTitle] = useState("");
  const [mapId, setMapId] = useState(maps[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]);
    setText("");
    setTitle("");
    setSource("auto");
    setStatus("idle");
    setProgress(null);
    setResult(null);
    setErrorMsg("");
  };

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming).filter((f) => ACCEPTED_EXT.test(f.name));
    if (arr.length === 0) return;
    // Dedupe by name+size against existing
    const seen = new Set(files.map((f) => `${f.name}::${f.size}`));
    const next = [...files];
    for (const f of arr) {
      const key = `${f.name}::${f.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        next.push(f);
      }
    }
    setFiles(next);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  async function importOne(file: File | null, textBody: string): Promise<ImportResult> {
    const form = new FormData();
    form.set("mapId", mapId);
    form.set("source", source);
    if (title.trim()) form.set("title", title.trim());
    if (file) form.set("file", file);
    else form.set("text", textBody);

    const res = await fetch("/api/import", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Import failed.");
    return data as ImportResult;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapId) return;

    if (mode === "file" && files.length === 0) {
      setErrorMsg("Please select at least one file.");
      return;
    }
    if (mode === "text" && !text.trim()) {
      setErrorMsg("Please enter some text.");
      return;
    }

    setStatus("loading");
    setErrorMsg("");

    const totals: ImportResult = { imported: 0, skipped: 0, issues: [], estimatedTokens: 0 };

    try {
      if (mode === "text") {
        setProgress({ current: 0, total: 1 });
        const r = await importOne(null, text);
        totals.imported += r.imported;
        totals.skipped += r.skipped;
        totals.estimatedTokens += r.estimatedTokens;
        totals.issues.push(...r.issues);
        setProgress({ current: 1, total: 1 });
      } else {
        setProgress({ current: 0, total: files.length });
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          try {
            const r = await importOne(f, "");
            totals.imported += r.imported;
            totals.skipped += r.skipped;
            totals.estimatedTokens += r.estimatedTokens;
            totals.issues.push(...r.issues);
          } catch (err) {
            totals.issues.push({
              level: "error",
              code: "file_failed",
              message: `${f.name}: ${err instanceof Error ? err.message : "failed"}`,
            });
          }
          setProgress({ current: i + 1, total: files.length });
        }
      }

      setResult(totals);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error. Please try again.");
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
          <ul className="text-xs text-stone-500 space-y-1 border-t border-stone-100 pt-4 max-h-48 overflow-y-auto">
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
              {m === "file" ? "Upload files" : "Paste text"}
            </button>
          ))}
        </div>

        {mode === "file" ? (
          <div className="space-y-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragging
                  ? "border-stone-400 bg-stone-100"
                  : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".json,.jsonl,.txt"
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <div className="text-stone-400 text-sm space-y-1">
                <div>Drop files here, or click to browse</div>
                <div className="text-xs">.json · .jsonl · .txt — multiple allowed</div>
              </div>
            </div>

            {files.length > 0 && (
              <div className="border border-stone-200 rounded">
                <div className="px-3 py-2 text-xs text-stone-500 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                  <span>
                    {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
                    {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="text-stone-400 hover:text-stone-700"
                  >
                    Clear all
                  </button>
                </div>
                <ul className="max-h-56 overflow-y-auto divide-y divide-stone-100">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="truncate text-stone-700 mr-3">{f.name}</span>
                      <span className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-stone-400">{(f.size / 1024).toFixed(1)} KB</span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="text-stone-300 hover:text-red-500"
                          aria-label="Remove"
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
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

      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full py-2.5 bg-stone-800 text-stone-50 text-sm rounded hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {status === "loading" && progress
          ? `Importing ${progress.current}/${progress.total}…`
          : status === "loading"
            ? "Importing…"
            : `Import${files.length > 1 ? ` ${files.length} files` : ""}`}
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
