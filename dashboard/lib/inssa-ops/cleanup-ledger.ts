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

export type CleanupPolicyIssue = { id: string; detail: string };
type CleanupGateSummary = {
  mode: "manual_cleanup" | "enforced";
  advisories: CleanupPolicyIssue[];
  blockingFailures: CleanupPolicyIssue[];
  mutationRunsToday: number;
  policy: InssaCleanupPolicySnapshot;
  unresolved: InssaCleanupLedgerRecord[];
};
export type CleanupGateResult = CleanupGateSummary & ({ ok: true } | { ok: false; id: string; error: string });

export function resolveCleanupPolicy(
  environment: Record<string, string | undefined>,
  requiresSecondaryAccount = false,
  governedStaging = false
): InssaCleanupPolicySnapshot {
  const primaryDedicated = environment.INSSA_TEST_ACCOUNT_IS_DEDICATED_QA === "1";
  const secondaryDedicated = !requiresSecondaryAccount || environment.INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA === "1";
  return {
    manualModeEnabled: governedStaging && environment.INSSA_MANUAL_CLEANUP_MODE === "1" &&
      /^https:\/\/staging\.inssa\.us\/?$/.test(environment.INSSA_URL ?? ""),
    dedicatedQaAccountsConfirmed: primaryDedicated && secondaryDedicated,
    deferredModeEnabled: environment.INSSA_DEFERRED_CLEANUP_MODE === "1",
    maxMutationRunsPerDay: positiveInteger(environment.INSSA_MAX_MUTATION_RUNS_PER_DAY, DEFAULT_MAX_MUTATION_RUNS_PER_DAY),
    maxUnresolvedAgeDays: positiveInteger(environment.INSSA_MAX_UNRESOLVED_AGE_DAYS, DEFAULT_MAX_UNRESOLVED_AGE_DAYS),
    maxUnresolvedObjects: positiveInteger(environment.INSSA_MAX_UNRESOLVED_OBJECTS, DEFAULT_MAX_UNRESOLVED_OBJECTS),
    retentionDays: positiveInteger(environment.INSSA_UNRESOLVED_RETENTION_DAYS, DEFAULT_RETENTION_DAYS)
  };
}

export async function initializeConfiguredCleanupLedger(
  repoRoot = getRepoRoot(),
  store: InssaRunStore = getInssaRunStore()
) {
  const records = await readConfiguredCleanupLedger(repoRoot);
  await store.initializeCleanupLedger(records);
  return records;
}

/** Fresh read-only view. Configured unresolved objects remain conservatively
 * visible before startup finishes; durable records, including resolutions, win.
 */
export async function readCleanupLedgerSnapshot(
  repoRoot = getRepoRoot(),
  store: InssaRunStore | null = getInssaRunStore()
) {
  const [configured, durable] = await Promise.all([
    readConfiguredCleanupLedger(repoRoot),
    store ? store.listCleanupLedger() : Promise.resolve([])
  ]);
  const identity = (record: InssaCleanupLedgerRecord) => JSON.stringify([record.originatingRunId, record.objectType, record.objectId]);
  const durableIdentities = new Set(durable.map(identity));
  return [...durable, ...configured.filter((record) => !durableIdentities.has(identity(record)))];
}

export async function persistCleanupLedgerForRun(
  run: InssaRunRecord,
  manifest: InssaCleanupManifest,
  store: InssaRunStore = getInssaRunStore()
) {
  const records = buildCleanupLedgerRecords(run, manifest);
  // Append discoveries without erasing earlier IDs or reopening manual resolutions.
  const existing = (await store.listCleanupLedger()).filter((record) => record.originatingRunId === run.id);
  for (const record of records) {
    if (!existing.some((prior) => prior.objectId === record.objectId && prior.objectType === record.objectType)) {
      await store.upsertCleanupLedger(record);
      existing.push(record);
    }
  }
  return existing;
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
  governedStaging?: boolean;
  now?: Date;
  repoRoot?: string;
  requiresSecondaryAccount?: boolean;
  store?: InssaRunStore;
}): Promise<CleanupGateResult> {
  const repoRoot = input.repoRoot ?? getRepoRoot();
  const policy = resolveCleanupPolicy(input.environment, input.requiresSecondaryAccount, input.governedStaging);
  const now = input.now ?? new Date();
  const usesCurrentStore = Boolean(input.store) || path.resolve(repoRoot) === path.resolve(getRepoRoot());
  const store = input.store ?? (usesCurrentStore ? getInssaRunStore() : null);
  const [ledger, runs, localManifests] = await Promise.all([
    readCleanupLedgerSnapshot(repoRoot, store),
    store ? store.listRuns() : Promise.resolve([]),
    readCleanupManifests(repoRoot)
  ]);
  // Durable manifests survive redeploys; retain unknown identities without inventing object IDs.
  const manifests = new Map(localManifests.map((manifest) => [manifest.runId, manifest]));
  for (const run of runs) if (run.commandSnapshot?.mutatesStaging && run.cleanup) manifests.set(run.id, run.cleanup);
  const unresolved = ledger.filter((record) => record.status !== "completed");
  const blockingFailures: CleanupPolicyIssue[] = [], advisories: CleanupPolicyIssue[] = [];
  const issue = (id: string, detail: string, cleanupOnly = true) => {
    (policy.manualModeEnabled && cleanupOnly ? advisories : blockingFailures).push({ id, detail });
  };
  if (!policy.dedicatedQaAccountsConfirmed) issue("qa-account", "Every account used by this campaign must be explicitly marked as a dedicated QA account.", false);
  for (const manifest of manifests.values()) {
    if (["completed", "manually_confirmed", "not_required"].includes(manifest.status)) continue;
    const ids = [...manifest.createdCapsuleIds, ...manifest.createdMediaIds];
    const resolved = ids.length > 0 && ids.every((objectId) => ledger.some((record) =>
      record.originatingRunId === manifest.runId && record.objectId === objectId && record.status === "completed"));
    if (resolved) continue;
    if (!ids.length) issue("cleanup-identity", `MANUAL_CLEANUP_IDENTITY_UNKNOWN: Run ${manifest.runId} has unresolved cleanup but no identified staging object.`);
    if (manifest.status !== "deferred" && manifest.status !== "cleanup_unavailable") issue("cleanup-state", `Run ${manifest.runId} remains ${manifest.status}; manual investigation is required.`);
    for (const objectId of ids) if (!ledger.some((record) => record.originatingRunId === manifest.runId && record.objectId === objectId)) {
      issue("cleanup-ledger", `Object ${objectId} from run ${manifest.runId} is not represented in the durable cleanup ledger.`);
    }
  }
  for (const record of unresolved) {
    if (!record.objectId || !record.originatingRunId) issue("cleanup-identity", "MANUAL_CLEANUP_IDENTITY_UNKNOWN: An unresolved record has no object ID or originating run ID.");
    if (record.status !== "deferred" && record.status !== "cleanup_unavailable") issue("cleanup-state", `Object ${record.objectPath} remains ${record.status}; manual investigation is required.`);
    if (!record.dedicatedQaAccount || !record.ownerAccount || record.affectedUsers.length === 0) issue("qa-account", `Object ${record.objectPath} is not fully attributed to a dedicated QA account.`, false);
    if (!record.sensitiveValuesExcluded) issue("cleanup-sanitization", `Object ${record.objectPath} lacks credential/token sanitization evidence.`, false);
    if (!record.safelyAccounted || record.unexpectedData) issue("cleanup-accounting", `Object ${record.objectPath} is not safely accounted for.`, !record.unexpectedData);
    const ageMs = now.getTime() - new Date(record.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > policy.maxUnresolvedAgeDays * 86_400_000) issue("cleanup-age", `Object ${record.objectPath} exceeds the ${policy.maxUnresolvedAgeDays}-day unresolved age limit.`);
  }
  if (unresolved.length > 0 && !policy.deferredModeEnabled) issue("deferred-mode", "Deferred cleanup mode is disabled while unresolved staging objects exist.");
  if (unresolved.length >= policy.maxUnresolvedObjects) issue("cleanup-threshold", `The unresolved-object limit (${policy.maxUnresolvedObjects}) would be exceeded by another mutation campaign.`);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const mutationRunsToday = runs.filter((run) => run.commandSnapshot?.mutatesStaging && new Date(run.createdAt).getTime() >= dayStart).length;
  if (mutationRunsToday >= policy.maxMutationRunsPerDay) issue("mutation-rate", `The daily mutation-run limit (${policy.maxMutationRunsPerDay}) has been reached.`);
  if (policy.manualModeEnabled) advisories.unshift({ id: "manual-cleanup", detail: `MANUAL CLEANUP MODE: automatic deletion unavailable; ${unresolved.length} unresolved QA object(s); ${mutationRunsToday} mutation run(s) today. Cleanup remains an operator responsibility.` });
  const summary: CleanupGateSummary = { mode: policy.manualModeEnabled ? "manual_cleanup" : "enforced", advisories, blockingFailures, mutationRunsToday, policy, unresolved };
  return blockingFailures.length ? { ...summary, ok: false, id: blockingFailures[0].id, error: blockingFailures[0].detail } : { ...summary, ok: true };
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
