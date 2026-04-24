import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { loadProviderKey, getUserChatProvider, type Provider } from "./api-keys";

export type { Provider };

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

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
};

export type AiChatParams = {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
};

export type AiClient = {
  provider: Provider;
  model: string;
  stream(params: AiChatParams): AsyncIterable<string>;
};

export async function getAiClient(userId: string): Promise<AiClient | null> {
  const provider = await getUserChatProvider(userId);
  const creds = await loadProviderKey(userId, provider);
  if (!creds) return null;

  const model = creds.model || DEFAULT_MODELS[provider];

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: creds.key });
    return {
      provider,
      model,
      async *stream({ system, messages, maxTokens = 1024 }) {
        const s = client.messages.stream({ model, max_tokens: maxTokens, system, messages });
        for await (const event of s) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
          }
        }
      },
    };
  }

  const baseURL = provider === "deepseek" ? "https://api.deepseek.com" : undefined;
  const oai = new OpenAI({ apiKey: creds.key, ...(baseURL ? { baseURL } : {}) });

  return {
    provider,
    model,
    async *stream({ system, messages, maxTokens = 1024 }) {
      const s = await oai.chat.completions.create({
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
      });
      for await (const chunk of s) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield text;
      }
    },
  };
}
