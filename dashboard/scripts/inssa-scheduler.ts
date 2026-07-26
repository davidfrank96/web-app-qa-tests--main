import { loadEnvConfig } from "@next/env";
import { evaluateSchedulerOnce } from "../lib/monitoring/scheduler";
import { getSchedulerStore } from "../lib/monitoring/scheduler-store";

loadEnvConfig(process.cwd(), process.env.INSSA_DASHBOARD_MODE !== "start");

const INTERVAL_MS = readPositiveInteger(process.env.INSSA_SCHEDULER_INTERVAL_MS, 60_000);
const runOnce = process.argv.includes("--once");
const schedulerId = `${process.env.HOSTNAME || "local"}-${process.pid}-${crypto.randomUUID()}`;
const store = getSchedulerStore();
let stopping = false;
let wakeSleep: (() => void) | null = null;

process.on("SIGINT", requestStop);
process.on("SIGTERM", requestStop);

void main().catch(async (error) => {
  process.stderr.write(`INSSA scheduler fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await store.stop(schedulerId, new Date()).catch(() => undefined);
  process.exitCode = 1;
});

async function main() {
  await store.start(schedulerId, new Date());
  process.stdout.write(`INSSA scheduler started: ${schedulerId} (interval ${INTERVAL_MS}ms)\n`);
  try {
    do {
      const result = await evaluateSchedulerOnce({ schedulerId, schedulerStore: store });
      process.stdout.write(
        `Scheduler evaluation: definitions=${result.definitionsEvaluated}, queued=${result.jobsQueued}, errors=${result.errors.length}\n`
      );
      if (!runOnce && !stopping) await delay(INTERVAL_MS);
    } while (!runOnce && !stopping);
  } finally {
    await store.stop(schedulerId, new Date());
    process.stdout.write(`INSSA scheduler stopped: ${schedulerId}\n`);
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : fallback;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms);
    wakeSleep = finish;
    function finish() {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    }
  });
}

function requestStop() {
  stopping = true;
  wakeSleep?.();
}
