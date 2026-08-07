import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyArtifact, indexArtifactsForRun } from "../lib/inssa-ops/artifact-indexer";
import { ActiveExecutionJobError, getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import {
  InssaEvidenceServingError,
  isPlaywrightReportArtifact,
  logicalArtifactPath,
  resolvePlaywrightEvidenceBundleFile
} from "../lib/inssa-ops/evidence-serving";
import { finalizeRunOutput, prepareRunOutput } from "../lib/inssa-ops/run-output";
import { buildEvidenceMetadataForRun } from "../lib/inssa-ops/evidence";
import type { InssaArtifactRecord, InssaRunRecord } from "../lib/inssa-ops/types";

test("durable jobs are idempotent, exclusive, leased, and recoverable", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-execution-foundation-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;

  try {
    const store = getInssaExecutionJobStore();
    const first = await store.enqueue({ campaignKey: "test_inssa_safe", idempotencyKey: "request-1", runId: "run-1" });
    assert.equal(first.created, true);
    const duplicate = await store.enqueue({ campaignKey: "test_inssa_safe", idempotencyKey: "request-1", runId: "ignored" });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.runId, "run-1");

    await assert.rejects(
      store.enqueue({ campaignKey: "test_inssa_safe", idempotencyKey: "request-2", runId: "run-2" }),
      ActiveExecutionJobError
    );

    const claimed = await store.claimNext({ leaseMs: 50, workerId: "worker-a" });
    assert.equal(claimed?.runId, "run-1");
    assert.equal(claimed?.attempt, 1);
    await store.markRunning(claimed!.id, "worker-a", 50);
    await store.heartbeat(claimed!.id, "worker-a", 50);
    await store.complete(claimed!.id, "worker-a", "completed");

    const second = await store.enqueue({ campaignKey: "test_inssa_safe", idempotencyKey: "request-2", runId: "run-2" });
    const expiring = await store.claimNext({ leaseMs: 1, workerId: "worker-b" });
    assert.equal(expiring?.id, second.job.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await store.recoverAbandoned()).length, 1);
    const reclaimed = await store.claimNext({ leaseMs: 50, workerId: "worker-c" });
    assert.equal(reclaimed?.id, second.job.id);
    assert.equal(reclaimed?.attempt, 2);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("run output produces an immutable manifest and indexable artifact paths", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-run-output-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  const runId = "run-output-test";
  const startedAt = new Date();

  try {
    const outputRoot = await prepareRunOutput(runId);
    await fs.writeFile(path.join(outputRoot, "playwright-report", "index.html"), "<html>report</html>", "utf8");
    const completedAt = new Date();
    const finalized = await finalizeRunOutput({ campaignKey: "test_inssa_safe", completedAt, runId, startedAt });
    assert.equal(finalized.manifest.schemaVersion, 1);
    assert.equal(finalized.manifest.entries.length, 1);
    assert.equal(finalized.manifest.entries[0].artifactType, "Playwright Report");

    const artifacts = await indexArtifactsForRun({
      completedAtMs: completedAt.getTime(),
      outputRoot,
      runId,
      startedAtMs: startedAt.getTime()
    });
    assert.equal(artifacts.some((artifact) => artifact.artifactType === "Playwright Report"), true);
    assert.equal(artifacts.every((artifact) => artifact.filePath.startsWith(`run-output/${runId}/`)), true);
    assert.equal(artifacts.some((artifact) => artifact.filePath.endsWith("evidence-manifest.json")), true);
    const report = artifacts.find((artifact) => artifact.artifactType === "Playwright Report")!;
    assert.equal(isPlaywrightReportArtifact(report), true);
    assert.equal(logicalArtifactPath(report), "playwright-report/index.html");
    assert.equal(
      (await resolvePlaywrightEvidenceBundleFile(report, ["index.html"])).absolutePath,
      await fs.realpath(path.join(outputRoot, "playwright-report", "index.html"))
    );
    await assert.rejects(() => resolvePlaywrightEvidenceBundleFile(report, ["..", "secret"]), InssaEvidenceServingError);
    await assert.rejects(
      () => resolvePlaywrightEvidenceBundleFile({ ...report, filePath: `run-output/${runId}/other/playwright-report/index.html` }),
      InssaEvidenceServingError
    );

    const outside = path.join(repoRoot, "outside.txt");
    await fs.writeFile(outside, "outside", "utf8");
    await fs.symlink(outside, path.join(outputRoot, "playwright-report", "escaped.txt"));
    await assert.rejects(
      () => resolvePlaywrightEvidenceBundleFile(report, ["escaped.txt"]),
      (error: unknown) => error instanceof InssaEvidenceServingError && error.status === 403
    );
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("phase-scoped Playwright reports remain reports without promoting trace viewer HTML", () => {
  assert.equal(classifyArtifact("playwright-report/create/index.html").artifactType, "Playwright Report");
  assert.equal(classifyArtifact("playwright-report/create/trace/index.html").artifactType, "HTML Report");
});

test("evidence metadata preserves the command target environment", () => {
  const now = new Date().toISOString();
  const run: InssaRunRecord = {
    campaignKey: "monitor_inssa_auth_production",
    commandSnapshot: {
      commandType: "campaign",
      displayName: "Authentication Monitoring - Production",
      key: "monitor_inssa_auth_production",
      mutatesStaging: false,
      npmScript: "test:inssa:monitor:auth:production",
      operatorDescription: "Test production authentication.",
      phase1Enabled: true,
      producesFindings: true,
      producesReports: true,
      riskLevel: "read_only",
      targetEnvironment: "production",
      timeoutMs: 120_000
    },
    completedAt: now,
    createdAt: now,
    durationMs: 1,
    exitCode: 1,
    id: "auth-monitor-production-run",
    requestedBy: "operator@example.invalid",
    startedAt: now,
    status: "failed",
    updatedAt: now
  };
  const artifact: InssaArtifactRecord = {
    artifactType: "Playwright Report",
    contentType: "text/html; charset=utf-8",
    createdAt: now,
    filePath: `run-output/${run.id}/playwright-report/index.html`,
    fileSize: 1,
    id: "auth-monitor-production-report",
    renderInline: true,
    runId: run.id,
    sensitive: false,
    sha256: "0".repeat(64)
  };

  const metadata = buildEvidenceMetadataForRun(run, [artifact]);
  assert.equal(metadata.bundle?.environment, "production");
});
