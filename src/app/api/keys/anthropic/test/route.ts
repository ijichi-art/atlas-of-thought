import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { loadAnthropicKey } from "@/lib/api-keys";

// Cheapest possible call: 1 token completion against Haiku.
// This is the canonical "is the BYOK key valid" check.
const TEST_MODEL = "claude-haiku-4-5-20251001";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = await loadAnthropicKey(session.user.id);
  if (!apiKey) {
    return NextResponse.json({ error: "No API key on file" }, { status: 404 });
  }
  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: TEST_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return NextResponse.json({ ok: true, model: res.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Test call failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
