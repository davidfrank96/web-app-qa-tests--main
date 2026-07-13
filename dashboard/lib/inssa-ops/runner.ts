import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { indexArtifactsForRun } from "./artifact-indexer";
import { recordInssaAuditEvent } from "./audit";
import { getInssaPhase1Command } from "./command-registry";
import { buildEvidenceMetadataForRun } from "./evidence";
import { persistEvidenceBundleToDurableStorage } from "./evidence-storage";
import { validateInssaStagingEnvironment } from "./environment-guard";
import { getRepoRoot } from "./paths";
import { redactInssaLogLine } from "./redaction";
import { getInssaRunStore } from "./run-store";
import type { InssaRunRecord, ResolvedInssaLifecycleArtifactSelection } from "./types";

type RunnerState = {
  activeRunId: string | null;
};

const runnerState = getGlobalRunnerState();

export type StartRunInput = {
  campaignKey: string;
  lifecycleArtifact?: ResolvedInssaLifecycleArtifactSelection;
  requestedBy?: string;
};

export async function startInssaPhase1Run(input: StartRunInput) {
  if (runnerState.activeRunId) {
    return {
      activeRunId: runnerState.activeRunId,
      error: "An INSSA QA run is already active. Phase 1 supports one active run globally and has no queue.",
      status: 409 as const
    };
  }

  const command = getInssaPhase1Command(input.campaignKey);
  if (!command || !command.phase1Enabled || command.mutatesStaging) {
    return {
      error: `Campaign is not enabled for Phase 1 safe execution: ${input.campaignKey}`,
      status: 400 as const
    };
  }

  const environment = validateInssaStagingEnvironment();
  if (!environment.ok) {
    return {
      error: environment.error,
      status: 400 as const
    };
  }

  const store = getInssaRunStore();
  const run = await store.createRun({
    campaignKey: command.key,
    commandSnapshot: command,
    requestedBy: input.requestedBy?.trim() || "phase1-placeholder-user"
  });
  runnerState.activeRunId = run.id;
  void executeRun(run, input.lifecycleArtifact).finally(() => {
    if (runnerState.activeRunId === run.id) {
      runnerState.activeRunId = null;
    }
  });

  return {
    run,
    status: 202 as const
  };
}

export function getActiveInssaRunId() {
  return runnerState.activeRunId;
}

async function executeRun(run: InssaRunRecord, lifecycleArtifact?: ResolvedInssaLifecycleArtifactSelection) {
  const store = getInssaRunStore();
  const repoRoot = getRepoRoot();
  const startedAt = new Date();
  let stderrSeen = false;
  let warningSeen = false;
  let timedOut = false;

  await store.updateRun(run.id, {
    startedAt: startedAt.toISOString(),
    status: "starting"
  });
  await store.appendLog(run.id, "system", `Starting ${run.commandSnapshot.npmScript} in ${repoRoot}`);
  if (lifecycleArtifact) {
    await store.appendLog(
      run.id,
      "system",
      `Using lifecycle artifact: ${lifecycleArtifact.filePath} (${lifecycleArtifact.artifactType}, ${lifecycleArtifact.timestamp})`
    );
  }

  const command = buildRunCommand(repoRoot, run, lifecycleArtifact);
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

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of splitLines(chunk)) {
      if (/warn|warning/i.test(line)) warningSeen = true;
      void store.appendLog(run.id, "stdout", redactInssaLogLine(line));
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrSeen = true;
    for (const line of splitLines(chunk)) {
      if (/warn|warning/i.test(line)) warningSeen = true;
      void store.appendLog(run.id, "stderr", redactInssaLogLine(line));
    }
  });

  child.on("error", (error) => {
    void store.appendLog(run.id, "system", `Startup failure: ${redactInssaLogLine(error.message)}`);
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  await store.updateRun(run.id, {
    status: "indexing_artifacts"
  });
  const artifacts = await indexArtifactsForRun({
    completedAtMs: completedAt.getTime(),
    runId: run.id,
    startedAtMs: startedAt.getTime()
  });
  await store.replaceRunArtifacts(run.id, artifacts);
  await store.appendLog(run.id, "system", `Indexed ${artifacts.length} artifact metadata records.`);
  try {
    const evidence = buildEvidenceMetadataForRun(
      {
        ...run,
        completedAt: completedAt.toISOString()
      },
      artifacts
    );
    await store.replaceRunEvidence(run.id, evidence.bundle, evidence.items);
    await store.appendLog(
      run.id,
      "system",
      evidence.bundle
        ? `Indexed evidence bundle ${evidence.bundle.id} with ${evidence.items.length} evidence item metadata records.`
        : "No evidence bundle was created because this run did not produce artifacts."
    );
    if (evidence.bundle && exit.code === 0 && !timedOut) {
      const storageResult = await persistEvidenceBundleToDurableStorage(evidence.bundle, evidence.items);
      await store.replaceRunEvidence(run.id, storageResult.bundle, storageResult.items);
      await store.appendLog(run.id, "system", `Evidence durable storage ${storageResult.status}: ${storageResult.message}`);
      if (storageResult.status === "failed") {
        warningSeen = true;
      }
    }
  } catch (error) {
    await store.appendLog(
      run.id,
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
      : exit.code === null && exit.signal
        ? "failed_startup"
        : "failed";

  await store.updateRun(run.id, {
    completedAt: completedAt.toISOString(),
    durationMs,
    exitCode: exit.code,
    status: finalStatus
  });
  await store.appendLog(
    run.id,
    "system",
    `Completed ${run.commandSnapshot.npmScript}: status=${finalStatus}, exitCode=${String(exit.code)}, durationMs=${durationMs}`
  );
  await recordInssaAuditEvent({
    campaignKey: run.campaignKey,
    eventType: finalStatus === "passed" || finalStatus === "passed_with_warnings" ? "run_completed" : "run_failed",
    metadata: {
      durationMs,
      exitCode: exit.code,
      requestedBy: run.requestedBy
    },
    runId: run.id,
    status: finalStatus
  });
}

function buildRunCommand(
  repoRoot: string,
  run: InssaRunRecord,
  lifecycleArtifact?: ResolvedInssaLifecycleArtifactSelection
) {
  if (run.commandSnapshot.requiresLifecycleArtifact && run.commandSnapshot.playwrightSpec && lifecycleArtifact) {
    const playwrightBin = path.join(
      repoRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "playwright.cmd" : "playwright"
    );
    const commandName = existsSync(playwrightBin) ? playwrightBin : process.platform === "win32" ? "npx.cmd" : "npx";
    const args = existsSync(playwrightBin)
      ? ["test", run.commandSnapshot.playwrightSpec, "--project=inssa-chrome", "--workers=1", "--retries=0"]
      : [
          "playwright",
          "test",
          run.commandSnapshot.playwrightSpec,
          "--project=inssa-chrome",
          "--workers=1",
          "--retries=0"
        ];
    return {
      args,
      commandName,
      env: {
        ...process.env,
        ...readLiveStagingEnv(repoRoot),
        INSSA_LIVE_CAPSULE_ARTIFACT_PATH: lifecycleArtifact.filePath,
        INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT: "0"
      }
    };
  }

  return {
    args: ["run", run.commandSnapshot.npmScript],
    commandName: process.platform === "win32" ? "npm.cmd" : "npm",
    env: process.env
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
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitLines(chunk: Buffer) {
  return chunk
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function getGlobalRunnerState() {
  const globalWithRunner = globalThis as typeof globalThis & {
    __inssaQaRunnerState?: RunnerState;
  };

  if (!globalWithRunner.__inssaQaRunnerState) {
    globalWithRunner.__inssaQaRunnerState = { activeRunId: null };
  }

  return globalWithRunner.__inssaQaRunnerState;
}
