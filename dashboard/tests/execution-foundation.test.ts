import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { classifyArtifact, indexArtifactsForRun } from "../lib/inssa-ops/artifact-indexer";
import {
  ActiveExecutionJobError,
  ExecutionLeaseOwnershipError,
  getInssaExecutionJobStore
} from "../lib/inssa-ops/execution-job-store";
import { startExecutionLeaseHeartbeat } from "../lib/inssa-ops/execution-lease";
import { reconcileTerminalExecutionJobRun } from "../lib/inssa-ops/execution-recovery";
import {
  findUploadedEvidenceItem,
  InssaEvidenceServingError,
  isPlaywrightReportArtifact,
  logicalArtifactPath,
  resolvePlaywrightEvidenceBundleFile,
  resolvePlaywrightEvidenceBundlePath
} from "../lib/inssa-ops/evidence-serving";
import { verifyEvidenceItemBytes } from "../lib/inssa-ops/evidence-storage";
import { finalizeRunOutput, prepareRunOutput } from "../lib/inssa-ops/run-output";
import { buildEvidenceMetadataForRun } from "../lib/inssa-ops/evidence";
import { isOwnedProcessTreeAlive, ownedProcessGroupId, terminateOwnedProcessTree } from "../lib/inssa-ops/process-tree";
import type { InssaRunStore } from "../lib/inssa-ops/run-store";
import type { InssaArtifactRecord, InssaExecutionJobRecord, InssaRunRecord } from "../lib/inssa-ops/types";

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
    await store.complete(reclaimed!.id, "worker-c", "completed");

    const third = await store.enqueue({ campaignKey: "test_inssa_safe", idempotencyKey: "request-3", runId: "run-3" });
    const running = await store.claimNext({ leaseMs: 1, workerId: "worker-d" });
    await store.markRunning(running!.id, "worker-d", 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const blocked = await store.recoverAbandoned();
    assert.equal(blocked[0].id, third.job.id);
    assert.equal(blocked[0].status, "abandoned");
    assert.match(blocked[0].lastError ?? "", /recovery blocked/i);
    assert.equal(await store.claimNext({ leaseMs: 50, workerId: "worker-e" }), null);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("heartbeat renews a lease for the full duration of a long-running child", async () => {
  let heartbeatCount = 0;
  let leaseExpiresAt = 0;
  const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 3500)"], {
    detached: process.platform !== "win32",
    stdio: "ignore"
  });
  const heartbeat = startExecutionLeaseHeartbeat({
    failureLimit: 2,
    heartbeat: async () => {
      heartbeatCount += 1;
      leaseExpiresAt = Date.now() + 3_000;
    },
    heartbeatMs: 1_000,
    leaseMs: 3_000,
    onFailure: () => {},
    ownershipError: () => false
  });

  try {
    await waitForClose(child);
    assert.ok(heartbeatCount >= 3);
    assert.ok(leaseExpiresAt > Date.now());
  } finally {
    await heartbeat.stop();
  }
});

test("owned process-tree termination honors SIGTERM and never kills an unrelated process", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX process groups are validated on Linux/macOS.");
  const owned = spawnProcessTree(false);
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await waitForOutput(owned);
    const result = await terminateOwnedProcessTree(owned, ownedProcessGroupId(owned), { graceMs: 1_000 });
    assert.equal(result.sigtermSent, true);
    assert.equal(result.sigkillSent, false);
    assert.equal(isOwnedProcessTreeAlive(owned, result.processGroupId), false);
    assert.equal(processExists(unrelated.pid), true);
  } finally {
    safelyKill(unrelated);
    safelyKill(owned);
  }
});

test("owned process-tree termination uses SIGKILL when descendants ignore SIGTERM", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX process groups are validated on Linux/macOS.");
  const owned = spawnProcessTree(true);
  try {
    await waitForOutput(owned);
    const result = await terminateOwnedProcessTree(owned, ownedProcessGroupId(owned), { graceMs: 100 });
    assert.equal(result.sigtermSent, true);
    assert.equal(result.sigkillSent, true);
    assert.equal(isOwnedProcessTreeAlive(owned, result.processGroupId), false);
  } finally {
    safelyKill(owned);
  }
});

test("lease ownership loss is fatal immediately and terminates the controlled process tree", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX process groups are validated on Linux/macOS.");
  const owned = spawnProcessTree(true);
  const processGroupId = ownedProcessGroupId(owned);
  let fatalFailure = false;
  let termination: Promise<unknown> | null = null;
  await waitForOutput(owned);
  const heartbeat = startExecutionLeaseHeartbeat({
    failureLimit: 2,
    heartbeat: async () => { throw new ExecutionLeaseOwnershipError("job", "worker"); },
    heartbeatMs: 1_000,
    leaseMs: 3_000,
    onFailure: (_error, _failures, fatal) => {
      fatalFailure = fatal;
      if (fatal) termination = terminateOwnedProcessTree(owned, processGroupId, { graceMs: 100 });
    },
    ownershipError: (error) => error instanceof ExecutionLeaseOwnershipError
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    if (termination) await termination;
    assert.equal(fatalFailure, true);
    assert.equal(isOwnedProcessTreeAlive(owned, processGroupId), false);
  } finally {
    await heartbeat.stop();
    if (isOwnedProcessTreeAlive(owned, processGroupId)) {
      await terminateOwnedProcessTree(owned, processGroupId, { graceMs: 100 });
    }
  }
});

test("abandoned execution jobs reconcile nonterminal runs exactly once", async () => {
  const run = { ...runRecord("abandoned-run"), completedAt: null, durationMs: null, exitCode: null, status: "running" as const };
  const logs: string[] = [];
  const audits: unknown[] = [];
  const outcomes: unknown[] = [];
  const store = {
    appendLog: async (_runId: string, _stream: string, message: string) => {
      logs.push(message);
      return {};
    },
    getRun: async () => run,
    updateRun: async (_runId: string, patch: Partial<InssaRunRecord>) => Object.assign(run, patch)
  } as unknown as InssaRunStore;
  const job: InssaExecutionJobRecord = {
    attempt: 2,
    campaignKey: run.campaignKey,
    claimedAt: run.createdAt,
    claimedBy: null,
    completedAt: new Date().toISOString(),
    createdAt: run.createdAt,
    heartbeatAt: run.createdAt,
    id: "abandoned-job",
    idempotencyKey: "abandoned-job-request",
    lastError: "Execution recovery blocked.",
    leaseExpiresAt: null,
    lifecycleArtifact: null,
    maxAttempts: 2,
    runId: run.id,
    schemaVersion: 1,
    status: "abandoned",
    updatedAt: new Date().toISOString()
  };

  assert.equal(await reconcileTerminalExecutionJobRun(job, {
    recordAudit: async (event) => { audits.push(event); return event as never; },
    recordOutcome: async (...args) => { outcomes.push(args); return null; },
    store
  }), true);
  assert.equal(run.status, "failed");
  assert.equal(logs.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(outcomes.length, 1);
  assert.equal(await reconcileTerminalExecutionJobRun(job, { store }), false);
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
    const durablePath = resolvePlaywrightEvidenceBundlePath(report, ["data", "asset.png"]);
    assert.equal(durablePath.relativePath, "data/asset.png");
    assert.equal(durablePath.evidenceItemPath, `run-output/${runId}/playwright-report/data/asset.png`);
    assert.equal(
      (await resolvePlaywrightEvidenceBundleFile(report, ["index.html"])).absolutePath,
      await fs.realpath(path.join(outputRoot, "playwright-report", "index.html"))
    );
    await assert.rejects(() => resolvePlaywrightEvidenceBundleFile(report, ["..", "secret"]), InssaEvidenceServingError);
    await assert.rejects(
      () => resolvePlaywrightEvidenceBundleFile({ ...report, filePath: `run-output/${runId}/other/playwright-report/index.html` }),
      InssaEvidenceServingError
    );

    const reportBytes = Buffer.from("<html>report</html>");
    const evidence = buildEvidenceMetadataForRun(runRecord(runId), [{
      ...report,
      fileSize: reportBytes.byteLength,
      sha256: "d4504aee5c2043441a539d48f507840f27087655d44e319b85885bf920e52ab0"
    }]);
    const uploadedItem = {
      ...evidence.items[0],
      storageBackend: "supabase-storage" as const,
      storageKey: `inssa/staging/test/${runId}/bundle/${report.filePath}`,
      uploadStatus: "uploaded" as const
    };
    assert.equal(findUploadedEvidenceItem([uploadedItem], report.filePath)?.id, uploadedItem.id);
    assert.equal(verifyEvidenceItemBytes(uploadedItem, reportBytes), reportBytes);
    assert.throws(() => verifyEvidenceItemBytes(uploadedItem, Buffer.from("changed")), /size verification/);

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

function runRecord(runId: string): InssaRunRecord {
  const now = new Date().toISOString();
  return {
    campaignKey: "test_inssa_safe",
    commandSnapshot: {
      commandType: "campaign",
      displayName: "INSSA Safe Suite",
      key: "test_inssa_safe",
      mutatesStaging: false,
      npmScript: "test:inssa:safe",
      operatorDescription: "Safe suite.",
      phase1Enabled: true,
      producesFindings: false,
      producesReports: true,
      riskLevel: "safe",
      targetEnvironment: "staging",
      timeoutMs: 120_000
    },
    completedAt: now,
    createdAt: now,
    durationMs: 1,
    exitCode: 0,
    id: runId,
    requestedBy: "operator@example.invalid",
    startedAt: now,
    status: "passed",
    updatedAt: now
  };
}

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

function spawnProcessTree(ignoreSigterm: boolean) {
  const signalHandler = ignoreSigterm ? "process.on('SIGTERM', () => {});" : "process.on('SIGTERM', () => process.exit(0));";
  const descendant = `${signalHandler} setInterval(() => {}, 1000);`;
  const source = [
    "const { spawn } = require('node:child_process');",
    signalHandler,
    `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });`,
    "process.stdout.write(String(descendant.pid) + '\\n');",
    "setInterval(() => {}, 1000);"
  ].join(" ");
  return spawn(process.execPath, ["-e", source], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"]
  });
}

function waitForOutput(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for child-process fixture output.")), 5_000);
    child.stdout?.once("data", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once("error", reject);
  });
}

function waitForClose(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    child.once("close", () => resolve());
    child.once("error", reject);
  });
}

function processExists(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function safelyKill(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(child.pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}
