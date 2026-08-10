import { loadEnvConfig } from "@next/env";
import { getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import { reconcileTerminalExecutionJobRun } from "../lib/inssa-ops/execution-recovery";
import { recordJobRecoveryNotifications, recordWorkerRestartedNotification } from "../lib/inssa-ops/notification-events";
import { executeClaimedInssaJob, type WorkerExecutionConfig } from "../lib/inssa-ops/runner";

loadEnvConfig(process.cwd(), process.env.INSSA_DASHBOARD_MODE !== "start");

const POLL_MS = readPositiveInteger(process.env.INSSA_WORKER_POLL_MS, 1_000);
const EXECUTION_CONFIG = readExecutionConfig();
const runOnce = process.argv.includes("--once");
const workerId = `${process.env.HOSTNAME || "local"}-${process.pid}-${crypto.randomUUID()}`;
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

void main().catch((error) => {
  process.stderr.write(`INSSA execution worker fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const store = getInssaExecutionJobStore();
  await recordWorkerRestartedNotification(workerId);
  process.stdout.write(`INSSA execution worker started: ${workerId}\n`);
  process.stdout.write(
    `Worker lease contract: heartbeatMs=${EXECUTION_CONFIG.heartbeatMs}, leaseMs=${EXECUTION_CONFIG.leaseMs}, failureLimit=${EXECUTION_CONFIG.heartbeatFailureLimit}, terminationGraceMs=${EXECUTION_CONFIG.terminationGraceMs}.\n`
  );
  for (const terminalJob of await store.listTerminal()) {
    await reconcileTerminalExecutionJobRun(terminalJob);
  }

  do {
    const recovered = await store.recoverAbandoned();
    for (const job of recovered) {
      await recordJobRecoveryNotifications(job);
      await reconcileTerminalExecutionJobRun(job);
    }
    if (recovered.length > 0) process.stdout.write(`Recovered ${recovered.length} abandoned execution job(s).\n`);
    const job = await store.claimNext({ leaseMs: EXECUTION_CONFIG.leaseMs, workerId });
    if (job) {
      process.stdout.write(`Claimed execution job ${job.id} for run ${job.runId} (attempt ${job.attempt}).\n`);
      await executeClaimedInssaJob(job, workerId, EXECUTION_CONFIG).catch((error) => {
        process.stderr.write(`Execution job ${job.id} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      });
    } else if (!runOnce && !stopping) {
      await delay(POLL_MS);
    }
  } while (!runOnce && !stopping);

  process.stdout.write(`INSSA execution worker stopped: ${workerId}\n`);
}

function readExecutionConfig(): WorkerExecutionConfig {
  const config = {
    heartbeatFailureLimit: readPositiveInteger(process.env.INSSA_WORKER_HEARTBEAT_FAILURE_LIMIT, 3),
    heartbeatMs: readPositiveInteger(process.env.INSSA_WORKER_HEARTBEAT_MS, 15_000),
    leaseMs: readPositiveInteger(process.env.INSSA_WORKER_LEASE_MS, 120_000),
    terminationGraceMs: readPositiveInteger(process.env.INSSA_WORKER_TERMINATION_GRACE_MS, 10_000)
  };
  if (config.heartbeatMs >= config.leaseMs) {
    throw new Error("INSSA_WORKER_HEARTBEAT_MS must be shorter than INSSA_WORKER_LEASE_MS.");
  }
  if (config.heartbeatMs * config.heartbeatFailureLimit >= config.leaseMs) {
    throw new Error("Worker heartbeat failure detection must complete before the execution lease expires.");
  }
  return config;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
