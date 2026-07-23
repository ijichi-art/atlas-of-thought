import { NextResponse, type NextRequest } from "next/server";
import { rejectUntrustedRequest } from "@/lib/request-security";

export function proxy(request: NextRequest) {
  return rejectUntrustedRequest(request) ?? NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/import/:path*", "/settings/:path*", "/atlas/:path*"],
};
