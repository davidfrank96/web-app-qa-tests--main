import { NextRequest, NextResponse } from "next/server";
import { recordInssaAuditEvent } from "../../../../lib/inssa-ops/audit";
import { AuthRateLimitUnavailableError, consumeAuthenticationRateLimit } from "../../../../lib/inssa-ops/auth-rate-limit";
import {
  assertAllowedFields,
  getCanonicalPublicOrigin,
  readBoundedJsonObject,
  readEmail,
  requestErrorResponse,
  requireTrustedMutationOrigin
} from "../../../../lib/inssa-ops/request-security";
import { createInssaSupabaseServerClient } from "../../../../lib/inssa-ops/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originFailure = requireTrustedMutationOrigin(request);
  if (originFailure) return originFailure;

  let email: string;
  let origin: string;
  try {
    const body = await readBoundedJsonObject(request, 2_048);
    assertAllowedFields(body, ["email"]);
    email = readEmail(body.email);
    origin = getCanonicalPublicOrigin();
  } catch (error) {
    return requestErrorResponse(error);
  }

  try {
    const rateLimit = await consumeAuthenticationRateLimit(request, "magic-link", email);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many authentication attempts. Try again later." },
        { headers: { "retry-after": String(rateLimit.retryAfterSeconds) }, status: 429 }
      );
    }
  } catch (error) {
    if (error instanceof AuthRateLimitUnavailableError) {
      return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
    }
    throw error;
  }

  const supabase = await createInssaSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: false
    }
  });

  if (error) {
    await recordInssaAuditEvent({
      eventType: "unauthorized_access_attempt",
      metadata: { providerCode: error.code ?? null, providerStatus: error.status ?? null },
      status: "denied"
    });
    // The public response is intentionally indistinguishable for admitted and
    // unknown accounts. Provider failures remain available in the audit trail.
    return NextResponse.json({ message: "If the account is authorized, a sign-in link will be sent." });
  }

  return NextResponse.json({ message: "If the account is authorized, a sign-in link will be sent." });
}
