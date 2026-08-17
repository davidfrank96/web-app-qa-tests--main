import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../lib/inssa-ops/api-guard";
import { recordInssaAuditEvent } from "../../../../../lib/inssa-ops/audit";
import { getInssaRunStore } from "../../../../../lib/inssa-ops/run-store";
import {
  assertAllowedFields,
  readBoundedJsonObject,
  readUuid,
  requestErrorResponse,
  requireTrustedMutationOrigin
} from "../../../../../lib/inssa-ops/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInssaApiUser(request, "admin");
  if (auth.response) return auth.response;
  const originFailure = requireTrustedMutationOrigin(request);
  if (originFailure) return originFailure;
  let id: string;
  let body: Record<string, unknown>;
  try {
    id = readUuid((await context.params).id, "run id");
    body = await readBoundedJsonObject(request, 1_024);
    assertAllowedFields(body, ["confirmed"]);
  } catch (error) {
    return requestErrorResponse(error);
  }
  if (body?.confirmed !== true) return NextResponse.json({ error: "confirmed=true is required." }, { status: 400 });

  const store = getInssaRunStore();
  const run = await store.getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (!run.commandSnapshot.mutatesStaging || !run.cleanup || run.cleanup.status === "not_required") {
    return NextResponse.json({ error: "This run does not have a manual cleanup obligation." }, { status: 400 });
  }
  if (run.cleanup.status === "manually_confirmed") {
    return NextResponse.json({ cleanup: run.cleanup });
  }
  if (["queued", "starting", "running", "indexing_artifacts"].includes(run.status)) {
    return NextResponse.json({ error: "Cleanup cannot be confirmed while the run is active." }, { status: 409 });
  }

  const cleanup = {
    ...run.cleanup,
    confirmedAt: new Date().toISOString(),
    confirmedBy: auth.user.email || auth.user.id,
    status: "manually_confirmed" as const
  };
  const updated = await store.updateRun(id, { cleanup });
  await recordInssaAuditEvent({ campaignKey: run.campaignKey, eventType: "cleanup_acknowledged", metadata: { cleanupStatus: cleanup.status }, runId: run.id, status: "acknowledged", user: auth.user });
  await recordInssaAuditEvent({ campaignKey: run.campaignKey, eventType: "cleanup_verified", metadata: { cleanupStatus: cleanup.status }, runId: run.id, status: "verified", user: auth.user });
  return NextResponse.json({ cleanup: updated.cleanup });
}
