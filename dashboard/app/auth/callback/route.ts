import { NextRequest, NextResponse } from "next/server";
import { recordInssaAuditEvent } from "../../../lib/inssa-ops/audit";
import { getInssaAuthenticatedUser } from "../../../lib/inssa-ops/security";
import { createInssaSupabaseServerClient } from "../../../lib/inssa-ops/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createInssaSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const user = await getInssaAuthenticatedUser();
  if (user) {
    await recordInssaAuditEvent({
      eventType: "login",
      metadata: { method: "magic-link" },
      status: "success",
      user
    });
  }

  return NextResponse.redirect(new URL("/", request.url));
}
