// Static provider catalog — safe to import from client components.
// (No server-only deps like prisma/pg.)

export type Provider = "anthropic" | "openai" | "deepseek";

export const PROVIDER_MODELS: Record<Provider, { label: string; models: { id: string; label: string }[] }> = {
  anthropic: {
    label: "Anthropic",
    // Most capable first — that's what an empty model preference falls back to.
    models: [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7 (most capable) ★ default" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (balanced)" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest, cheapest)" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o", label: "GPT-4o (most capable) ★ default" },
      { id: "o1-mini", label: "o1-mini (reasoning, no streaming)" },
      { id: "gpt-4o-mini", label: "GPT-4o mini (fast, cheap)" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    models: [
      { id: "deepseek-reasoner", label: "DeepSeek R1 (reasoning, most capable) ★ default" },
      { id: "deepseek-chat", label: "DeepSeek V3 (fast, very cheap)" },
    ],
  },
};

// Empty model preference → fall back to the most-capable model of each provider.
// This prioritises quality over cost (BYOK = user pays, and the user has explicitly
// asked for "best result automatically, ignore cost").
export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-4o",
  deepseek: "deepseek-reasoner",
};
