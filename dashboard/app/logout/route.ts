import { NextRequest, NextResponse } from "next/server";
import { recordInssaAuditEvent } from "../../lib/inssa-ops/audit";
import { getInssaAuthenticatedUser } from "../../lib/inssa-ops/security";
import { createInssaSupabaseServerClient } from "../../lib/inssa-ops/supabase-server";
import { getCanonicalPublicOrigin, requireTrustedMutationOrigin } from "../../lib/inssa-ops/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originFailure = requireTrustedMutationOrigin(request);
  if (originFailure) return originFailure;
  const user = await getInssaAuthenticatedUser();
  const supabase = await createInssaSupabaseServerClient();
  await supabase.auth.signOut();

  await recordInssaAuditEvent({
    eventType: "logout",
    status: "success",
    user
  });

  return NextResponse.redirect(new URL("/login", getCanonicalPublicOrigin()), 303);
}
