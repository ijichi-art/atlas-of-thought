import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN ?? "http://localhost:3002";

function makeSlug(): string {
  return randomBytes(5).toString("base64url"); // ~7 URL-safe chars
}

function shareUrl(slug: string): string {
  return `${ORIGIN}/map/${slug}`;
}

// GET — return current share state
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: mapId } = await params;

  const map = await prisma.map.findFirst({
    where: { id: mapId, userId: session.user.id },
    select: { shareSlug: true, visibility: true },
  });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  return NextResponse.json({
    visibility: map.visibility,
    shareSlug: map.shareSlug,
    shareUrl: map.shareSlug ? shareUrl(map.shareSlug) : null,
  });
}

const PatchBody = z.object({
  visibility: z.enum(["private", "unlisted", "public"]),
});

// PATCH — update visibility (generates slug on first share)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: mapId } = await params;

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const map = await prisma.map.findFirst({
    where: { id: mapId, userId: session.user.id },
    select: { id: true, shareSlug: true },
  });
  if (!map) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  const { visibility } = parsed.data;

  // Generate slug if sharing for the first time.
  let slug = map.shareSlug;
  if (!slug && visibility !== "private") {
    // Retry on the rare collision.
    for (let i = 0; i < 5; i++) {
      const candidate = makeSlug();
      const exists = await prisma.map.findFirst({ where: { shareSlug: candidate }, select: { id: true } });
      if (!exists) { slug = candidate; break; }
    }
    if (!slug) return NextResponse.json({ error: "Could not generate slug" }, { status: 500 });
  }

  const updated = await prisma.map.update({
    where: { id: mapId },
    data: { visibility, shareSlug: slug },
    select: { visibility: true, shareSlug: true },
  });

  return NextResponse.json({
    visibility: updated.visibility,
    shareSlug: updated.shareSlug,
    shareUrl: updated.shareSlug ? shareUrl(updated.shareSlug) : null,
  });
}
