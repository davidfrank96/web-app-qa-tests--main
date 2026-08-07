import fs from "node:fs/promises";
import path from "node:path";
import { getRepoRoot } from "./paths";
import { getInssaRunStore, type InssaRunStore } from "./run-store";
import type {
  InssaCleanupLedgerRecord,
  InssaCleanupManifest,
  InssaCleanupPolicySnapshot,
  InssaRunRecord
} from "./types";

const DEFAULT_MAX_UNRESOLVED_OBJECTS = 10;
const DEFAULT_MAX_UNRESOLVED_AGE_DAYS = 90;
const DEFAULT_MAX_MUTATION_RUNS_PER_DAY = 10;
const DEFAULT_RETENTION_DAYS = 90;

export type CleanupGateResult =
  | {
      error: string;
      id: string;
      ok: false;
      policy: InssaCleanupPolicySnapshot;
      unresolved: InssaCleanupLedgerRecord[];
    }
  | {
      ok: true;
      policy: InssaCleanupPolicySnapshot;
      unresolved: InssaCleanupLedgerRecord[];
    };

export function resolveCleanupPolicy(
  environment: Record<string, string | undefined>,
  requiresSecondaryAccount = false
): InssaCleanupPolicySnapshot {
  const primaryDedicated = environment.INSSA_TEST_ACCOUNT_IS_DEDICATED_QA === "1";
  const secondaryDedicated = !requiresSecondaryAccount || environment.INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA === "1";
  return {
    dedicatedQaAccountsConfirmed: primaryDedicated && secondaryDedicated,
    deferredModeEnabled: environment.INSSA_DEFERRED_CLEANUP_MODE === "1",
    maxMutationRunsPerDay: positiveInteger(environment.INSSA_MAX_MUTATION_RUNS_PER_DAY, DEFAULT_MAX_MUTATION_RUNS_PER_DAY),
    maxUnresolvedAgeDays: positiveInteger(environment.INSSA_MAX_UNRESOLVED_AGE_DAYS, DEFAULT_MAX_UNRESOLVED_AGE_DAYS),
    maxUnresolvedObjects: positiveInteger(environment.INSSA_MAX_UNRESOLVED_OBJECTS, DEFAULT_MAX_UNRESOLVED_OBJECTS),
    retentionDays: positiveInteger(environment.INSSA_UNRESOLVED_RETENTION_DAYS, DEFAULT_RETENTION_DAYS)
  };
}

export async function synchronizeConfiguredCleanupLedger(
  repoRoot = getRepoRoot(),
  store: InssaRunStore = getInssaRunStore()
) {
  const records = await readConfiguredCleanupLedger(repoRoot);
  for (const record of records) await store.upsertCleanupLedger(record);
  return records;
}

export async function persistCleanupLedgerForRun(
  run: InssaRunRecord,
  manifest: InssaCleanupManifest,
  store: InssaRunStore = getInssaRunStore()
) {
  const records = buildCleanupLedgerRecords(run, manifest);
  return store.replaceRunCleanupLedger(run.id, records);
}

export function buildCleanupLedgerRecords(run: InssaRunRecord, manifest: InssaCleanupManifest) {
  const now = manifest.recordedAt ?? new Date().toISOString();
  const status = toLedgerStatus(manifest.status);
  if (!status) return [];
  const common = {
    affectedUsers: manifest.affectedUsers,
    campaignKey: run.campaignKey,
    createdAt: now,
    dedicatedQaAccount: manifest.dedicatedQaAccount === true,
    deferredAt: status === "deferred" || status === "cleanup_unavailable" ? now : null,
    environment: "staging" as const,
    evidencePaths: manifest.evidencePaths ?? [],
    mediaType: manifest.mediaType ?? null,
    notes: manifest.instructions.join(" ") || null,
    originatingRunId: run.id,
    ownerAccount: manifest.ownerAccount ?? manifest.affectedUsers[0] ?? null,
    product: "INSSA" as const,
    reasonCode: manifest.reasonCode ?? null,
    resultingState: manifest.lifecycleState,
    resolvedAt: status === "completed" ? now : null,
    retentionUntil: manifest.retentionUntil ?? addDays(now, DEFAULT_RETENTION_DAYS),
    safelyAccounted: manifest.safelyAccounted === true,
    schemaVersion: 1 as const,
    securitySensitive: run.commandSnapshot.requiresSecondaryAccount === true || /security/i.test(run.campaignKey),
    sensitiveValuesExcluded: manifest.sensitiveValuesExcluded === true,
    selectedRecipient: manifest.selectedRecipient ?? null,
    status,
    unexpectedData: manifest.unexpectedData === true,
    updatedAt: now,
    verificationMethods: manifest.verificationMethods ?? []
  };
  return [
    ...manifest.createdCapsuleIds.map((objectId): InssaCleanupLedgerRecord => ({
      ...common,
      id: ledgerId(run.id, "time_capsule", objectId),
      objectId,
      objectPath: `timeCapsules/${objectId}`,
      objectType: "time_capsule"
    })),
    ...manifest.createdMediaIds.map((objectId): InssaCleanupLedgerRecord => ({
      ...common,
      id: ledgerId(run.id, "media", objectId),
      objectId,
      objectPath: `media/${objectId}`,
      objectType: "media"
    }))
  ];
}

export async function evaluateCleanupGate(input: {
  environment: Record<string, string | undefined>;
  now?: Date;
  repoRoot?: string;
  requiresSecondaryAccount?: boolean;
  store?: InssaRunStore;
}): Promise<CleanupGateResult> {
  const repoRoot = input.repoRoot ?? getRepoRoot();
  const policy = resolveCleanupPolicy(input.environment, input.requiresSecondaryAccount);
  const now = input.now ?? new Date();
  const usesCurrentStore = Boolean(input.store) || path.resolve(repoRoot) === path.resolve(getRepoRoot());
  const store = input.store ?? (usesCurrentStore ? getInssaRunStore() : null);

  if (!policy.dedicatedQaAccountsConfirmed) {
    return fail("qa-account", "Every account used by this campaign must be explicitly marked as a dedicated QA account.", policy, []);
  }

  if (store) await synchronizeConfiguredCleanupLedger(repoRoot, store);
  const [ledger, runs, manifests] = await Promise.all([
    store ? store.listCleanupLedger() : readConfiguredCleanupLedger(repoRoot),
    store ? store.listRuns() : Promise.resolve([]),
    readCleanupManifests(repoRoot)
  ]);
  const unresolved = ledger.filter((record) => record.status !== "completed");

  for (const manifest of manifests) {
    if (["completed", "manually_confirmed", "not_required"].includes(manifest.status)) continue;
    const ids = [...manifest.createdCapsuleIds, ...manifest.createdMediaIds];
    if (ids.length === 0) {
      return fail(
        "cleanup-identity",
        `Run ${manifest.runId} has unresolved cleanup but no identified staging object.`,
        policy,
        unresolved
      );
    }
    if (manifest.status !== "deferred" && manifest.status !== "cleanup_unavailable") {
      return fail(
        "cleanup-state",
        `Run ${manifest.runId} remains ${manifest.status}; unresolved objects must be truthfully marked deferred or cleanup_unavailable.`,
        policy,
        unresolved
      );
    }
    for (const objectId of ids) {
      if (!ledger.some((record) => record.originatingRunId === manifest.runId && record.objectId === objectId)) {
        return fail(
          "cleanup-ledger",
          `Object ${objectId} from run ${manifest.runId} is not represented in the durable cleanup ledger.`,
          policy,
          unresolved
        );
      }
    }
  }

  for (const record of unresolved) {
    if (!record.objectId || !record.originatingRunId) {
      return fail("cleanup-identity", "An unresolved cleanup record has no object ID or originating run ID.", policy, unresolved);
    }
    if (record.status !== "deferred" && record.status !== "cleanup_unavailable") {
      return fail(
        "cleanup-state",
        `Object ${record.objectPath} remains ${record.status}; deferred execution is not permitted.`,
        policy,
        unresolved
      );
    }
    if (!record.dedicatedQaAccount || !record.ownerAccount || record.affectedUsers.length === 0) {
      return fail("qa-account", `Object ${record.objectPath} is not fully attributed to a dedicated QA account.`, policy, unresolved);
    }
    if (!record.sensitiveValuesExcluded) {
      return fail("cleanup-sanitization", `Object ${record.objectPath} lacks credential/token sanitization evidence.`, policy, unresolved);
    }
    if (!record.safelyAccounted || record.unexpectedData) {
      return fail("cleanup-accounting", `Object ${record.objectPath} is not safely accounted for.`, policy, unresolved);
    }
    if (record.securitySensitive && !record.safelyAccounted) {
      return fail("cleanup-security", `Security-sensitive object ${record.objectPath} is not safely accounted for.`, policy, unresolved);
    }
    const ageMs = now.getTime() - new Date(record.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > policy.maxUnresolvedAgeDays * 86_400_000) {
      return fail(
        "cleanup-age",
        `Object ${record.objectPath} exceeds the ${policy.maxUnresolvedAgeDays}-day unresolved age limit.`,
        policy,
        unresolved
      );
    }
  }

  if (unresolved.length > 0 && !policy.deferredModeEnabled) {
    return fail("deferred-mode", "Deferred cleanup mode is disabled while unresolved staging objects exist.", policy, unresolved);
  }
  if (unresolved.length >= policy.maxUnresolvedObjects) {
    return fail(
      "cleanup-threshold",
      `The unresolved-object limit (${policy.maxUnresolvedObjects}) would be exceeded by another mutation campaign.`,
      policy,
      unresolved
    );
  }
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const mutationRunsToday = runs.filter(
    (run) => run.commandSnapshot?.mutatesStaging && new Date(run.createdAt).getTime() >= dayStart
  ).length;
  if (mutationRunsToday >= policy.maxMutationRunsPerDay) {
    return fail(
      "mutation-rate",
      `The daily mutation-run limit (${policy.maxMutationRunsPerDay}) has been reached.`,
      policy,
      unresolved
    );
  }

  return { ok: true, policy, unresolved };
}

async function readCleanupManifests(repoRoot: string) {
  const outputRoot = path.join(repoRoot, "run-output");
  let entries: string[];
  try {
    entries = await fs.readdir(outputRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const manifests: InssaCleanupManifest[] = [];
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(outputRoot, entry, "cleanup-manifest.json"), "utf8")) as InssaCleanupManifest;
      manifests.push({
        ...parsed,
        affectedUsers: Array.isArray(parsed.affectedUsers) ? parsed.affectedUsers : [],
        createdCapsuleIds: Array.isArray(parsed.createdCapsuleIds) ? parsed.createdCapsuleIds : [],
        createdMediaIds: Array.isArray(parsed.createdMediaIds) ? parsed.createdMediaIds : [],
        runId: typeof parsed.runId === "string" && parsed.runId ? parsed.runId : entry
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Invalid cleanup manifest for run ${entry}.`);
    }
  }
  return manifests;
}

async function readConfiguredCleanupLedger(repoRoot: string) {
  const seedPath = path.join(repoRoot, "dashboard", "config", "cleanup-ledger-seed.json");
  try {
    const parsed = JSON.parse(await fs.readFile(seedPath, "utf8")) as { records?: unknown };
    return Array.isArray(parsed.records)
      ? parsed.records.filter(isCleanupLedgerRecord).map((record) => ({ ...record }))
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function fail(
  id: string,
  error: string,
  policy: InssaCleanupPolicySnapshot,
  unresolved: InssaCleanupLedgerRecord[]
): CleanupGateResult {
  return { error, id, ok: false, policy, unresolved };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function ledgerId(runId: string, objectType: string, objectId: string) {
  return `${runId}:${objectType}:${objectId}`;
}

function toLedgerStatus(status: InssaCleanupManifest["status"]): InssaCleanupLedgerRecord["status"] | null {
  if (status === "not_required") return null;
  if (status === "manually_confirmed") return "completed";
  return status;
}

function isCleanupLedgerRecord(value: unknown): value is InssaCleanupLedgerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<InssaCleanupLedgerRecord>;
  return Boolean(
    record.id &&
      record.originatingRunId &&
      record.objectId &&
      record.objectPath &&
      (record.objectType === "time_capsule" || record.objectType === "media") &&
      record.environment === "staging" &&
      record.product === "INSSA"
  );
}
