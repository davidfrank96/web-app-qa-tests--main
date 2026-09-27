import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateCleanupGate, persistCleanupLedgerForRun, resolveCleanupPolicy } from "../lib/inssa-ops/cleanup-ledger";
import { writeCleanupManifest } from "../lib/inssa-ops/cleanup-manifest";
import { getInssaPhase1Command } from "../lib/inssa-ops/command-registry";
import { evaluateMutationCampaignReadiness } from "../lib/inssa-ops/mutation-readiness";
import { validateLiveCampaignPreflight, LIVE_MUTATION_ACKNOWLEDGEMENTS, IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT } from "../lib/inssa-ops/live-campaigns";
import { confirmManualCleanupRecord, MANUAL_CLEANUP_CONFIRMATION } from "../lib/inssa-ops/manual-cleanup";
import { determineExecutionFinalStatus } from "../lib/inssa-ops/runner";
import type { InssaRunStore } from "../lib/inssa-ops/run-store";
import type { InssaCleanupLedgerRecord, InssaRunRecord } from "../lib/inssa-ops/types";
const admin = { email: "admin@example.test", id: "admin-id", role: "admin" as const };
const keys = ["text", "media", "video", "reveal_later", "cross_user", "reveal_later_security"].map((name) => `test_inssa_campaign_${name}`);
const command = (key = keys[0]) => getInssaPhase1Command(key)!;
const env = { INSSA_URL: "https://staging.inssa.us", INSSA_MANUAL_CLEANUP_MODE: "1", INSSA_TEST_ACCOUNT_IS_DEDICATED_QA: "1", INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA: "1", INSSA_ENABLE_LIVE_CAPSULE_TESTS: "1", INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED: "1", INSSA_ENABLE_MEDIA_CAPSULE_TESTS: "1", INSSA_ENABLE_VIDEO_CAPSULE_TESTS: "1", INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS: "1", INSSA_TEST_EMAIL: "qa@example.test", INSSA_TEST_PASSWORD: "fixture-password", INSSA_SECONDARY_TEST_EMAIL: "other@example.test", INSSA_SECONDARY_TEST_PASSWORD: "fixture-other-password", INSSA_US_MARKET_LOCATION: "nyc" };
const approval = { acknowledgements: [...LIVE_MUTATION_ACKNOWLEDGEMENTS, IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT], confirmationPhrase: "RUN STAGING MUTATION" };
const now = new Date("2026-09-27T12:00:00Z");
function ledger(index = 0): InssaCleanupLedgerRecord {
  return { affectedUsers: ["qa@example.test"], campaignKey: keys[index % 6], createdAt: "2025-01-01T00:00:00Z", dedicatedQaAccount: true, deferredAt: "2025-01-01T00:00:00Z", environment: "staging", evidencePaths: ["immutable/report.json"], id: `record-${index}`, objectId: `capsule-${index}`, objectPath: `timeCapsules/capsule-${index}`, objectType: "time_capsule", originatingRunId: `run-${index}`, ownerAccount: "qa@example.test", product: "INSSA", reasonCode: "INSSA-CLEANUP-UNAVAILABLE", retentionUntil: "2025-04-01T00:00:00Z", safelyAccounted: true, schemaVersion: 1, securitySensitive: false, sensitiveValuesExcluded: true, status: index % 2 ? "deferred" : "cleanup_unavailable", unexpectedData: false, updatedAt: "2025-01-01T00:00:00Z", mediaType: null, notes: "Remove manually", resolvedAt: null, resultingState: "created", selectedRecipient: "other@example.test", verificationMethods: ["evidence"] };
}
function storeFor(records: InssaCleanupLedgerRecord[], runs: InssaRunRecord[] = []) {
  const events: unknown[] = [];
  const store = { listRuns: async () => runs, getRun: async (id: string) => runs.find((r) => r.id === id) ?? null,
    listCleanupLedger: async () => structuredClone(records), getCleanupLedgerRecord: async (id: string) => structuredClone(records.find((r) => r.id === id) ?? null),
    upsertCleanupLedger: async (record: InssaCleanupLedgerRecord) => { const i = records.findIndex((r) => r.id === record.id); if (i < 0) records.push(record); else records[i] = record; return record; },
    appendAuditEvent: async (event: unknown) => { events.push(event); return event; },
    replaceRunCleanupLedger: async () => { throw new Error("Ledger deletion is forbidden"); }
  } as unknown as InssaRunStore;
  return { store, events };
}
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "manual-cleanup-test-")); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "tests/fixtures/media"), { recursive: true });
  await fs.writeFile(path.join(root, "tests/fixtures/media/sample-video.mp4"), "isolated fixture"); return root;
}

test("all six governed campaigns allow 120 old unresolved objects and daily usage; mode off restores enforcement", async (t) => {
  const repoRoot = await fixture(t), records = Array.from({ length: 120 }, (_, i) => ledger(i));
  const before = JSON.stringify(records), runs = Array.from({ length: 12 }, (_, i) => ({ id: `daily-${i}`, createdAt: now.toISOString(), commandSnapshot: command() } as InssaRunRecord));
  const { store } = storeFor(records, runs);
  for (const key of keys) {
    const result = await validateLiveCampaignPreflight(command(key), { ...approval, ...(command(key).supportsExecutionModes ? { executionMode: "create" } : {}) }, admin, { repoRoot, store, now, environment: env, activeRunId: null, workerHealthy: true });
    assert.equal(result.ok, true, key);
    for (const id of ["cleanup-age", "cleanup-threshold", "mutation-rate", "deferred-mode"]) assert.ok(result.checks.some((c) => c.id === id && c.advisory && c.passed), id);
    const readiness = await evaluateMutationCampaignReadiness(command(key), admin, { repoRoot, store, now, environment: env, activeRunId: null, workerHealthy: true });
    assert.equal(readiness.status, "READY_WITH_MANUAL_CLEANUP"); assert.equal(readiness.unresolvedCount, 120);
  }
  assert.equal(JSON.stringify(records), before, "No historical statuses, metadata or IDs changed");
  const normal = await evaluateCleanupGate({ repoRoot, store, now, environment: { ...env, INSSA_MANUAL_CLEANUP_MODE: "0" }, governedStaging: true });
  assert.equal(normal.ok, false); assert.ok(normal.blockingFailures.some((f) => f.id === "cleanup-threshold"));
});

test("manual policy is restricted to governed staging; execution protections still block", async (t) => {
  const repoRoot = await fixture(t), { store } = storeFor([ledger()]);
  assert.equal(resolveCleanupPolicy(env).manualModeEnabled, false);
  assert.equal(resolveCleanupPolicy({ ...env, INSSA_URL: "https://inssa.us" }, false, true).manualModeEnabled, false);
  const cases = [
    { environment: { ...env, INSSA_URL: "https://inssa.us" }, expected: "staging-target" },
    { environment: { ...env, INSSA_URL: "https://staging.inssa.us:444" }, expected: "staging-target" },
    { environment: { ...env, INSSA_URL: "https://staging.inssa.us/?x=1" }, expected: "staging-target" },
    { environment: { ...env, INSSA_URL: "https://other.example.test" }, expected: "staging-target" },
    { environment: { ...env, INSSA_TEST_PASSWORD: "" }, expected: "prerequisites" },
    { environment: { ...env, INSSA_ENABLE_LIVE_CAPSULE_TESTS: "0" }, expected: "prerequisites" },
    { environment: { ...env, INSSA_TEST_ACCOUNT_IS_DEDICATED_QA: "0" }, expected: "qa-account" },
    { workerHealthy: false, expected: "worker-health" }, { activeRunId: "another-test", expected: "active-run" },
    { user: { ...admin, role: "operator" as const }, expected: "admin-role" },
    { approval: null, expected: "approval" }, { approval: { ...approval, confirmationPhrase: "wrong" }, expected: "approval" },
    { key: keys[1], environment: { ...env, INSSA_TEST_MEDIA_FIXTURE_PATH: "missing.png" }, expected: "media-fixture" },
    { key: keys[4], environment: { ...env, INSSA_SECONDARY_TEST_EMAIL: env.INSSA_TEST_EMAIL }, expected: "account-separation" },
    { key: keys[3], approval: { ...approval, executionMode: "resume", resumeArtifactPath: "missing.json" }, expected: "resume-artifact" }
  ];
  for (const c of cases) {
    const result = await validateLiveCampaignPreflight(command(c.key), 'approval' in c ? c.approval : approval, c.user ?? admin,
      { repoRoot, store, now, environment: c.environment ?? env, workerHealthy: c.workerHealthy ?? true, activeRunId: c.activeRunId ?? null });
    assert.equal(result.ok, false, c.expected); assert.equal(result.checks.find((x) => !x.passed)?.id, c.expected);
  }
  const unregistered = await validateLiveCampaignPreflight({ ...command(), key: "unregistered" }, approval, admin, { repoRoot, environment: env, activeRunId: null, workerHealthy: true });
  assert.equal(unregistered.ok, false);
});

test("durable unknown identities remain prominent advisories across restarts, without pretending accounting succeeded", async (t) => {
  const repoRoot = await fixture(t);
  const run = { id: "unknown-run", commandSnapshot: command(), cleanup: { runId: "unknown-run", status: "pending", createdCapsuleIds: [], createdMediaIds: [] } } as unknown as InssaRunRecord;
  const { store } = storeFor([], [run]);
  const result = await evaluateCleanupGate({ repoRoot, store, now, environment: env, governedStaging: true });
  assert.equal(result.ok, true); assert.match(result.advisories.find((x) => x.id === "cleanup-identity")!.detail, /MANUAL_CLEANUP_IDENTITY_UNKNOWN/);
  assert.equal(run.cleanup!.status, "pending");
});

test("manual confirmations require exact object/run, admin and deletion attestation, preserve evidence, and audit actor/time/note", async () => {
  const records = [ledger(), ledger(1)]; const { store, events } = storeFor(records);
  const input = { recordId: records[0].id, objectId: records[0].objectId, runId: records[0].originatingRunId, confirmationPhrase: MANUAL_CLEANUP_CONFIRMATION, note: "Deleted in product UI" };
  await assert.rejects(confirmManualCleanupRecord(store, { ...admin, role: "viewer" }, input));
  await assert.rejects(confirmManualCleanupRecord(store, admin, { ...input, confirmationPhrase: "yes" }));
  await assert.rejects(confirmManualCleanupRecord(store, admin, { ...input, objectId: "wrong" }));
  await assert.rejects(confirmManualCleanupRecord(store, admin, { ...input, runId: "wrong" }));
  assert.equal(events.length, 0); assert.equal(records[0].status, "cleanup_unavailable");
  const resolved = await confirmManualCleanupRecord(store, admin, input);
  assert.equal(resolved.status, "completed"); assert.equal(records.length, 2); assert.equal(records[1].status, "deferred");
  assert.deepEqual(resolved.evidencePaths, ["immutable/report.json"]); assert.equal(resolved.createdAt, "2025-01-01T00:00:00Z");
  assert.match(resolved.notes!, /admin@example.test/); assert.ok(resolved.resolvedAt);
  const event = events[0] as { metadata: Record<string, string> };
  for (const key of ["objectId", "originatingRunId", "confirmedBy", "confirmedAt", "note"]) assert.ok(event.metadata[key]);
  await confirmManualCleanupRecord(store, admin, input); assert.equal(events.length, 1, "idempotent confirmation");
});

test("manifest and ledger truth survive re-publication; functional failure never becomes a pass", async (t) => {
  const repoRoot = await fixture(t), policy = resolveCleanupPolicy(env, false, true);
  const run = { id: "run-0", campaignKey: keys[0], commandSnapshot: command(), executionContext: { cleanupPolicy: policy, targetHost: "staging.inssa.us" } } as InssaRunRecord;
  await fs.mkdir(path.join(repoRoot, "lifecycle-artifacts"));
  await fs.writeFile(path.join(repoRoot, "lifecycle-artifacts/created.json"), JSON.stringify({ capsuleId: "capsule-0", primaryUser: "qa@example.test" }));
  const manifest = (await writeCleanupManifest(run, repoRoot))!;
  assert.equal(manifest.status, "cleanup_unavailable"); assert.equal(manifest.safelyAccounted, true);
  const records = [ledger()]; const { store } = storeFor(records);
  const original = JSON.stringify(records);
  await persistCleanupLedgerForRun(run, manifest, store); assert.equal(JSON.stringify(records), original);
  await persistCleanupLedgerForRun(run, { ...manifest, createdCapsuleIds: [] }, store); assert.equal(JSON.stringify(records), original);
  await fs.unlink(path.join(repoRoot, "lifecycle-artifacts/created.json"));
  const unknown = (await writeCleanupManifest(run, repoRoot))!;
  assert.equal(unknown.reasonCode, "MANUAL_CLEANUP_IDENTITY_UNKNOWN"); assert.equal(unknown.safelyAccounted, false);
  const status = { exitCode: 0, exitSignal: null, leaseLost: false, startupError: false, terminationFailure: false, timedOut: false, warningSeen: true };
  assert.equal(determineExecutionFinalStatus(status), "passed_with_warnings");
  assert.equal(determineExecutionFinalStatus({ ...status, exitCode: 1 }), "failed");
});

test("unwritable output and active/audit-failed confirmations still block", async (t) => {
  const repoRoot = await fixture(t), { store } = storeFor([]);
  const previous = process.env.INSSA_QA_REPO_ROOT;
  const file = path.join(repoRoot, 'not-a-directory'); await fs.writeFile(file, 'fixture');
  process.env.INSSA_QA_REPO_ROOT = file;
  try {
    const result = await validateLiveCampaignPreflight(command(), approval, admin, { repoRoot, store, now, environment: env, activeRunId: null, workerHealthy: true });
    assert.equal(result.ok, false); assert.equal(result.checks.find(c => !c.passed)?.id, 'output-storage');
  } finally { if (previous === undefined) delete process.env.INSSA_QA_REPO_ROOT; else process.env.INSSA_QA_REPO_ROOT = previous; }
  const records = [ledger()]; const active = storeFor(records, [{ id: 'run-0', status: 'running' } as InssaRunRecord]);
  const input = { recordId: records[0].id, objectId: records[0].objectId, runId: records[0].originatingRunId, confirmationPhrase: MANUAL_CLEANUP_CONFIRMATION };
  await assert.rejects(confirmManualCleanupRecord(active.store, admin, input), /active/);
  const unavailable = storeFor(records); unavailable.store.appendAuditEvent = async () => { throw new Error('audit unavailable'); };
  await assert.rejects(confirmManualCleanupRecord(unavailable.store, admin, input), /audit unavailable/);
  assert.equal(records[0].status, 'cleanup_unavailable');
});
