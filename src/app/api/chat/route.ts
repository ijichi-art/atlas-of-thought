import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAiClient } from "@/lib/ai-client";

const Body = z.object({
  cityLabel: z.string().min(1).max(200),
  citySummary: z.string().max(2000).optional(),
  countryName: z.string().max(200).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
    .max(200)
    .optional(),
  text: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { cityLabel, citySummary, countryName, history = [], text, conversationId } = parsed.data;

  const aiClient = await getAiClient(userId);
  if (!aiClient) {
    return NextResponse.json(
      { error: "no_api_key", message: "Add an API key in Settings first." },
      { status: 402 }
    );
  }

  // Ensure the user has a map to attach the conversation to.
  let map = await prisma.map.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!map) {
    map = await prisma.map.create({
      data: { userId, title: "My Atlas" },
      select: { id: true },
    });
  }
  const mapId = map.id;

  // Resolve or create the DB conversation.
  let convId = conversationId;
  if (convId) {
    const existing = await prisma.conversation.findFirst({
      where: { id: convId, mapId },
      select: { id: true },
    });
    if (!existing) convId = undefined;
  }
  if (!convId) {
    const conv = await prisma.conversation.create({
      data: { mapId, source: "native", title: cityLabel },
      select: { id: true },
    });
    convId = conv.id;
  }

  // Ordinal counter: next message index in this conversation.
  const { _count } = await prisma.message.aggregate({
    where: { conversationId: convId },
    _count: true,
  });
  let nextOrdinal = _count;

  // Persist the user message immediately.
  await prisma.message.create({
    data: { conversationId: convId, ordinal: nextOrdinal++, role: "user", text },
  });

  const system = [
    "You are a guide in the Atlas of Thought — a living map where ideas become cities.",
    `The user is visiting "${cityLabel}"${countryName ? ` in the region of "${countryName}"` : ""}.`,
    citySummary ? `About this city: ${citySummary}` : "",
    "Help them explore this topic with curiosity and depth. Be concise.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user" as const, content: text },
  ];

  const convIdCapture = convId;
  const ordinalCapture = nextOrdinal;
  const clientStream = aiClient.stream({ system, messages });

  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let fullText = "";
      try {
        for await (const chunk of clientStream) {
          fullText += chunk;
          controller.enqueue(enc.encode(chunk));
        }
        await prisma.message.create({
          data: {
            conversationId: convIdCapture,
            ordinal: ordinalCapture,
            role: "assistant",
            text: fullText,
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Conversation-Id": convId,
      "Cache-Control": "no-cache",
    },
  });
}
