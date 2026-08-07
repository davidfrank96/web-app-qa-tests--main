import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { indexArtifactsForRun } from "./artifact-indexer";
import { recordInssaAuditEvent } from "./audit";
import { persistCleanupLedgerForRun } from "./cleanup-ledger";
import { writeCleanupManifest } from "./cleanup-manifest";
import { getInssaPhase1Command } from "./command-registry";
import { ActiveExecutionJobError, getInssaExecutionJobStore } from "./execution-job-store";
import { buildEvidenceMetadataForRun } from "./evidence";
import { persistEvidenceBundleToDurableStorage } from "./evidence-storage";
import { validateInssaStagingEnvironment } from "./environment-guard";
import {
  recordEvidenceUploadFailureNotification,
  recordExecutionFailureNotification,
  recordRunOutcomeNotification,
  recordRunQueuedNotification,
  recordRunStartedNotification
} from "./notification-events";
import { getRepoRoot } from "./paths";
import { redactInssaLogLine } from "./redaction";
import { getInssaRunStore } from "./run-store";
import { buildRunOutputEnvironment, finalizeRunOutput, prepareRunOutput } from "./run-output";
import type {
  InssaExecutionJobRecord,
  InssaLiveExecutionContext,
  InssaRunLogRecord,
  InssaRunRecord,
  ResolvedInssaLifecycleArtifactSelection
} from "./types";

export type StartRunInput = {
  campaignKey: string;
  idempotencyKey?: string;
  lifecycleArtifact?: ResolvedInssaLifecycleArtifactSelection;
  executionContext?: InssaLiveExecutionContext;
  requestedBy?: string;
};

export async function startInssaPhase1Run(input: StartRunInput) {
  const command = getInssaPhase1Command(input.campaignKey);
  if (!command || !command.phase1Enabled) {
    return {
      error: `Campaign is not enabled for Phase 1 safe execution: ${input.campaignKey}`,
      status: 400 as const
    };
  }
  if (command.mutatesStaging && !input.executionContext) {
    return { error: `Admin approval and successful preflight are required for live campaign: ${input.campaignKey}`, status: 400 as const };
  }

  const environment = validateInssaStagingEnvironment();
  if (!environment.ok) {
    return { error: environment.error, status: 400 as const };
  }

  const idempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();
  const jobStore = getInssaExecutionJobStore();
  const existingJob = await jobStore.getByIdempotencyKey(idempotencyKey);
  if (existingJob) {
    const existingRun = await getInssaRunStore().getRun(existingJob.runId);
    if (!existingRun) throw new Error(`Idempotent execution job references missing run: ${existingJob.runId}`);
    return { run: existingRun, status: 202 as const };
  }

  const store = getInssaRunStore();
  const run = await store.createRun({
    campaignKey: command.key,
    commandSnapshot: command,
    executionContext: input.executionContext,
    requestedBy: input.requestedBy?.trim() || "phase1-placeholder-user"
  });

  try {
    const enqueued = await jobStore.enqueue({
      campaignKey: command.key,
      idempotencyKey,
      executionContext: input.executionContext,
      lifecycleArtifact: input.lifecycleArtifact,
      maxAttempts: command.mutatesStaging ? 1 : 2,
      runId: run.id
    });
    if (enqueued.created) await recordRunQueuedNotification(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.updateRun(run.id, {
      completedAt: new Date().toISOString(),
      status: "failed_startup"
    });
    await recordRunOutcomeNotification(run, "failed_startup", 0, null);
    if (error instanceof ActiveExecutionJobError) {
      return {
        activeRunId: error.activeRunId,
        error: "An INSSA QA run is already active. The durable worker supports one active run globally.",
        status: 409 as const
      };
    }
    throw new Error(`Failed to enqueue execution job: ${message}`);
  }

  return { run, status: 202 as const };
}

export async function executeClaimedInssaJob(job: InssaExecutionJobRecord, workerId: string, leaseMs: number) {
  const store = getInssaRunStore();
  const jobStore = getInssaExecutionJobStore();
  const run = await store.getRun(job.runId);
  if (!run) {
    await jobStore.complete(job.id, workerId, "failed", `Run not found: ${job.runId}`);
    return;
  }

  if (isTerminalRun(run)) {
    await jobStore.complete(job.id, workerId, run.status === "passed" || run.status === "passed_with_warnings" ? "completed" : "failed");
    await recordRunOutcomeNotification(run, run.status, run.durationMs ?? 0, run.exitCode);
    return;
  }

  await jobStore.markRunning(job.id, workerId, leaseMs);
  await recordRunStartedNotification(run, job.attempt, workerId);
  await recordInssaAuditEvent({
    campaignKey: run.campaignKey,
    eventType: "run_started",
    metadata: { attempt: job.attempt, workerId },
    runId: run.id,
    status: "running"
  });
  const leaseAbort = new AbortController();
  const heartbeat = setInterval(() => {
    void jobStore.heartbeat(job.id, workerId, leaseMs).catch((error) => {
      leaseAbort.abort(error instanceof Error ? error : new Error(String(error)));
      process.stderr.write(`Worker lease lost for ${job.id}: ${String(error)}\n`);
    });
  }, Math.max(1_000, Math.floor(leaseMs / 3)));
  heartbeat.unref();

  try {
    const finalStatus = await executeRun(run, job.lifecycleArtifact ?? undefined, job.executionContext ?? undefined, leaseAbort.signal);
    await jobStore.complete(
      job.id,
      workerId,
      finalStatus === "passed" || finalStatus === "passed_with_warnings" ? "completed" : "failed"
    );
  } catch (error) {
    if (leaseAbort.signal.aborted) {
      const reason = leaseAbort.signal.reason instanceof Error ? leaseAbort.signal.reason.message : String(leaseAbort.signal.reason);
      process.stderr.write(`Execution stopped after lease loss for ${job.id}: ${reason}\n`);
      return;
    }
    const message = redactInssaLogLine(error instanceof Error ? error.message : String(error));
    await store.appendLog(run.id, "system", `Worker execution failure: ${message}`);
    await store.updateRun(run.id, {
      completedAt: new Date().toISOString(),
      status: "failed_startup"
    });
    await recordExecutionFailureNotification(run, message);
    await recordRunOutcomeNotification(run, "failed_startup", 0, null);
    await jobStore.complete(job.id, workerId, "failed", message);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

async function executeRun(
  run: InssaRunRecord,
  lifecycleArtifact?: ResolvedInssaLifecycleArtifactSelection,
  executionContext?: InssaLiveExecutionContext,
  leaseSignal?: AbortSignal
) {
  const store = getInssaRunStore();
  const repoRoot = getRepoRoot();
  const startedAt = new Date();
  const outputRoot = await prepareRunOutput(run.id);
  let stderrSeen = false;
  let warningSeen = false;
  let timedOut = false;
  let startupError: Error | null = null;
  let logChain = Promise.resolve();

  const appendLog = (stream: InssaRunLogRecord["stream"], message: string) => {
    logChain = logChain.then(() => store.appendLog(run.id, stream, message)).then(() => undefined);
    return logChain;
  };

  await store.updateRun(run.id, { startedAt: startedAt.toISOString(), status: "starting" });
  await appendLog("system", `Worker starting ${run.commandSnapshot.npmScript} in ${repoRoot}`);
  await appendLog("system", `Immutable run output: ${outputRoot}`);
  if (lifecycleArtifact) {
    await appendLog(
      "system",
      `Using lifecycle artifact: ${lifecycleArtifact.filePath} (${lifecycleArtifact.artifactType}, ${lifecycleArtifact.timestamp})`
    );
  }

  const command = buildRunCommand(repoRoot, run, lifecycleArtifact, executionContext);
  const child = spawn(command.commandName, command.args, {
    cwd: repoRoot,
    env: command.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  await store.updateRun(run.id, { status: "running" });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, run.commandSnapshot.timeoutMs);
  const stopForLeaseLoss = () => child.kill("SIGTERM");
  leaseSignal?.addEventListener("abort", stopForLeaseLoss, { once: true });

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of splitLines(chunk)) {
      if (/warn|warning/i.test(line)) warningSeen = true;
      void appendLog("stdout", redactInssaLogLine(line));
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrSeen = true;
    for (const line of splitLines(chunk)) {
      if (/warn|warning/i.test(line)) warningSeen = true;
      void appendLog("stderr", redactInssaLogLine(line));
    }
  });
  child.on("error", (error) => {
    startupError = error;
    void appendLog("system", `Startup failure: ${redactInssaLogLine(error.message)}`);
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  leaseSignal?.removeEventListener("abort", stopForLeaseLoss);
  await logChain;
  assertExecutionLease(leaseSignal);

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  await store.updateRun(run.id, { status: "indexing_artifacts" });
  let output = await finalizeRunOutput({ campaignKey: run.campaignKey, completedAt, runId: run.id, startedAt });
  if (run.commandSnapshot.cleanupRequired) {
    const cleanup = await writeCleanupManifest(run, output.outputRoot);
    if (cleanup) {
      await store.updateRun(run.id, { cleanup });
      const cleanupRecords = await persistCleanupLedgerForRun(run, cleanup, store);
      if (cleanupRecords.length > 0) {
        await recordInssaAuditEvent({
          campaignKey: run.campaignKey,
          eventType: "cleanup_deferred",
          metadata: {
            objectCount: cleanupRecords.length,
            objectPaths: cleanupRecords.map((record) => record.objectPath),
            reasonCode: cleanup.reasonCode
          },
          runId: run.id,
          status: cleanup.status
        });
      }
      if (cleanup.createdCapsuleIds.length === 0) {
        await recordInssaAuditEvent({
          campaignKey: run.campaignKey,
          eventType: "cleanup_investigation_required",
          metadata: {
            finalActionPerformed: cleanup.finalActionPerformed,
            reason: "Mutation campaign completed without a captured capsule ID."
          },
          runId: run.id,
          status: "failed_cleanup_identity"
        });
      }
    }
    output = await finalizeRunOutput({ campaignKey: run.campaignKey, completedAt, runId: run.id, startedAt });
  }
  assertExecutionLease(leaseSignal);
  const artifacts = await indexArtifactsForRun({
    completedAtMs: completedAt.getTime(),
    outputRoot: output.outputRoot,
    runId: run.id,
    startedAtMs: startedAt.getTime()
  });
  await store.replaceRunArtifacts(run.id, artifacts);
  assertExecutionLease(leaseSignal);
  await appendLog("system", `Indexed ${artifacts.length} immutable artifact metadata records.`);
  await appendLog("system", `Run manifest: ${output.manifestPath}`);

  try {
    const evidence = buildEvidenceMetadataForRun({ ...run, completedAt: completedAt.toISOString() }, artifacts);
    await store.replaceRunEvidence(run.id, evidence.bundle, evidence.items);
    await appendLog(
      "system",
      evidence.bundle
        ? `Indexed evidence bundle ${evidence.bundle.id} with ${evidence.items.length} evidence item metadata records.`
        : "No evidence bundle was created because this run did not produce artifacts."
    );
    if (evidence.bundle && exit.code === 0 && !timedOut) {
      try {
        const storageResult = await persistEvidenceBundleToDurableStorage(evidence.bundle, evidence.items);
        assertExecutionLease(leaseSignal);
        await store.replaceRunEvidence(run.id, storageResult.bundle, storageResult.items);
        await appendLog("system", `Evidence durable storage ${storageResult.status}: ${storageResult.message}`);
        if (storageResult.status === "failed") {
          warningSeen = true;
          await recordEvidenceUploadFailureNotification(run, evidence.bundle.id, storageResult.message);
        }
      } catch (error) {
        warningSeen = true;
        const message = redactInssaLogLine(error instanceof Error ? error.message : String(error));
        await recordEvidenceUploadFailureNotification(run, evidence.bundle.id, message);
        await appendLog("system", `Evidence durable storage warning: ${message}`);
      }
    }
  } catch (error) {
    warningSeen = true;
    await appendLog(
      "system",
      `Evidence metadata indexing warning: ${redactInssaLogLine(error instanceof Error ? error.message : String(error))}`
    );
  }

  const finalStatus = timedOut
    ? "timed_out"
    : exit.code === 0
      ? stderrSeen || warningSeen
        ? "passed_with_warnings"
        : "passed"
      : startupError || (exit.code === null && exit.signal)
        ? "failed_startup"
        : "failed";

  assertExecutionLease(leaseSignal);
  await store.updateRun(run.id, {
    completedAt: completedAt.toISOString(),
    durationMs,
    exitCode: exit.code,
    status: finalStatus
  });
  await appendLog(
    "system",
    `Completed ${run.commandSnapshot.npmScript}: status=${finalStatus}, exitCode=${String(exit.code)}, durationMs=${durationMs}`
  );
  await recordInssaAuditEvent({
    campaignKey: run.campaignKey,
    eventType: finalStatus === "passed" || finalStatus === "passed_with_warnings" ? "run_completed" : "run_failed",
    metadata: { durationMs, exitCode: exit.code, requestedBy: run.requestedBy },
    runId: run.id,
    status: finalStatus
  });
  await recordRunOutcomeNotification(run, finalStatus, durationMs, exit.code);
  return finalStatus;
}

function buildRunCommand(
  repoRoot: string,
  run: InssaRunRecord,
  lifecycleArtifact?: ResolvedInssaLifecycleArtifactSelection,
  executionContext?: InssaLiveExecutionContext
) {
  const runEnvironment = buildRunOutputEnvironment(run.id);
  const liveEnvironment = run.commandSnapshot.mutatesStaging ? readLiveStagingEnv(repoRoot) : {};
  const mutationEnvironment = run.commandSnapshot.mutatesStaging
    ? {
        INSSA_MUTATION_RECORDING: "1",
        INSSA_MUTATION_RUN_ID: run.id
      }
    : {};
  if (run.commandSnapshot.requiresLifecycleArtifact && run.commandSnapshot.playwrightSpec && lifecycleArtifact) {
    const playwrightBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");
    const commandName = existsSync(playwrightBin) ? playwrightBin : process.platform === "win32" ? "npx.cmd" : "npx";
    const args = existsSync(playwrightBin)
      ? ["test", run.commandSnapshot.playwrightSpec, "--project=inssa-chrome", "--workers=1", "--retries=0"]
      : ["playwright", "test", run.commandSnapshot.playwrightSpec, "--project=inssa-chrome", "--workers=1", "--retries=0"];
    return {
      args,
      commandName,
      env: {
        ...process.env,
        ...liveEnvironment,
        ...runEnvironment,
        ...mutationEnvironment,
        INSSA_LIVE_CAPSULE_ARTIFACT_PATH: lifecycleArtifact.filePath,
        INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT: "0"
      }
    };
  }

  return {
    args: ["run", run.commandSnapshot.npmScript],
    commandName: process.platform === "win32" ? "npm.cmd" : "npm",
    env: {
      ...process.env,
      ...liveEnvironment,
      ...runEnvironment,
      ...mutationEnvironment,
      ...(executionContext?.executionMode === "resume" && executionContext.resumeArtifact
        ? {
            INSSA_REVEAL_LATER_LIFECYCLE_ARTIFACT_PATH: executionContext.resumeArtifact.filePath,
            INSSA_REVEAL_LATER_SECURITY_ARTIFACT_PATH: executionContext.resumeArtifact.filePath
          }
        : {})
    }
  };
}

function readLiveStagingEnv(repoRoot: string) {
  const envPath = path.join(repoRoot, ".env.inssa.live-staging");
  if (!existsSync(envPath)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitLines(chunk: Buffer) {
  return chunk.toString("utf8").split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

function isTerminalRun(run: InssaRunRecord) {
  return ["cancelled", "failed", "failed_startup", "passed", "passed_with_warnings", "timed_out"].includes(run.status);
}

function assertExecutionLease(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Execution lease was lost.");
}
