import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../lib/inssa-ops/api-guard";
import { verifyRetentionConfirmation } from "../../../../lib/inssa-ops/retention-confirmation";
import { certifyExecutionPlan, executeRetention } from "../../../../lib/inssa-ops/retention-executor";
import { evaluateRetention } from "../../../../lib/inssa-ops/retention";
import { createRetentionExecutorIO } from "../../../../lib/inssa-ops/retention-service";
import { assertAllowedFields, InssaRequestError, readBoundedJsonObject, requireTrustedMutationOrigin } from "../../../../lib/inssa-ops/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "admin");
  if (auth.response) return auth.response;
  const originError = requireTrustedMutationOrigin(request);
  if (originError) return originError;
  const headers = { "cache-control": "no-store" };
  try {
    const body = await readBoundedJsonObject(request, 24_000);
    assertAllowedFields(body, ["token", "confirmation"]);
    const approval = verifyRetentionConfirmation(body.token, body.confirmation, auth.user.id);
    const io = createRetentionExecutorIO(request.signal);
    const plan = evaluateRetention(await io.snapshot(), new Date().toISOString());
    certifyExecutionPlan(plan);
    if (plan.snapshotRevision !== approval.revision) throw new InssaRequestError("Evidence or protection state changed. Refresh and review the eligible batch again.", 409);
    const result = await executeRetention(io, { occurrence: approval.occurrence, owner: `admin-${auth.user.id}-${randomUUID()}`,
      approvedBundleIds: approval.bundleIds, signal: request.signal });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof InssaRequestError ? error.message : "Retention execution could not be completed. Refresh to inspect durable maintenance status." },
      { status: error instanceof InssaRequestError ? error.status : 503, headers });
  }
}
