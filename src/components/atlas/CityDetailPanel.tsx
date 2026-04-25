"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CityData, CountryData, MockMessage } from "@/types/atlas";

const RANK_LABEL: Record<CityData["rank"], string> = {
  capital: "Capital",
  city: "City",
  town: "Town",
};

type ChatMsg = { role: "user" | "assistant"; text: string };

function extractCodeBlocks(messages: MockMessage[] | undefined) {
  const blocks: Array<{ lang: string; code: string }> = [];
  if (!messages) return blocks;
  for (const m of messages) {
    const re = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    while ((match = re.exec(m.text)) !== null) {
      const code = match[2].trimEnd();
      if (code.length > 0) blocks.push({ lang: match[1] || "text", code });
    }
  }
  return blocks;
}

// ─── CityOverview ─────────────────────────────────────────────────────────────

function CityOverview({ city }: { city: CityData }) {
  const artifacts = extractCodeBlocks(city.messages);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  return (
    <div className="space-y-5">
      {city.summary && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-stone-500 mb-1.5">Summary</h3>
          <p className="text-sm text-stone-700 leading-relaxed">{city.summary}</p>
        </section>
      )}

      {city.messages && city.messages.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">
            Conversation preview
          </h3>
          <ul className="space-y-2.5">
            {city.messages.map((m, i) => (
              <MessageBubble key={i} role={m.role as "user" | "assistant"} text={m.text} />
            ))}
          </ul>
        </section>
      )}

      {artifacts.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">
            Code artifacts
          </h3>
          <ul className="space-y-3">
            {artifacts.map((a, i) => (
              <li key={i} className="rounded-md border border-stone-200 overflow-hidden text-xs">
                <div className="flex items-center justify-between px-3 py-1.5 bg-stone-100 font-mono">
                  <span className="text-stone-500">{a.lang}</span>
                  <button
                    onClick={() => copyCode(a.code, i)}
                    className="text-stone-400 hover:text-stone-700 transition-colors"
                  >
                    {copiedIdx === i ? "copied!" : "copy"}
                  </button>
                </div>
                <pre className="px-3 py-2.5 overflow-x-auto bg-white leading-relaxed">
                  <code>{a.code}</code>
                </pre>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!city.summary && !city.messages?.length && (
        <p className="text-sm text-stone-400 italic">No conversation data yet for this city.</p>
      )}
    </div>
  );
}

// ─── CityDetailPanel ──────────────────────────────────────────────────────────

export function CityDetailPanel({
  city,
  country,
  onClose,
  allCities,
  countryById,
}: {
  city: CityData | null;
  country: CountryData | null;
  onClose: () => void;
  allCities: CityData[];
  countryById: Map<string, CountryData>;
}) {
  // Chat state
  const [chatMode, setChatMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Compare state
  const [compareCity, setCompareCity] = useState<CityData | null>(null);
  const [pickingCompare, setPickingCompare] = useState(false);
  const [compareSearch, setCompareSearch] = useState("");
  const compareSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setChatMode(false);
    setChatMessages([]);
    setChatError(null);
    setConversationId(null);
    setStreamingContent("");
    setIsStreaming(false);
    setInputText("");
    setCompareCity(null);
    setPickingCompare(false);
    setCompareSearch("");
  }, [city?.id]);

  useEffect(() => {
    if (chatMode) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, streamingContent, chatMode]);

  useEffect(() => {
    if (pickingCompare) compareSearchRef.current?.focus();
  }, [pickingCompare]);

  async function handleSend() {
    const userText = inputText.trim();
    if (!userText || isStreaming) return;

    setInputText("");
    setChatMessages((prev) => [...prev, { role: "user", text: userText }]);
    setIsStreaming(true);
    setStreamingContent("");
    setChatError(null);

    const history: ChatMsg[] = [
      ...(city?.messages?.map((m) => ({ role: m.role as "user" | "assistant", text: m.text })) ?? []),
      ...chatMessages,
    ];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityLabel: city?.label ?? "",
          citySummary: city?.summary,
          countryName: country?.name,
          history,
          text: userText,
          conversationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) setChatError("Please log in to chat.");
        else if (res.status === 402) setChatError("Add your Anthropic API key in Settings first.");
        else setChatError((data as { message?: string }).message ?? "Something went wrong.");
        setIsStreaming(false);
        return;
      }

      const newConvId = res.headers.get("X-Conversation-Id");
      if (newConvId && !conversationId) setConversationId(newConvId);

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += dec.decode(value, { stream: true });
        setStreamingContent(fullText);
      }

      setChatMessages((prev) => [...prev, { role: "assistant", text: fullText }]);
      setStreamingContent("");
    } catch {
      setChatError("Network error. Please try again.");
    } finally {
      setIsStreaming(false);
      textareaRef.current?.focus();
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const compareMode = compareCity !== null;
  const compareCountry = compareCity ? (countryById.get(compareCity.countryId) ?? null) : null;

  const filteredCities = allCities.filter(
    (c) =>
      c.id !== city?.id &&
      c.label.toLowerCase().includes(compareSearch.toLowerCase()),
  );

  return (
    <AnimatePresence>
      {city && country && (
        <motion.aside
          key={city.id}
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          className="absolute top-0 right-0 h-full w-full bg-white shadow-xl overflow-hidden flex flex-col"
          style={{ maxWidth: compareMode ? 760 : 448, transition: "max-width 0.3s ease" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <header className="px-5 pt-5 pb-3 border-b border-stone-100 flex-none">
            <div className="flex items-start justify-between gap-3">
              <nav className="text-xs text-stone-500">
                <span>{country.name}</span>
                {country.nameJa && (
                  <span className="text-stone-400"> · {country.nameJa}</span>
                )}
                <span className="mx-1.5">›</span>
                <span className="text-stone-700">{RANK_LABEL[city.rank]}</span>
              </nav>
              <div className="flex items-center gap-1.5 -mt-0.5">
                <button
                  onClick={() => setPickingCompare((p) => !p)}
                  title={pickingCompare ? "Cancel" : "Compare with another city"}
                  className={`text-xs px-1.5 py-0.5 border rounded transition-colors ${
                    pickingCompare || compareMode
                      ? "border-stone-400 text-stone-700 bg-stone-100"
                      : "border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-700"
                  }`}
                >
                  ⇄
                </button>
                <button
                  aria-label="Close"
                  onClick={onClose}
                  className="text-stone-400 hover:text-stone-700 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <h2 className="mt-2 text-2xl font-medium text-stone-800">{city.label}</h2>
            {city.labelJa && (
              <p className="text-sm text-stone-500 mt-0.5">{city.labelJa}</p>
            )}
            <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-1.5 bg-stone-400 align-middle"
                  style={{ height: 6 + city.urbanDensity * 1.2 }}
                />
                density {city.urbanDensity}/10
              </span>
              {city.messages && <span>· {city.messages.length} messages</span>}
              {chatMode && chatMessages.length > 0 && (
                <span>· {chatMessages.length} new</span>
              )}
            </div>
          </header>

          {/* ── Compare picker ── */}
          {pickingCompare && (
            <div className="border-b border-stone-100 px-5 py-3 flex-none bg-stone-50">
              <p className="text-xs text-stone-500 mb-2">Pick a city to compare:</p>
              <input
                ref={compareSearchRef}
                value={compareSearch}
                onChange={(e) => setCompareSearch(e.target.value)}
                placeholder="Search cities…"
                className="w-full text-sm border border-stone-200 rounded px-3 py-1.5 focus:outline-none focus:border-stone-400"
              />
              <ul className="mt-2 max-h-44 overflow-y-auto">
                {filteredCities.length === 0 ? (
                  <li className="text-xs text-stone-400 py-1 px-2">No other cities found.</li>
                ) : (
                  filteredCities.map((c) => {
                    const co = countryById.get(c.countryId);
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => {
                            setCompareCity(c);
                            setPickingCompare(false);
                            setCompareSearch("");
                          }}
                          className="w-full text-left text-sm px-2 py-1.5 hover:bg-stone-100 rounded flex items-center justify-between gap-2"
                        >
                          <span className="text-stone-800">{c.label}</span>
                          <span className="text-xs text-stone-400 shrink-0">{co?.name}</span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}

          {/* ── Body ── */}
          {compareMode ? (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-4 py-4 border-r border-stone-100">
                <p className="text-[10px] uppercase tracking-wider text-stone-400 mb-3">
                  {country.name} · {city.label}
                </p>
                <CityOverview city={city} />
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-wider text-stone-400">
                    {compareCountry?.name} · {compareCity.label}
                  </p>
                  <button
                    onClick={() => setCompareCity(null)}
                    className="text-[10px] text-stone-400 hover:text-stone-700 transition-colors"
                  >
                    ✕ clear
                  </button>
                </div>
                <CityOverview city={compareCity} />
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
              {!chatMode ? (
                <CityOverview city={city} />
              ) : (
                <ul className="space-y-2.5">
                  {city.messages && city.messages.length > 0 && (
                    <li className="text-[11px] text-stone-400 text-center py-1">
                      — continuing from {city.messages.length} previous messages —
                    </li>
                  )}
                  {chatMessages.map((m, i) => (
                    <MessageBubble key={i} role={m.role} text={m.text} />
                  ))}
                  {isStreaming && streamingContent && (
                    <MessageBubble role="assistant" text={streamingContent} streaming />
                  )}
                  {isStreaming && !streamingContent && (
                    <li className="mr-6 bg-emerald-50 rounded-lg px-3 py-2 text-sm text-stone-400 italic">
                      Thinking…
                    </li>
                  )}
                  <div ref={bottomRef} />
                </ul>
              )}
            </div>
          )}

          {/* ── Footer ── */}
          {!compareMode && (
            <footer className="flex-none px-5 py-4 border-t border-stone-100 bg-stone-50">
              {!chatMode ? (
                <button
                  type="button"
                  onClick={() => setChatMode(true)}
                  className="w-full py-2 px-4 bg-stone-800 text-white text-sm rounded hover:bg-stone-700 transition-colors"
                >
                  Continue here →
                </button>
              ) : (
                <div className="space-y-2">
                  {chatError && (
                    <p className="text-xs text-red-600 px-1">{chatError}</p>
                  )}
                  <div className="flex gap-2 items-end">
                    <textarea
                      ref={textareaRef}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask about this topic… (Enter to send)"
                      rows={2}
                      disabled={isStreaming}
                      className="flex-1 border border-stone-200 rounded px-3 py-2 text-sm resize-none disabled:opacity-50"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={isStreaming || !inputText.trim()}
                      className="px-4 py-2 bg-stone-800 text-white text-sm rounded hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors h-[4.5rem] flex items-center"
                    >
                      {isStreaming ? "…" : "Send"}
                    </button>
                  </div>
                  <p className="text-[10px] text-stone-400 text-right">
                    Shift+Enter for newline · uses your Anthropic key
                  </p>
                </div>
              )}
            </footer>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function MessageBubble({
  role,
  text,
  streaming = false,
}: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}) {
  return (
    <li
      className={
        role === "user"
          ? "ml-6 bg-stone-100 text-stone-800 rounded-lg px-3 py-2 text-sm"
          : "mr-6 bg-emerald-50 text-stone-800 rounded-lg px-3 py-2 text-sm"
      }
    >
      <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-0.5">
        {role}
        {streaming && <span className="ml-1 animate-pulse">●</span>}
      </div>
      <div className="leading-relaxed whitespace-pre-wrap">{text}</div>
    </li>
  );
}
