import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  recordEvidenceUploadFailureNotification,
  recordExecutionFailureNotification,
  recordJobRecoveryNotifications,
  recordRunOutcomeNotification,
  recordRunQueuedNotification,
  recordRunStartedNotification,
  recordWorkerRestartedNotification
} from "../lib/inssa-ops/notification-events";
import { getNotificationOutboxStore } from "../lib/inssa-ops/notification-outbox";
import type { InssaRunRecord } from "../lib/inssa-ops/types";

test("notification outbox persists, filters, paginates, and deduplicates events", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-notification-outbox-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;

  try {
    const passedRun = buildRun("11111111-1111-4111-8111-111111111111", "test_inssa_safe");
    const failedRun = buildRun("22222222-2222-4222-8222-222222222222", "test_inssa_campaign_security");

    await recordRunQueuedNotification(passedRun);
    await recordRunQueuedNotification(passedRun);
    await recordRunOutcomeNotification(passedRun, "passed", 1_500, 0);
    await recordRunOutcomeNotification(failedRun, "failed", 2_500, 1);
    await recordWorkerRestartedNotification("test-worker");
    await recordWorkerRestartedNotification("test-worker");

    const store = getNotificationOutboxStore();
    const all = await store.list({}, 0, 100);
    assert.equal(all.pagination.total, 4);
    assert.equal(all.items.filter((item) => item.eventType === "run_queued").length, 1);
    assert.equal(all.items.filter((item) => item.eventType === "worker_restarted").length, 1);

    const high = await store.list({ severity: "high" }, 0, 100);
    assert.equal(high.pagination.total, 1);
    assert.equal(high.items[0].eventType, "run_failed");
    assert.equal(high.items[0].status, "pending");
    assert.equal(high.items[0].attemptCount, 0);

    const firstPage = await store.list({}, 0, 2);
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.pagination.hasMore, true);
    assert.equal(firstPage.pagination.nextCursor, "2");
    assert.deepEqual(await store.get(firstPage.items[0].id), firstPage.items[0]);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("execution, recovery, and evidence failures produce durable pending events", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-notification-events-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;

  try {
    const run = buildRun("33333333-3333-4333-8333-333333333333", "test_inssa_safe");
    const job = {
      attempt: 1,
      campaignKey: run.campaignKey,
      claimedAt: new Date().toISOString(),
      claimedBy: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      id: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "notification-recovery",
      lastError: "Worker lease expired before completion.",
      leaseExpiresAt: null,
      lifecycleArtifact: null,
      maxAttempts: 2,
      runId: run.id,
      schemaVersion: 1 as const,
      status: "queued" as const,
      updatedAt: new Date().toISOString()
    };

    await recordRunStartedNotification(run, 1, "worker-test");
    await recordExecutionFailureNotification(run, "synthetic worker failure");
    await recordEvidenceUploadFailureNotification(run, "bundle-test", "synthetic storage failure");
    await recordJobRecoveryNotifications(job);
    await recordJobRecoveryNotifications(job);

    const page = await getNotificationOutboxStore().list({}, 0, 100);
    assert.deepEqual(
      new Set(page.items.map((item) => item.eventType)),
      new Set(["run_started", "execution_failed", "evidence_upload_failed", "worker_lease_expired", "job_recovery"])
    );
    assert.equal(page.items.length, 5);
    assert.equal(page.items.every((item) => item.status === "pending"), true);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("run notifications preserve the command target environment", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-notification-environment-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;

  try {
    const run = buildRun("55555555-5555-4555-8555-555555555555", "monitor_inssa_auth_production");
    run.commandSnapshot.targetEnvironment = "production";

    await recordRunOutcomeNotification(run, "failed", 2_500, 1);

    const page = await getNotificationOutboxStore().list({ runId: run.id }, 0, 10);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].environment, "production");
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

function buildRun(id: string, campaignKey: string): InssaRunRecord {
  const now = new Date().toISOString();
  return {
    campaignKey,
    commandSnapshot: {
      commandType: "campaign",
      displayName: campaignKey,
      key: campaignKey,
      mutatesStaging: false,
      npmScript: campaignKey.replaceAll("_", ":"),
      operatorDescription: "Test command",
      phase1Enabled: true,
      producesFindings: false,
      producesReports: true,
      riskLevel: "safe",
      timeoutMs: 60_000
    },
    completedAt: null,
    createdAt: now,
    durationMs: null,
    exitCode: null,
    id,
    requestedBy: "operator@example.invalid",
    startedAt: null,
    status: "queued",
    updatedAt: now
  };
}
