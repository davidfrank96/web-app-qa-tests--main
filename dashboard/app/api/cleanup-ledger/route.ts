import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { readCleanupLedgerSnapshot } from "../../../lib/inssa-ops/cleanup-ledger";
import { listInssaPhase1Commands } from "../../../lib/inssa-ops/command-registry";
import { getInssaExecutionJobStore } from "../../../lib/inssa-ops/execution-job-store";
import { dashboardWorkerIsHealthy, isGovernedLiveCampaign } from "../../../lib/inssa-ops/live-campaigns";
import { evaluateMutationCampaignReadiness } from "../../../lib/inssa-ops/mutation-readiness";
import { getInssaRunStore } from "../../../lib/inssa-ops/run-store";

import { confirmManualCleanupRecord } from "../../../lib/inssa-ops/manual-cleanup";
import { assertAllowedFields, readBoundedJsonObject, requireTrustedMutationOrigin, requestErrorResponse, InssaRequestError } from "../../../lib/inssa-ops/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  try {
    const store = getInssaRunStore();
    const records = await readCleanupLedgerSnapshot(undefined, store);
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

export async function POST(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "admin");
  if (auth.response) return auth.response;
  const originFailure = requireTrustedMutationOrigin(request);
  if (originFailure) return originFailure;
  try {
    const body = await readBoundedJsonObject(request, 4096);
    assertAllowedFields(body, ["recordId", "objectId", "runId", "confirmationPhrase", "note"]);
    for (const key of ["recordId", "objectId", "runId"]) if (typeof body[key] !== "string" || !body[key] || (body[key] as string).length > 1000) throw new InssaRequestError(`Valid ${key} required.`, 400);
    const record = await confirmManualCleanupRecord(getInssaRunStore(), auth.user, {
      recordId: body.recordId as string, objectId: body.objectId as string, runId: body.runId as string,
      confirmationPhrase: body.confirmationPhrase, note: body.note
    });
    return NextResponse.json({ record });
  } catch (error) { return requestErrorResponse(error); }
}
