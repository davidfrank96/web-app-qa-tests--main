import { loadEnvConfig } from "@next/env";
import { getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import { recordJobRecoveryNotifications, recordWorkerRestartedNotification } from "../lib/inssa-ops/notification-events";
import { executeClaimedInssaJob } from "../lib/inssa-ops/runner";

loadEnvConfig(process.cwd(), process.env.INSSA_DASHBOARD_MODE !== "start");

const LEASE_MS = readPositiveInteger(process.env.INSSA_WORKER_LEASE_MS, 30_000);
const POLL_MS = readPositiveInteger(process.env.INSSA_WORKER_POLL_MS, 1_000);
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

  do {
    const recovered = await store.recoverAbandoned();
    for (const job of recovered) await recordJobRecoveryNotifications(job);
    if (recovered.length > 0) process.stdout.write(`Recovered ${recovered.length} abandoned execution job(s).\n`);
    const job = await store.claimNext({ leaseMs: LEASE_MS, workerId });
    if (job) {
      process.stdout.write(`Claimed execution job ${job.id} for run ${job.runId} (attempt ${job.attempt}).\n`);
      await executeClaimedInssaJob(job, workerId, LEASE_MS).catch((error) => {
        process.stderr.write(`Execution job ${job.id} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      });
    } else if (!runOnce && !stopping) {
      await delay(POLL_MS);
    }
  } while (!runOnce && !stopping);

  process.stdout.write(`INSSA execution worker stopped: ${workerId}\n`);
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
