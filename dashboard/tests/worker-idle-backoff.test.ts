import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import { WorkerIdleBackoff, MAX_WORKER_IDLE_MS } from "../lib/inssa-ops/worker-idle-backoff";
const require = createRequire(import.meta.url);
test("idle waits are bounded and reset after activity", () => {
  const backoff = new WorkerIdleBackoff(1000);
  assert.deepEqual(Array.from({ length: 7 }, () => backoff.nextDelay()), [1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  backoff.reset(); assert.equal(backoff.nextDelay(), 1000);
  assert.equal(new WorkerIdleBackoff(60000).nextDelay(), MAX_WORKER_IDLE_MS);
});
test("real worker claims maximum-backoff arrival once and recovers an expired claim", { timeout: 65000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-worker-wave2-"));
  const previousRoot = process.env.INSSA_QA_REPO_ROOT;
  process.env.INSSA_QA_REPO_ROOT = root; delete process.env.INSSA_OPS_METADATA_STORE;
  const worker = spawn(process.execPath, ["--import", require.resolve("tsx"), path.resolve("scripts/inssa-worker.ts")], {
    cwd: root, env: { ...process.env, INSSA_OPS_METADATA_STORE: "local", INSSA_WORKER_POLL_MS: "1000", INSSA_WORKER_HEARTBEAT_MS: "15000", INSSA_WORKER_LEASE_MS: "120000", INSSA_WORKER_HEARTBEAT_FAILURE_LIMIT: "3" }, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = ""; worker.stdout.on("data", chunk => { output += chunk; }); worker.stderr.on("data", chunk => { output += chunk; });
  t.after(async () => {
    worker.kill("SIGTERM");
    if (worker.exitCode === null) await Promise.race([new Promise(resolve => worker.once("exit", resolve)), delay(11000)]);
    if (worker.exitCode === null) worker.kill("SIGKILL");
    if (previousRoot === undefined) delete process.env.INSSA_QA_REPO_ROOT; else process.env.INSSA_QA_REPO_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  });
  const until = async (predicate: () => Promise<boolean> | boolean, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (!(await predicate())) { assert.ok(Date.now() < deadline, output); assert.equal(worker.exitCode, null, output); await delay(20); }
  };
  await until(() => output.includes("idle backoff reached 10000ms"));
  assert.match(output, /heartbeatMs=15000, leaseMs=120000, failureLimit=3/);
  const store = getInssaExecutionJobStore();
  // Missing-run fixture stops at the runner boundary without launching a command.
  const enqueued = await store.enqueue({ campaignKey: "test_inssa_safe", runId: "idle-arrival", idempotencyKey: "idle-arrival" });
  await until(async () => (await store.getByRunId("idle-arrival"))?.status === "failed", 12000);
  const completed = await store.getByRunId("idle-arrival");
  const latencyMs = Date.parse(completed!.claimedAt!) - Date.parse(enqueued.job.createdAt);
  assert.ok(latencyMs >= 0 && latencyMs <= 10750, `claim latency ${latencyMs}ms exceeds 10s plus local IO allowance`);
  assert.equal(completed!.attempt, 1);
  assert.equal(output.split(`Claimed execution job ${enqueued.job.id}`).length - 1, 1);
  t.diagnostic(JSON.stringify({ maxIdleClaimLatencyMs: latencyMs, idleCapMs: MAX_WORKER_IDLE_MS }));
  const abandoned = await store.enqueue({ campaignKey: "test_inssa_safe", runId: "expired-arrival", idempotencyKey: "expired-arrival" });
  await store.claimNext({ workerId: "dead-fixture-worker", leaseMs: 1 });
  await until(async () => (await store.getByRunId("expired-arrival"))?.status === "failed", 4000);
  const recovered = await store.getByRunId("expired-arrival");
  assert.equal(recovered!.id, abandoned.job.id); assert.equal(recovered!.attempt, 2);
  assert.match(output, /Recovered 1 abandoned execution job/);
});
