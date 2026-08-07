import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { recordInssaAuditEvent } from "../../../lib/inssa-ops/audit";
import { getInssaPhase1Command } from "../../../lib/inssa-ops/command-registry";
import { getInssaExecutionJobStore } from "../../../lib/inssa-ops/execution-job-store";
import { dashboardWorkerIsHealthy, isGovernedLiveCampaign, validateLiveCampaignPreflight } from "../../../lib/inssa-ops/live-campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "admin");
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  const campaignKey = typeof body?.campaignKey === "string" ? body.campaignKey : "";
  const command = getInssaPhase1Command(campaignKey);
  if (!isGovernedLiveCampaign(command)) {
    await recordInssaAuditEvent({ campaignKey, eventType: "run_denied", metadata: { reason: "Not a governed live campaign." }, status: "denied", user: auth.user });
    return NextResponse.json({ error: "The selected command is not a governed live campaign." }, { status: 400 });
  }

  if (body?.action === "opened") {
    await recordInssaAuditEvent({ campaignKey, eventType: "approval_opened", metadata: { targetHost: "staging.inssa.us" }, status: "opened", user: auth.user });
    return NextResponse.json({ ok: true });
  }
  if (body?.action !== "preflight" || !command) {
    return NextResponse.json({ error: "action must be opened or preflight." }, { status: 400 });
  }

  const activeJob = await getInssaExecutionJobStore().getActive();
  const result = await validateLiveCampaignPreflight(command, body.liveApproval, auth.user, {
    activeRunId: activeJob?.runId ?? null,
    workerHealthy: await dashboardWorkerIsHealthy()
  });
  if (!result.ok) {
    await recordInssaAuditEvent({
      campaignKey,
      eventType: "preflight_failed",
      metadata: { checks: result.checks, reason: result.error },
      status: "failed_preflight",
      user: auth.user
    });
    return NextResponse.json({ checks: result.checks, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ checks: result.checks, ok: true });
}
