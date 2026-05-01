// Solo-mode auth stub.
//
// Replaces NextAuth with a fixed-user stub for the local-first build.
// All callers of `auth()` keep working — they get back a session for the
// solo user. The user row is created in SQLite on first call so DB FKs to
// User (Map.userId, ApiKey.userId, etc.) resolve.
//
// Exports the same surface (`auth`, `handlers`, `signIn`, `signOut`) as
// the previous NextAuth setup so the 17 call sites don't need to change.

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const SOLO_USER_ID = "solo-user";
const FAR_FUTURE = "2099-01-01T00:00:00Z";

let ensureUserPromise: Promise<void> | null = null;

async function ensureSoloUser(): Promise<void> {
  if (!ensureUserPromise) {
    ensureUserPromise = (async () => {
      await prisma.user.upsert({
        where: { id: SOLO_USER_ID },
        update: {},
        create: {
          id: SOLO_USER_ID,
          name: "Solo User",
          email: "solo@local",
        },
      });
    })();
  }
  return ensureUserPromise;
}

type SoloSession = {
  user: { id: string; name: string; email: string };
  expires: string;
};

export async function auth(): Promise<SoloSession> {
  await ensureSoloUser();
  return {
    user: { id: SOLO_USER_ID, name: "Solo User", email: "solo@local" },
    expires: FAR_FUTURE,
  };
}

// Signature matches NextAuth's: callers pass provider name + options, but
// we ignore them since there's only one user in solo mode.
export async function signIn(
  _provider?: unknown,
  _options?: unknown,
): Promise<void> {
  // intentional no-op
}

export async function signOut(_options?: unknown): Promise<void> {
  // intentional no-op
}

// Catch-all /api/auth/* responder. Returns 404 so it's obvious the
// endpoint is inert in solo mode.
export const handlers = {
  GET: () => NextResponse.json({ mode: "solo" }, { status: 404 }),
  POST: () => NextResponse.json({ mode: "solo" }, { status: 404 }),
};
