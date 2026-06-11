import { NextRequest, NextResponse } from "next/server";
import { recordInssaAuditEvent } from "../../../../lib/inssa-ops/audit";
import { createInssaSupabaseServerClient } from "../../../../lib/inssa-ops/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const supabase = await createInssaSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`
    }
  });

  if (error) {
    await recordInssaAuditEvent({
      eventType: "unauthorized_access_attempt",
      metadata: { email, reason: error.message },
      status: "denied"
    });
    return NextResponse.json({ error: "Could not send magic link." }, { status: 400 });
  }

  return NextResponse.json({ message: "Check your email for the INSSA QA Operations magic link." });
}
