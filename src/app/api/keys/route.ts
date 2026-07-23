import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserChatProvider } from "@/lib/api-keys";
import { rejectUntrustedRequest } from "@/lib/request-security";

// Returns all configured keys (hint only) + active provider.
export async function GET(req: Request) {
  const rejection = rejectUntrustedRequest(req);
  if (rejection) return rejection;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [keys, activeProvider] = await Promise.all([
    prisma.apiKey.findMany({
      where: { userId },
      select: { provider: true, hint: true, model: true, label: true, lastUsedAt: true },
    }),
    getUserChatProvider(userId),
  ]);

  return NextResponse.json({ keys, activeProvider });
}
