import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { loadProviderKey, getUserChatProvider } from "./api-keys";
import { DEFAULT_MODELS, type Provider } from "./providers";

export { PROVIDER_MODELS } from "./providers";
export type { Provider };

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
