import { NextResponse } from "next/server";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostnameFromHostHeader(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function reject(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Solo mode has no user authentication, so the HTTP boundary is part of
 * the security model. Reject non-loopback Host headers (DNS rebinding) and
 * cross-origin mutations (localhost CSRF) before a route reads a request
 * body or touches the database.
 */
export function rejectUntrustedRequest(request: Request): NextResponse | null {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return reject("Invalid request URL", 400);
  }

  const networkAccessEnabled = process.env.ATLAS_ALLOW_NETWORK === "1";
  const hostHeader = request.headers.get("host");
  const requestHostname = hostHeader
    ? hostnameFromHostHeader(hostHeader)
    : requestUrl.hostname.toLowerCase();
  if (!requestHostname) {
    return reject("Invalid Host header", 400);
  }
  if (!networkAccessEnabled && !LOOPBACK_HOSTS.has(requestHostname)) {
    return reject("Untrusted Host header", 421);
  }

  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return reject("Cross-site request blocked", 403);
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    // Preserve local CLI/API use. Browser mutation requests include Origin
    // and Sec-Fetch-Site, which are validated above.
    return null;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return reject("Invalid Origin header", 403);
  }

  const expectedHost = hostHeader ?? requestUrl.host;
  const expectedProtocol =
    networkAccessEnabled && request.headers.get("x-forwarded-proto")
      ? request.headers.get("x-forwarded-proto")!.split(",", 1)[0].trim()
      : requestUrl.protocol.slice(0, -1);
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(`${expectedProtocol}://${expectedHost}`).origin;
  } catch {
    return reject("Invalid Host header", 400);
  }

  if (originUrl.origin !== expectedOrigin) {
    return reject("Cross-origin request blocked", 403);
  }

  return null;
}
