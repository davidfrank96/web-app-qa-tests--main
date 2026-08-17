import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getInssaPhase1Command } from "../lib/inssa-ops/command-registry";
import {
  correlateMutationCampaign,
  evaluateMutationCampaignReadiness
} from "../lib/inssa-ops/mutation-readiness";
import type { InssaRunStore } from "../lib/inssa-ops/run-store";
import type { InssaCleanupLedgerRecord, InssaRunRecord } from "../lib/inssa-ops/types";

const admin = { email: "admin@example.test", id: "admin-id", role: "admin" as const };

test("dashboard readiness uses server preflight and permits safely accounted deferred cleanup", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-readiness-deferred-"));
  const record = cleanupRecord();
  await writeSeed(repoRoot, [record]);
  await writeManifest(repoRoot, record);
  const store = memoryStore([], []);
  const result = await evaluateMutationCampaignReadiness(requiredCommand("test_inssa_campaign_text"), admin, {
    activeRunId: null,
    environment: baseEnvironment(),
    now: new Date("2026-08-17T12:00:00.000Z"),
    repoRoot,
    store,
    workerHealthy: true
  });

  assert.equal(result.executionAllowed, true);
  assert.equal(result.status, "READY_WITH_DEFERRED_CLEANUP");
  assert.equal(result.lastResult, "historical_run_recorded");
  assert.equal(result.latestRunId, record.originatingRunId);
  assert.equal(result.safelyAccounted, true);
  assert.equal(result.unresolvedCount, 1);
});

test("historical cleanup evidence links to its originating run without inventing a run result", () => {
  const record = cleanupRecord();
  const correlation = correlateMutationCampaign(record.campaignKey, [], [record]);
  assert.equal(correlation.hasHistoricalExecution, true);
  assert.equal(correlation.latestRun, null);
  assert.equal(correlation.latestLedgerRecord?.originatingRunId, record.originatingRunId);
  assert.equal(correlation.records.length, 1);
});

test("a campaign with no run and no cleanup object is not falsely cleanup-blocked", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-readiness-new-"));
  const result = await evaluateMutationCampaignReadiness(requiredCommand("test_inssa_campaign_reveal_later"), admin, {
    activeRunId: null,
    environment: { ...baseEnvironment(), INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS: "1" },
    now: new Date("2026-08-17T12:00:00.000Z"),
    repoRoot,
    store: memoryStore([], []),
    workerHealthy: true
  });

  assert.equal(result.executionAllowed, true);
  assert.equal(result.status, "NOT_YET_VALIDATED");
  assert.equal(result.lastResult, "not_yet_validated");
  assert.equal(result.cleanupStatus, "not_recorded");
  assert.equal(result.blockingReason, null);
});

test("unidentified cleanup objects fail closed", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-readiness-unknown-"));
  const directory = path.join(repoRoot, "run-output", "unknown-run");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "cleanup-manifest.json"), JSON.stringify({
    affectedUsers: ["q***@example.test"],
    createdCapsuleIds: [],
    createdMediaIds: [],
    runId: "unknown-run",
    status: "cleanup_unavailable"
  }));
  const result = await readiness(repoRoot, memoryStore([], []));
  assert.equal(result.executionAllowed, false);
  assert.equal(result.status, "BLOCKED_CLEANUP_IDENTITY");
  assert.match(result.blockingReason ?? "", /no identified staging object/i);
});

test("unsanitized and non-QA cleanup records fail closed", async () => {
  for (const [name, patch, expected] of [
    ["unsanitized", { sensitiveValuesExcluded: false }, "BLOCKED_CLEANUP_POLICY"],
    ["non-qa", { dedicatedQaAccount: false }, "BLOCKED_ACCOUNT"]
  ] as const) {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), `inssa-readiness-${name}-`));
    const record = { ...cleanupRecord(), ...patch };
    await writeSeed(repoRoot, [record]);
    await writeManifest(repoRoot, record);
    const result = await readiness(repoRoot, memoryStore([], []));
    assert.equal(result.executionAllowed, false, name);
    assert.equal(result.status, expected, name);
  }
});

test("age, object-count, and disabled-deferred-mode limits fail closed", async () => {
  const cases: Array<{
    environment: Record<string, string>;
    name: string;
    records: InssaCleanupLedgerRecord[];
  }> = [
    {
      environment: { INSSA_MAX_UNRESOLVED_AGE_DAYS: "1" },
      name: "age",
      records: [{ ...cleanupRecord(), createdAt: "2026-08-01T00:00:00.000Z" }]
    },
    {
      environment: { INSSA_MAX_UNRESOLVED_OBJECTS: "10" },
      name: "count",
      records: Array.from({ length: 10 }, (_, index) => ({
        ...cleanupRecord(),
        id: `historical-run-${index}:time_capsule:capsule-${index}`,
        objectId: `capsule-${index}`,
        objectPath: `timeCapsules/capsule-${index}`,
        originatingRunId: `historical-run-${index}`
      }))
    },
    {
      environment: { INSSA_DEFERRED_CLEANUP_MODE: "0" },
      name: "deferred-mode",
      records: [cleanupRecord()]
    }
  ];
  for (const testCase of cases) {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), `inssa-readiness-${testCase.name}-`));
    await writeSeed(repoRoot, testCase.records);
    const result = await readiness(repoRoot, memoryStore([], []), testCase.environment);
    assert.equal(result.executionAllowed, false, testCase.name);
    assert.equal(result.status, "BLOCKED_CLEANUP_POLICY", testCase.name);
  }
});

function memoryStore(initialRuns: InssaRunRecord[], initialLedger: InssaCleanupLedgerRecord[]) {
  const runs = [...initialRuns];
  const ledger = [...initialLedger];
  return {
    listCleanupLedger: async () => [...ledger],
    listRuns: async () => [...runs],
    upsertCleanupLedger: async (record: InssaCleanupLedgerRecord) => {
      const index = ledger.findIndex((entry) => entry.id === record.id);
      if (index >= 0) ledger[index] = record;
      else ledger.push(record);
      return record;
    }
  } as unknown as InssaRunStore;
}

async function readiness(
  repoRoot: string,
  store: InssaRunStore,
  environment: Record<string, string> = {}
) {
  return evaluateMutationCampaignReadiness(requiredCommand("test_inssa_campaign_text"), admin, {
    activeRunId: null,
    environment: { ...baseEnvironment(), ...environment },
    now: new Date("2026-08-17T12:00:00.000Z"),
    repoRoot,
    store,
    workerHealthy: true
  });
}

async function writeSeed(repoRoot: string, records: InssaCleanupLedgerRecord[]) {
  const directory = path.join(repoRoot, "dashboard", "config");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "cleanup-ledger-seed.json"), JSON.stringify({ records, schemaVersion: 1 }));
}

async function writeManifest(repoRoot: string, record: InssaCleanupLedgerRecord) {
  const directory = path.join(repoRoot, "run-output", record.originatingRunId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "cleanup-manifest.json"), JSON.stringify({
    affectedUsers: record.affectedUsers,
    createdCapsuleIds: [record.objectId],
    createdMediaIds: [],
    runId: record.originatingRunId,
    status: record.status
  }));
}

function cleanupRecord(): InssaCleanupLedgerRecord {
  return {
    affectedUsers: ["q***@example.test"],
    campaignKey: "test_inssa_campaign_text",
    createdAt: "2026-08-10T12:00:00.000Z",
    dedicatedQaAccount: true,
    deferredAt: "2026-08-10T12:00:00.000Z",
    environment: "staging",
    evidencePaths: ["run-output/historical-run/cleanup-manifest.json"],
    id: "historical-run:time_capsule:capsule-123",
    mediaType: null,
    notes: "Safely tracked staging QA object.",
    objectId: "capsule-123",
    objectPath: "timeCapsules/capsule-123",
    objectType: "time_capsule",
    originatingRunId: "historical-run",
    ownerAccount: "q***@example.test",
    product: "INSSA",
    reasonCode: "INSSA-CLEANUP-UNAVAILABLE",
    resultingState: "created",
    resolvedAt: null,
    retentionUntil: "2026-11-08T12:00:00.000Z",
    safelyAccounted: true,
    schemaVersion: 1,
    securitySensitive: false,
    selectedRecipient: null,
    sensitiveValuesExcluded: true,
    status: "cleanup_unavailable",
    unexpectedData: false,
    updatedAt: "2026-08-10T12:00:00.000Z",
    verificationMethods: ["Run-owned evidence"]
  };
}

function requiredCommand(key: string) {
  const command = getInssaPhase1Command(key);
  assert.ok(command);
  return command;
}

function baseEnvironment() {
  return {
    INSSA_DEFERRED_CLEANUP_MODE: "1",
    INSSA_ENABLE_LIVE_CAPSULE_TESTS: "1",
    INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED: "1",
    INSSA_MAX_MUTATION_RUNS_PER_DAY: "10",
    INSSA_MAX_UNRESOLVED_AGE_DAYS: "90",
    INSSA_MAX_UNRESOLVED_OBJECTS: "10",
    INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA: "1",
    INSSA_SECONDARY_TEST_EMAIL: "secondary@example.test",
    INSSA_TEST_ACCOUNT_IS_DEDICATED_QA: "1",
    INSSA_TEST_EMAIL: "primary@example.test",
    INSSA_TEST_PASSWORD: "secret",
    INSSA_URL: "https://staging.inssa.us"
  };
}
