import type { InssaAuthenticatedUser } from "./security";
import type { InssaRunStore } from "./run-store";
import {
  IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT,
  LIVE_MUTATION_ACKNOWLEDGEMENTS,
  LIVE_MUTATION_CONFIRMATION_PHRASE,
  validateLiveCampaignPreflight
} from "./live-campaigns";
import type {
  InssaCleanupLedgerRecord,
  InssaCommandDefinition,
  InssaRunRecord
} from "./types";

export type InssaMutationReadinessStatus =
  | "READY"
  | "READY_WITH_DEFERRED_CLEANUP"
  | "BLOCKED_CONFIGURATION"
  | "BLOCKED_CLEANUP_IDENTITY"
  | "BLOCKED_CLEANUP_POLICY"
  | "BLOCKED_ACCOUNT"
  | "BLOCKED_FIXTURE"
  | "BLOCKED_WORKER"
  | "BLOCKED_ACTIVE_RUN"
  | "NOT_YET_VALIDATED";

export type InssaMutationReadinessRecord = {
  blockingReason: string | null;
  campaignKey: string;
  checks: Array<{ detail: string; id: string; passed: boolean }>;
  cleanupStatus: string;
  createdObjectPaths: string[];
  executionAllowed: boolean;
  latestRunAvailable: boolean;
  latestRunId: string | null;
  lastResult: string;
  oldestUnresolvedAt: string | null;
  retentionDeadline: string | null;
  safelyAccounted: boolean;
  status: InssaMutationReadinessStatus;
  unresolvedCount: number;
};

type ReadinessDependencies = {
  activeRunId: string | null;
  environment?: Record<string, string | undefined>;
  now?: Date;
  repoRoot?: string;
  store: InssaRunStore;
  workerHealthy: boolean;
};

export async function evaluateMutationCampaignReadiness(
  command: InssaCommandDefinition,
  user: InssaAuthenticatedUser,
  dependencies: ReadinessDependencies
): Promise<InssaMutationReadinessRecord> {
  const approval = {
    acknowledgements: [...LIVE_MUTATION_ACKNOWLEDGEMENTS, IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT],
    confirmationPhrase: LIVE_MUTATION_CONFIRMATION_PHRASE,
    ...(command.supportsExecutionModes ? { executionMode: "create" as const } : {})
  };
  const preflight = await validateLiveCampaignPreflight(command, approval, user, {
    activeRunId: dependencies.activeRunId,
    environment: dependencies.environment,
    now: dependencies.now,
    repoRoot: dependencies.repoRoot,
    store: dependencies.store,
    workerHealthy: dependencies.workerHealthy
  });
  const [runs, ledger] = await Promise.all([
    dependencies.store.listRuns(),
    dependencies.store.listCleanupLedger()
  ]);
  const correlation = correlateMutationCampaign(command.key, runs, ledger);
  const unresolved = ledger.filter((record) => record.status !== "completed");
  const status = preflight.ok
    ? correlation.hasHistoricalExecution
      ? unresolved.length > 0
        ? "READY_WITH_DEFERRED_CLEANUP"
        : "READY"
      : "NOT_YET_VALIDATED"
    : classifyBlockedReadiness(preflight.checks.find((check) => !check.passed)?.id);

  return {
    blockingReason: preflight.ok ? null : preflight.error,
    campaignKey: command.key,
    checks: preflight.checks,
    cleanupStatus: correlation.cleanupStatus,
    createdObjectPaths: correlation.records.map((record) => record.objectPath),
    executionAllowed: preflight.ok,
    latestRunAvailable: correlation.latestRun !== null,
    latestRunId: correlation.latestRun?.id ?? correlation.latestLedgerRecord?.originatingRunId ?? null,
    lastResult: correlation.latestRun?.status ?? (correlation.hasHistoricalExecution ? "historical_run_recorded" : "not_yet_validated"),
    oldestUnresolvedAt: oldestDate(unresolved.map((record) => record.createdAt)),
    retentionDeadline: oldestDate(correlation.records.map((record) => record.retentionUntil)),
    safelyAccounted: correlation.records.length === 0 || correlation.records.every(isSafelyAccounted),
    status,
    unresolvedCount: unresolved.length
  };
}

export function correlateMutationCampaign(
  campaignKey: string,
  runs: InssaRunRecord[],
  ledger: InssaCleanupLedgerRecord[]
) {
  const campaignRuns = runs
    .filter((run) => run.campaignKey === campaignKey)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const records = ledger
    .filter((record) => record.campaignKey === campaignKey)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const latestRun = campaignRuns[0] ?? null;
  const latestLedgerRecord = records[0] ?? null;
  const correlatedRecords = latestRun
    ? records.filter((record) => record.originatingRunId === latestRun.id)
    : latestLedgerRecord
      ? records.filter((record) => record.originatingRunId === latestLedgerRecord.originatingRunId)
      : [];
  return {
    cleanupStatus: correlatedRecords[0]?.status ?? latestRun?.cleanup?.status ?? "not_recorded",
    hasHistoricalExecution: Boolean(latestRun || latestLedgerRecord),
    latestLedgerRecord,
    latestRun,
    records: correlatedRecords
  };
}

export function classifyBlockedReadiness(failedCheckId?: string): InssaMutationReadinessStatus {
  if (failedCheckId === "worker-health") return "BLOCKED_WORKER";
  if (failedCheckId === "active-run") return "BLOCKED_ACTIVE_RUN";
  if (failedCheckId === "cleanup-identity" || failedCheckId === "cleanup-ledger") return "BLOCKED_CLEANUP_IDENTITY";
  if (failedCheckId?.startsWith("cleanup-") || failedCheckId === "cleanup-state" || failedCheckId === "deferred-mode" || failedCheckId === "mutation-rate") {
    return "BLOCKED_CLEANUP_POLICY";
  }
  if (failedCheckId === "qa-account" || failedCheckId === "account-separation" || failedCheckId === "admin-role") return "BLOCKED_ACCOUNT";
  if (failedCheckId === "media-fixture" || failedCheckId === "video-fixture" || failedCheckId === "resume-artifact") return "BLOCKED_FIXTURE";
  return "BLOCKED_CONFIGURATION";
}

function isSafelyAccounted(record: InssaCleanupLedgerRecord) {
  return record.safelyAccounted && record.dedicatedQaAccount && record.sensitiveValuesExcluded && !record.unexpectedData;
}

function oldestDate(values: string[]) {
  const valid = values.filter((value) => Number.isFinite(new Date(value).getTime())).sort();
  return valid[0] ?? null;
}
