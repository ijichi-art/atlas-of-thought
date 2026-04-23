import { prisma } from "@/lib/prisma";
import { encrypt, decrypt, hintFromKey } from "@/lib/crypto";

export async function saveAnthropicKey(userId: string, plaintext: string, label?: string) {
  const trimmed = plaintext.trim();
  if (!trimmed.startsWith("sk-ant-")) {
    throw new Error("Anthropic API keys start with `sk-ant-`. Double-check the value you pasted.");
  }
  const ciphertext = encrypt(trimmed);
  const hint = hintFromKey(trimmed);
  return prisma.apiKey.upsert({
    where: { userId_provider: { userId, provider: "anthropic" } },
    create: { userId, provider: "anthropic", ciphertext, hint, label },
    update: { ciphertext, hint, label, lastUsedAt: null },
  });
}

export async function loadAnthropicKey(userId: string): Promise<string | null> {
  const row = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider: "anthropic" } },
  });
  if (!row) return null;
  await prisma.apiKey.update({
    where: { userId_provider: { userId, provider: "anthropic" } },
    data: { lastUsedAt: new Date() },
  });
  return decrypt(row.ciphertext);
}

export async function getAnthropicKeyMeta(userId: string) {
  return prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider: "anthropic" } },
    select: { hint: true, label: true, createdAt: true, lastUsedAt: true },
  });
}

export async function deleteAnthropicKey(userId: string) {
  return prisma.apiKey.delete({
    where: { userId_provider: { userId, provider: "anthropic" } },
  });
}
