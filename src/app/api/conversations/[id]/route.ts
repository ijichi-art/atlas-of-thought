import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rejectUntrustedRequest } from "@/lib/request-security";

// Single-conversation fetch — used by the detail panel when a POI is
// clicked so the panel shows the exact conversation that was tapped,
// not the cluster's static sample. Returns title + ordered messages
// (full text, not just preview snippets).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejection = rejectUntrustedRequest(req);
  if (rejection) return rejection;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const conv = await prisma.conversation.findFirst({
    where: { id, map: { userId } },
    select: {
      id: true,
      title: true,
      mapId: true,
      messages: {
        orderBy: { ordinal: "asc" },
        select: { ordinal: true, role: true, text: true },
      },
    },
  });
  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: conv.id,
    title: conv.title,
    messages: conv.messages.map((m) => ({
      ordinal: m.ordinal,
      role: m.role as "user" | "assistant" | "system" | "tool",
      text: m.text,
    })),
  });
}
