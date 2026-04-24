import Anthropic from "@anthropic-ai/sdk";
import { loadAnthropicKey } from "./api-keys";

export async function getAnthropicClient(userId: string): Promise<Anthropic | null> {
  const key = await loadAnthropicKey(userId);
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// Cheapest Claude model — easy to change for the whole app from here.
export const DEFAULT_CHAT_MODEL = "claude-haiku-4-5-20251001";
