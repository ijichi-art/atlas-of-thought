import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  saveProviderKey,
  deleteProviderKey,
  setUserChatProvider,
  type Provider,
} from "@/lib/api-keys";

const VALID_PROVIDERS = new Set<Provider>(["anthropic", "openai", "deepseek"]);

const PostBody = z.object({
  key: z.string().min(10),
  model: z.string().max(80).optional(),
  label: z.string().max(60).optional(),
  setActive: z.boolean().optional(),
});

function resolveProvider(raw: string): Provider | null {
  return VALID_PROVIDERS.has(raw as Provider) ? (raw as Provider) : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider: rawProvider } = await params;
  const provider = resolveProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    await saveProviderKey(session.user.id, provider, parsed.data.key, {
      label: parsed.data.label,
      model: parsed.data.model,
    });
    if (parsed.data.setActive) {
      await setUserChatProvider(session.user.id, provider);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider: rawProvider } = await params;
  const provider = resolveProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  await deleteProviderKey(session.user.id, provider);
  return NextResponse.json({ ok: true });
}
