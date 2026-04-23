import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { saveAnthropicKey, deleteAnthropicKey } from "@/lib/api-keys";

const PostBody = z.object({
  key: z.string().min(10),
  label: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  try {
    await saveAnthropicKey(session.user.id, parsed.data.key, parsed.data.label);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await deleteAnthropicKey(session.user.id).catch(() => null);
  return NextResponse.json({ ok: true });
}
