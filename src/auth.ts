// Solo-mode auth stub.
//
// Replaces NextAuth with a fixed-user stub for the local-first build.
// All callers of `auth()` keep working — they get back a session for the
// solo user. The user row is created in SQLite on first call so DB FKs to
// User (Map.userId, ApiKey.userId, etc.) resolve.
//
// Exports the same surface (`auth`, `handlers`, `signIn`, `signOut`) as
// the previous NextAuth setup so the 17 call sites don't need to change.
//
// SECURITY: this auth replacement is single-user by design. ANY HTTP
// client that can reach the server is treated as the solo user. That's
// fine for the intended use case (Electron app on your laptop, or
// `next dev -H 127.0.0.1`) but it's catastrophic if the server is
// exposed to the network without external access control. We hard-fail
// at startup if we detect Solo mode bound to a non-loopback address
// without an explicit opt-in, so a careless `docker run -p 3000:3000`
// can't accidentally expose every map.

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { rejectUntrustedRequest } from "@/lib/request-security";

const SOLO_USER_ID = "solo-user";
const FAR_FUTURE = "2099-01-01T00:00:00Z";

// Loopback addresses that are safe to bind to in Solo mode.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function assertSoloModeNotExposed(): void {
  // Skip during the build phase — `next build` runs in-process and
  // never serves traffic. Only the runtime server matters.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Explicit operator opt-in: "I know this is no-auth and I have my
  // own access control in front of it."
  if (process.env.ATLAS_ALLOW_NETWORK === "1") return;
  const host = process.env.HOSTNAME ?? process.env.HOST ?? "";
  if (host && LOOPBACK_HOSTS.has(host)) return;
  throw new Error(
    [
      "Refusing to start: Solo mode (no auth) detected with the server bound",
      `to a non-loopback address (HOSTNAME=${host || "<unset, defaults to 0.0.0.0>"}).`,
      "Anyone who can reach this port becomes the solo user with full",
      "read/write access to every map.",
      "",
      "If you are running on your own laptop, set HOSTNAME=127.0.0.1",
      "(npm scripts already do this — only manual `next start` needs it).",
      "",
      "If you are deploying behind external auth (reverse proxy basic",
      "auth, OAuth proxy, VPN, etc.) and you accept the risk that anyone",
      "who bypasses that proxy gets full access, set ATLAS_ALLOW_NETWORK=1",
      "to acknowledge.",
    ].join("\n"),
  );
}

// Validate at module load — we want to crash on import, not on first
// request, so a misconfigured deploy fails fast and visibly.
assertSoloModeNotExposed();

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

function soloModeAuthResponse(request: Request) {
  const rejection = rejectUntrustedRequest(request);
  if (rejection) return rejection;
  return NextResponse.json({ mode: "solo" }, { status: 404 });
}

// Catch-all /api/auth/* responder. Returns 404 so it's obvious the
// endpoint is inert in solo mode.
export const handlers = {
  GET: soloModeAuthResponse,
  POST: soloModeAuthResponse,
};
