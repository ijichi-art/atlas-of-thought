"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CommitResult = {
  countriesCreated: number;
  citiesCreated: number;
  roadsCreated: number;
  roadsCandidates?: number;
  conversationsPlaced: number;
  conversationsSkipped: number;
};

type SkipItem = {
  convIdx: number;
  convId: string;
  title: string | null;
  reason: string;
};

type PreviewResult = {
  aiResult: unknown;
  conversationIds: string[];
  skipDefinitive: SkipItem[];
  skipAmbiguous: SkipItem[];
};

type Phase = "idle" | "directive" | "analyzing" | "review" | "committing" | "done" | "error";

export function TerraformPanel({
  mapId,
  conversationCount,
  cityCount,
  initialDirective,
}: {
  mapId: string;
  conversationCount: number;
  cityCount: number;
  initialDirective: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [directive, setDirective] = useState(initialDirective);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // Per-convIdx toggle state for ambiguous items: true = skip this one too.
  const [ambiguousChoices, setAmbiguousChoices] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  const reset = () => {
    setPhase("idle");
    setPreview(null);
    setAmbiguousChoices({});
    setResult(null);
    setError("");
  };

  const openDirective = () => {
    setPhase("directive");
    setError("");
  };

  // Run preview: cartographer LLM with the directive, returns skip lists.
  const analyze = async () => {
    setPhase("analyzing");
    setError("");
    const res = await fetch(`/api/maps/${mapId}/terraform/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directive: directive.trim() || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message ?? data.error ?? "Preview failed");
      setPhase("error");
      return;
    }
    const p = data as PreviewResult;
    setPreview(p);
    // Default ambiguous items to NOT skip — user must opt in to cutting.
    const defaults: Record<number, boolean> = {};
    for (const item of p.skipAmbiguous) defaults[item.convIdx] = false;
    setAmbiguousChoices(defaults);
    setPhase("review");
  };

  // Commit: terraform with the chosen skip set, reusing the cached aiResult.
  const commit = async () => {
    if (!preview) return;
    setPhase("committing");
    const skipConvIdx: number[] = [
      ...preview.skipDefinitive.map((s) => s.convIdx),
      ...preview.skipAmbiguous.filter((s) => ambiguousChoices[s.convIdx]).map((s) => s.convIdx),
    ];
    const res = await fetch(`/api/maps/${mapId}/terraform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directive: directive.trim() || null,
        aiResult: preview.aiResult,
        skipConvIdx,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message ?? data.error ?? "Terraform failed");
      setPhase("error");
      return;
    }
    setResult(data as CommitResult);
    setPhase("done");
    router.refresh();
  };

  const buttonLabel =
    phase === "analyzing"
      ? "Analyzing…"
      : phase === "committing"
        ? "Terraforming…"
        : cityCount > 0
          ? "Re-terraform"
          : "✦ Terraform map";

  // Done banner
  if (phase === "done" && result) {
    return (
      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span className="text-emerald-600">
          ✓ {result.citiesCreated} cities, {result.countriesCreated} countries,{" "}
          {result.roadsCreated} roads
          {result.conversationsSkipped > 0 && (
            <span className="text-stone-500"> · {result.conversationsSkipped} skipped</span>
          )}
        </span>
        <button onClick={reset} className="text-stone-400 hover:text-stone-600">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {phase === "error" && error && (
        <span className="text-xs text-red-600">{error}</span>
      )}

      {conversationCount > 0 && (
        <button
          onClick={openDirective}
          disabled={phase === "analyzing" || phase === "committing"}
          className="px-3 py-1.5 text-xs bg-stone-800 text-white rounded hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {buttonLabel}
        </button>
      )}

      {(phase === "directive" || phase === "analyzing") && (
        <DirectiveModal
          directive={directive}
          setDirective={setDirective}
          onCancel={reset}
          onAnalyze={analyze}
          loading={phase === "analyzing"}
        />
      )}

      {phase === "review" && preview && (
        <ReviewModal
          preview={preview}
          ambiguousChoices={ambiguousChoices}
          setAmbiguousChoices={setAmbiguousChoices}
          onBack={() => setPhase("directive")}
          onCancel={reset}
          onCommit={commit}
        />
      )}

      {phase === "committing" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40">
          <div className="bg-white rounded-md px-6 py-4 text-sm text-stone-700">
            Terraforming…
          </div>
        </div>
      )}
    </div>
  );
}

function DirectiveModal({
  directive,
  setDirective,
  onCancel,
  onAnalyze,
  loading,
}: {
  directive: string;
  setDirective: (s: string) => void;
  onCancel: () => void;
  onAnalyze: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-xl w-full">
        <div className="px-5 pt-5 pb-3 border-b border-stone-200">
          <h2 className="text-base font-medium text-stone-800">地図に載せたくないもの</h2>
          <p className="text-xs text-stone-500 mt-1">
            自然言語で書いてください（任意）。該当する会話は地図から除外されます。曖昧なものは次の画面で個別に確認します。
          </p>
        </div>
        <div className="p-5">
          <textarea
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            placeholder={"例: Acme 社関連の会話は除外。\n例: project Phoenix に触れているものはスキップ。"}
            className="w-full h-32 text-sm border border-stone-300 rounded p-3 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-stone-500"
            disabled={loading}
          />
          <p className="text-[11px] text-stone-400 mt-2">
            別途、API キーや秘密鍵などのフォーマット明確な認証情報は import 時に自動マスクされます。
          </p>
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-800 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={onAnalyze}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-stone-800 text-white rounded hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? "解析中…" : "次へ（解析）"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewModal({
  preview,
  ambiguousChoices,
  setAmbiguousChoices,
  onBack,
  onCancel,
  onCommit,
}: {
  preview: PreviewResult;
  ambiguousChoices: Record<number, boolean>;
  setAmbiguousChoices: (next: Record<number, boolean>) => void;
  onBack: () => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const toggle = (idx: number) => {
    setAmbiguousChoices({ ...ambiguousChoices, [idx]: !ambiguousChoices[idx] });
  };

  const totalSkip =
    preview.skipDefinitive.length +
    preview.skipAmbiguous.filter((s) => ambiguousChoices[s.convIdx]).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-stone-200">
          <h2 className="text-base font-medium text-stone-800">除外内容を確認</h2>
          <p className="text-xs text-stone-500 mt-1">
            合計 {totalSkip} 件を地図から除外します。除外した会話は DB には残ります（再 terraform で復活可能）。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {preview.skipDefinitive.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-stone-700 mb-2">
                完全に除外（{preview.skipDefinitive.length} 件）
              </h3>
              <ul className="space-y-1">
                {preview.skipDefinitive.map((s) => (
                  <li
                    key={s.convId}
                    className="flex items-start gap-2 text-xs bg-stone-50 px-3 py-2 rounded border border-stone-200"
                  >
                    <span className="mt-0.5 text-rose-600">●</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-stone-800 truncate">
                        {s.title ?? "(無題)"}
                      </div>
                      <div className="text-stone-500 mt-0.5">{s.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview.skipAmbiguous.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-stone-700 mb-2">
                どうしますか？（曖昧 — {preview.skipAmbiguous.length} 件、デフォルト：含める）
              </h3>
              <ul className="space-y-1">
                {preview.skipAmbiguous.map((s) => (
                  <li
                    key={s.convId}
                    className="flex items-start gap-2 text-xs bg-amber-50 px-3 py-2 rounded border border-amber-200"
                  >
                    <input
                      type="checkbox"
                      checked={!!ambiguousChoices[s.convIdx]}
                      onChange={() => toggle(s.convIdx)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-stone-800 truncate">
                        {s.title ?? "(無題)"}
                      </div>
                      <div className="text-stone-500 mt-0.5">{s.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-stone-400 mt-2">
                チェックを入れた会話は除外されます。
              </p>
            </section>
          )}

          {preview.skipDefinitive.length === 0 && preview.skipAmbiguous.length === 0 && (
            <p className="text-xs text-stone-500">
              除外指示に該当する会話は見つかりませんでした。そのまま地図を生成します。
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-800"
          >
            ← 指示を編集
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-800"
            >
              キャンセル
            </button>
            <button
              onClick={onCommit}
              className="px-3 py-1.5 text-xs bg-stone-800 text-white rounded hover:bg-stone-700"
            >
              承認して地図生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
