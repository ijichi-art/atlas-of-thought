import { prisma } from "@/lib/prisma";
import { encrypt, decrypt, hintFromKey } from "@/lib/crypto";
import type { Provider } from "@/lib/providers";

export type { Provider };

const KEY_PREFIXES: Record<Provider, string[]> = {
  anthropic: ["sk-ant-"],
  openai: ["sk-"],
  deepseek: ["sk-"],
};

function validateKey(provider: Provider, key: string) {
  const prefixes = KEY_PREFIXES[provider];
  if (!prefixes.some((p) => key.startsWith(p))) {
    const label =
      provider === "anthropic"
        ? "Anthropic keys start with `sk-ant-`"
        : `${provider} keys start with \`sk-\``;
    throw new Error(`${label}. Double-check the value you pasted.`);
  }
}

export async function saveProviderKey(
  userId: string,
  provider: Provider,
  plaintext: string,
  opts: { label?: string; model?: string } = {}
) {
  const trimmed = plaintext.trim();
  validateKey(provider, trimmed);
  const ciphertext = encrypt(trimmed);
  const hint = hintFromKey(trimmed);
  return prisma.apiKey.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ciphertext, hint, label: opts.label, model: opts.model ?? "" },
    update: { ciphertext, hint, label: opts.label, model: opts.model ?? "", lastUsedAt: null },
  });
}

export async function loadProviderKey(
  userId: string,
  provider: Provider
): Promise<{ key: string; model: string } | null> {
  const row = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { ciphertext: true, model: true, id: true },
  });
  if (!row) return null;
  await prisma.apiKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return { key: decrypt(row.ciphertext), model: row.model };
}

export async function getProviderKeyMeta(userId: string, provider: Provider) {
  return prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { hint: true, label: true, model: true, createdAt: true, lastUsedAt: true },
  });
}

export async function deleteProviderKey(userId: string, provider: Provider) {
  return prisma.apiKey.delete({ where: { userId_provider: { userId, provider } } }).catch(() => null);
}

export async function getUserChatProvider(userId: string): Promise<Provider> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { chatProvider: true },
  });
  return (pref?.chatProvider ?? "anthropic") as Provider;
}

export async function setUserChatProvider(userId: string, provider: Provider) {
  return prisma.userPreference.upsert({
    where: { userId },
    create: { userId, chatProvider: provider },
    update: { chatProvider: provider },
  });
}

// ── Legacy compatibility shims (used by existing routes/tests) ────────────────

export const saveAnthropicKey = (userId: string, plaintext: string, label?: string) =>
  saveProviderKey(userId, "anthropic", plaintext, { label });

export const loadAnthropicKey = async (userId: string): Promise<string | null> => {
  const result = await loadProviderKey(userId, "anthropic");
  return result?.key ?? null;
};

export const getAnthropicKeyMeta = (userId: string) => getProviderKeyMeta(userId, "anthropic");

export const deleteAnthropicKey = (userId: string) => deleteProviderKey(userId, "anthropic");
