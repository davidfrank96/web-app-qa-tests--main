import { NextRequest, NextResponse } from "next/server";
import { recordInssaAuditEvent } from "../../../lib/inssa-ops/audit";
import { getCanonicalPublicOrigin } from "../../../lib/inssa-ops/request-security";
import { getInssaAuthenticatedUser } from "../../../lib/inssa-ops/security";
import { createInssaSupabaseServerClient } from "../../../lib/inssa-ops/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = getCanonicalPublicOrigin();
  if (code && code.length <= 2_048) {
    const supabase = await createInssaSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?reason=invalid_callback", origin));
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

  if (!user) {
    const supabase = await createInssaSupabaseServerClient();
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?reason=unauthorized", origin));
  }

  return NextResponse.redirect(new URL("/", origin));
}
