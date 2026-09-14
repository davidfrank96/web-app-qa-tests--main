import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyHistoricalEvidenceSources, markHistoricalEvidenceUnavailable, HISTORICAL_EVIDENCE_UNAVAILABLE } from "../lib/inssa-ops/evidence-recovery";
import { buildEvidenceMetadataForRun } from "../lib/inssa-ops/evidence";
import { downloadEvidenceItemFromDurableStorage, persistEvidenceBundleToDurableStorage } from "../lib/inssa-ops/evidence-storage";
import { assertEvidenceExecutionSafety } from "../lib/inssa-ops/evidence-safety";
import { getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";
import { executeClaimedInssaJob } from "../lib/inssa-ops/runner";
import { indexArtifactsForRun } from "../lib/inssa-ops/artifact-indexer";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-evidence-wave1-"));
  const previous = { ...process.env };
  const objects = new Map<string, Buffer>();
  let writes = 0, publicBucket = false, corruptDownloads = false;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/storage/v1/bucket/inssa-evidence") {
      response.end(JSON.stringify({ id: "inssa-evidence", name: "inssa-evidence", public: publicBucket })); return;
    }
    const key = request.url?.replace(/^\/storage\/v1\/object\/(?:authenticated\/)?inssa-evidence\//, "");
    if (request.method === "POST" && key) {
      writes++; assert.equal(request.headers["x-upsert"], "false");
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (objects.has(key)) { response.writeHead(409); response.end(JSON.stringify({ message: "Already exists" })); return; }
      objects.set(key, Buffer.concat(chunks)); response.end(JSON.stringify({ Key: key })); return;
    }
    if (request.method === "GET" && key && objects.has(key)) {
      response.setHeader("content-type", "application/octet-stream");
      response.end(corruptDownloads ? Buffer.from("corrupt") : objects.get(key)); return;
    }
    response.writeHead(404); response.end(JSON.stringify({ message: "Not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  Object.assign(process.env, { INSSA_QA_REPO_ROOT: root, INSSA_OPS_METADATA_STORE: "local",
    INSSA_EVIDENCE_STORAGE_PROVIDER: "supabase", SUPABASE_URL: `http://127.0.0.1:${address.port}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role", INSSA_EVIDENCE_SUPABASE_BUCKET: "inssa-evidence" });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { fixture: "node fixture.cjs" } }));
  const store = getInssaRunStore(), jobs = getInssaExecutionJobStore();
  async function createRun(mode: "pass" | "fail" | "timeout" = "pass") {
    await fs.writeFile(path.join(root, "fixture.cjs"), `const fs=require('fs'),path=require('path');fs.writeFileSync(path.join(process.env.INSSA_RUN_OUTPUT_DIR,'result.json'),JSON.stringify({fixture:true,mode:${JSON.stringify(mode)}}));${mode === "timeout" ? "setInterval(()=>{},1000)" : `process.exit(${mode === "fail" ? 1 : 0})`}`);
    const run = await store.createRun({ campaignKey: "test_inssa_safe", requestedBy: "evidence-fixture",
      commandSnapshot: { key: "test_inssa_safe", displayName: "Controlled evidence fixture", npmScript: "fixture", commandType: "campaign",
        mutatesStaging: false, phase1Enabled: true, producesFindings: false, producesReports: true, riskLevel: "safe",
        operatorDescription: "No product network calls", timeoutMs: mode === "timeout" ? 1_200 : 10_000 } });
    await jobs.enqueue({ campaignKey: run.campaignKey, runId: run.id, idempotencyKey: run.id });
    const job = await jobs.claimNext({ workerId: "fixture-worker", leaseMs: 30_000 }); assert.ok(job);
    return { run, job };
  }
  return { root, store, jobs, createRun, objects, writes: () => writes,
    setPublic: () => { publicBucket = true; }, corrupt: () => { corruptDownloads = true; } };
}
const config = { heartbeatFailureLimit: 2, heartbeatMs: 1_000, leaseMs: 30_000, terminationGraceMs: 100 };
for (const [mode, expected] of [["pass", "passed"], ["fail", "failed"], ["timeout", "timed_out"]] as const) {
  test(`${mode} execution uploads, verifies and retrieves private durable evidence independently of its result`, async (t) => {
    const f = await fixture(t), { run, job } = await f.createRun(mode);
    await executeClaimedInssaJob(job, "fixture-worker", config);
    assert.equal((await f.store.getRun(run.id))?.status, expected);
    const evidence = await f.store.getEvidence(run.id);
    assert.equal(evidence.bundles.length, 1); assert.equal(evidence.bundles[0].uploadStatus, "uploaded");
    assert.ok(evidence.items.length >= 2); assert.equal(evidence.bundles[0].itemCount, evidence.items.length);
    for (const item of evidence.items) assert.ok((await downloadEvidenceItemFromDurableStorage(item)).length);
    const retry = await persistEvidenceBundleToDurableStorage(evidence.bundles[0], evidence.items);
    assert.equal(retry.status, "uploaded");
    assert.deepEqual(retry.items.map((item) => item.storageKey), evidence.items.map((item) => item.storageKey));
    await f.store.replaceRunEvidence(run.id, retry.bundle, retry.items);
    assert.equal((await f.store.getEvidence(run.id)).items.length, evidence.items.length);
  });
}

test("lease loss, foreign ownership and still-alive process reject publication", async (t) => {
  const f = await fixture(t), { run, job } = await f.createRun("timeout");
  const owner = { jobId: job.id, workerId: "fixture-worker" };
  const input = { job, owner, runId: run.id, leaseLost: false, processAlive: false };
  assert.doesNotThrow(() => assertEvidenceExecutionSafety(input));
  for (const invalid of [{ leaseLost: true }, { processAlive: true }, { job: { ...job, claimedBy: "another-worker" } },
    { job: { ...job, leaseExpiresAt: "2000-01-01T00:00:00Z" } }]) {
    assert.throws(() => assertEvidenceExecutionSafety({ ...input, ...invalid }));
  }
  const execution = executeClaimedInssaJob(job, "fixture-worker", config);
  let running = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await f.store.getRun(run.id))?.status === "running") { running = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(running);
  const storePath = path.join(f.root, "dashboard/.data/execution-jobs.json");
  const snapshot = JSON.parse(await fs.readFile(storePath, "utf8"));
  snapshot.jobs[0].claimedBy = "another-worker"; await fs.writeFile(storePath, JSON.stringify(snapshot));
  await execution;
  assert.equal(f.writes(), 0); assert.equal((await f.store.getEvidence(run.id)).bundles.length, 0);
  assert.equal((await f.store.getRun(run.id))?.status, "running");
  assert.match((await f.store.getLogs(run.id)).map((log) => log.message).join("\n"), /EVIDENCE_UNAVAILABLE/);
});

test("missing bytes, corrupt manifest, public bucket and corrupt download never claim durable success", async (t) => {
  const f = await fixture(t), { run } = await f.createRun();
  const output = path.join(f.root, "run-output", run.id); await fs.mkdir(output, { recursive: true });
  const file = path.join(output, "result.json"); await fs.writeFile(file, '{"fixture":true}');
  const artifacts = await indexArtifactsForRun({ runId: run.id, outputRoot: output, completedAtMs: Date.now(), startedAtMs: Date.now() });
  const evidence = buildEvidenceMetadataForRun(run, artifacts); assert.ok(evidence.bundle); const bundle = evidence.bundle;
  let result = await persistEvidenceBundleToDurableStorage({ ...bundle, itemCount: 2 }, evidence.items);
  assert.equal(result.status, "failed"); assert.equal(f.writes(), 0);
  await fs.writeFile(file, "altered"); result = await persistEvidenceBundleToDurableStorage(bundle, evidence.items);
  assert.equal(result.status, "failed"); assert.equal(f.writes(), 0);
  await fs.rm(file);
  assert.deepEqual(await classifyHistoricalEvidenceSources(bundle, evidence.items), { classification: "SOURCE_BYTES_GONE", verified: 0, missing: 1 });
  const unavailable = markHistoricalEvidenceUnavailable(bundle, evidence.items);
  assert.equal(unavailable.bundle.uploadError, HISTORICAL_EVIDENCE_UNAVAILABLE);
  assert.equal(unavailable.items[0].sha256, evidence.items[0].sha256);
  result = await persistEvidenceBundleToDurableStorage(bundle, evidence.items);
  assert.equal(result.status, "failed"); assert.equal(f.writes(), 0); await assert.rejects(fs.access(file));
  await fs.writeFile(file, '{"fixture":true}'); f.corrupt(); result = await persistEvidenceBundleToDurableStorage(bundle, evidence.items);
  assert.equal(result.status, "failed"); assert.match(result.message, /verification/);
  const priorWrites = f.writes(); f.setPublic(); result = await persistEvidenceBundleToDurableStorage(bundle, evidence.items);
  assert.equal(result.status, "failed"); assert.equal(f.writes(), priorWrites); assert.match(result.message, /private/);
  await f.store.replaceRunArtifacts(run.id, artifacts); await f.store.replaceRunEvidence(run.id, bundle, evidence.items);
  await assert.rejects(f.store.replaceRunEvidence(run.id, { ...bundle, itemCount: 2 }, evidence.items));
  await assert.rejects(f.store.replaceRunEvidence(run.id, null, []));
  assert.deepEqual((await f.store.getEvidence(run.id)).bundles, [bundle]);
});
