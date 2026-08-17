import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { synchronizeConfiguredCleanupLedger } from "../../../lib/inssa-ops/cleanup-ledger";
import { listInssaPhase1Commands } from "../../../lib/inssa-ops/command-registry";
import { getInssaExecutionJobStore } from "../../../lib/inssa-ops/execution-job-store";
import { dashboardWorkerIsHealthy, isGovernedLiveCampaign } from "../../../lib/inssa-ops/live-campaigns";
import { evaluateMutationCampaignReadiness } from "../../../lib/inssa-ops/mutation-readiness";
import { getInssaRunStore } from "../../../lib/inssa-ops/run-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  try {
    const store = getInssaRunStore();
    await synchronizeConfiguredCleanupLedger(undefined, store);
    const records = await store.listCleanupLedger();
    const activeJob = await getInssaExecutionJobStore().getActive();
    const workerHealthy = await dashboardWorkerIsHealthy();
    const readiness = [];
    for (const command of listInssaPhase1Commands().filter(isGovernedLiveCampaign)) {
      readiness.push(await evaluateMutationCampaignReadiness(command, auth.user, {
        activeRunId: activeJob?.runId ?? null,
        store,
        workerHealthy
      }));
    }
    return NextResponse.json({
      banner: "INSSA staging cleanup is deferred because direct database access is unavailable.",
      readiness,
      records
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), records: [] },
      { status: 500 }
    );
  }
}
