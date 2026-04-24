import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const maps = await prisma.map.findMany({
    where: { userId: session.user.id },
    select: { id: true, title: true, visibility: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ maps });
}

const CreateBody = z.object({
  title: z.string().min(1).max(120).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const map = await prisma.map.create({
    data: {
      userId: session.user.id,
      title: parsed.data.title ?? "My Atlas",
    },
    select: { id: true, title: true, visibility: true, createdAt: true },
  });

  return NextResponse.json({ map }, { status: 201 });
}
