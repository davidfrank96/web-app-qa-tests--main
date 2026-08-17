import type { NextRequest } from "next/server";
import { refreshInssaSession } from "./lib/inssa-ops/session-refresh";

export async function middleware(request: NextRequest) {
  return refreshInssaSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
  runtime: "nodejs"
};
