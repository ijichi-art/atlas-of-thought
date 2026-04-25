// Static provider catalog — safe to import from client components.
// (No server-only deps like prisma/pg.)

export type Provider = "anthropic" | "openai" | "deepseek";

export const PROVIDER_MODELS: Record<Provider, { label: string; models: { id: string; label: string }[] }> = {
  anthropic: {
    label: "Anthropic",
    models: [
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest, cheapest)" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (balanced)" },
      { id: "claude-opus-4-7", label: "Claude Opus 4.7 (most capable)" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini (fast, cheap)" },
      { id: "gpt-4o", label: "GPT-4o (balanced)" },
      { id: "o1-mini", label: "o1-mini (reasoning)" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    models: [
      { id: "deepseek-chat", label: "DeepSeek V3 (fast, very cheap)" },
      { id: "deepseek-reasoner", label: "DeepSeek R1 (reasoning, slower)" },
    ],
  },
};

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
};
