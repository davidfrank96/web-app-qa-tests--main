import { NextRequest, NextResponse } from "next/server";
import { recordInssaAuditEvent } from "../../../../lib/inssa-ops/audit";
import {
  AuthRateLimitUnavailableError,
  consumeAuthenticationRateLimit,
  resetSuccessfulPasswordLimits
} from "../../../../lib/inssa-ops/auth-rate-limit";
import {
  assertAllowedFields,
  readBoundedJsonObject,
  readEmail,
  readRequiredString,
  requestErrorResponse,
  requireTrustedMutationOrigin
} from "../../../../lib/inssa-ops/request-security";
import { toInssaAuthenticatedUser } from "../../../../lib/inssa-ops/security";
import { createInssaSupabaseServerClient } from "../../../../lib/inssa-ops/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originFailure = requireTrustedMutationOrigin(request);
  if (originFailure) return originFailure;

  let email: string;
  let password: string;
  try {
    const body = await readBoundedJsonObject(request, 4_096);
    assertAllowedFields(body, ["email", "password"]);
    email = readEmail(body.email);
    password = readRequiredString(body.password, "password", 1_024);
  } catch (error) {
    return requestErrorResponse(error);
  }

  let rateLimit;
  try {
    rateLimit = await consumeAuthenticationRateLimit(request, "password", email);
  } catch (error) {
    if (error instanceof AuthRateLimitUnavailableError) {
      return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
    }
    throw error;
  }
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many authentication attempts. Try again later." },
      { headers: { "retry-after": String(rateLimit.retryAfterSeconds) }, status: 429 }
    );
  }

  const supabase = await createInssaSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordInssaAuditEvent({
      eventType: "unauthorized_access_attempt",
      metadata: { providerCode: error?.code ?? null, providerStatus: error?.status ?? null },
      status: "denied"
    });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const user = toInssaAuthenticatedUser(data.user);
  if (!user) {
    await supabase.auth.signOut();
    await recordInssaAuditEvent({
      eventType: "unauthorized_access_attempt",
      metadata: { reason: "identity_not_admitted" },
      status: "denied"
    });
    // Keep public failures indistinguishable so the endpoint cannot be used to
    // enumerate valid Supabase identities that are not admitted to the app.
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await resetSuccessfulPasswordLimits(rateLimit.resetScopeHashes).catch(() => null);

  await recordInssaAuditEvent({
    eventType: "login",
    metadata: { method: "password" },
    status: "success",
    user
  });

  return NextResponse.json({ redirectTo: "/" });
}
