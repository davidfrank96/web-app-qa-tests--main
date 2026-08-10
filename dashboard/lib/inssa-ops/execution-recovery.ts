import { recordInssaAuditEvent } from "./audit";
import { recordRunOutcomeNotification } from "./notification-events";
import { getInssaRunStore, type InssaRunStore } from "./run-store";
import type { InssaExecutionJobRecord, InssaRunRecord, InssaRunStatus } from "./types";

type ReconciliationDependencies = {
  recordAudit?: typeof recordInssaAuditEvent;
  recordOutcome?: typeof recordRunOutcomeNotification;
  store?: InssaRunStore;
};

export async function reconcileTerminalExecutionJobRun(
  job: InssaExecutionJobRecord,
  dependencies: ReconciliationDependencies = {}
) {
  if (!["completed", "failed", "abandoned"].includes(job.status)) return false;
  const store = dependencies.store ?? getInssaRunStore();
  const run = await store.getRun(job.runId);
  if (!run || isTerminalRun(run)) return false;

  const completedAt = job.completedAt ?? new Date().toISOString();
  const startedAtMs = Date.parse(run.startedAt ?? run.createdAt);
  const completedAtMs = Date.parse(completedAt);
  const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
    ? Math.max(0, completedAtMs - startedAtMs)
    : 0;
  const status: InssaRunStatus = run.startedAt ? "failed" : "failed_startup";
  const reason = job.lastError ?? `Execution job reached ${job.status} without a terminal campaign run state.`;

  await store.appendLog(
    run.id,
    "system",
    `Execution recovery reconciled terminal job status=${job.status}, attempt=${job.attempt}: ${reason}`
  );
  const updated = await store.updateRun(run.id, {
    completedAt,
    durationMs,
    exitCode: run.exitCode,
    status
  });
  await (dependencies.recordAudit ?? recordInssaAuditEvent)({
    campaignKey: run.campaignKey,
    eventType: "run_failed",
    metadata: {
      attempt: job.attempt,
      executionJobId: job.id,
      executionJobStatus: job.status,
      reason,
      reconciliation: true
    },
    runId: run.id,
    status
  });
  await (dependencies.recordOutcome ?? recordRunOutcomeNotification)(updated, status, durationMs, updated.exitCode);
  return true;
}

function isTerminalRun(run: InssaRunRecord) {
  return ["passed", "passed_with_warnings", "failed", "failed_startup", "cancelled", "timed_out"].includes(run.status);
}
