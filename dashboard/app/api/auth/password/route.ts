import { NextRequest, NextResponse } from "next/server";
import { recordInssaAuditEvent } from "../../../../lib/inssa-ops/audit";
import { toInssaAuthenticatedUser } from "../../../../lib/inssa-ops/security";
import { createInssaSupabaseServerClient } from "../../../../lib/inssa-ops/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const supabase = await createInssaSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordInssaAuditEvent({
      eventType: "unauthorized_access_attempt",
      metadata: { email, reason: error?.message ?? "Supabase password sign-in failed" },
      status: "denied"
    });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await recordInssaAuditEvent({
    eventType: "login",
    metadata: { method: "password" },
    status: "success",
    user: toInssaAuthenticatedUser(data.user)
  });

  return NextResponse.json({ redirectTo: "/" });
}
