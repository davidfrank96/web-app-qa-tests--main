import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { persistEvidenceBundleToDurableStorage } from "../lib/inssa-ops/evidence-storage";
import { getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import { getNotificationOutboxStore } from "../lib/inssa-ops/notification-outbox";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";

test("local run metadata upgrades legacy snapshots and rejects unknown future schemas", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qa-persistence-runs-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;
  const storePath = path.join(repoRoot, "dashboard", ".data", "inssa-runs.json");

  try {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify({ artifacts: [], auditEvents: [], logs: [], runs: [], schemaVersion: 1 }));
    assert.deepEqual(await getInssaRunStore().listRuns(), []);

    await getInssaRunStore().createRun({
      campaignKey: "test_inssa_safe",
      commandSnapshot: commandSnapshot(),
      requestedBy: "persistence-test@example.invalid"
    });
    const upgraded = JSON.parse(await fs.readFile(storePath, "utf8")) as { schemaVersion: number };
    assert.equal(upgraded.schemaVersion, 4);

    await fs.writeFile(storePath, JSON.stringify({ artifacts: [], logs: [], runs: [], schemaVersion: 99 }));
    await assert.rejects(getInssaRunStore().listRuns(), /Unsupported run store schema version: 99/);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("local execution and notification stores reject unknown schema versions", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qa-persistence-versioning-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;
  const dataRoot = path.join(repoRoot, "dashboard", ".data");

  try {
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.writeFile(path.join(dataRoot, "execution-jobs.json"), JSON.stringify({ jobs: [], schemaVersion: 2 }));
    await assert.rejects(
      getInssaExecutionJobStore().getByRunId("00000000-0000-4000-8000-000000000000"),
      /Unsupported execution job store schema version: 2/
    );

    await fs.writeFile(path.join(dataRoot, "notification-outbox.json"), JSON.stringify({ notifications: [], schemaVersion: 2 }));
    await assert.rejects(
      getNotificationOutboxStore().list({}, 0, 10),
      /Unsupported notification outbox schema version: 2/
    );
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("configured Supabase evidence storage fails visibly when server credentials are incomplete", async () => {
  const previous = {
    provider: process.env.INSSA_EVIDENCE_STORAGE_PROVIDER,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: process.env.SUPABASE_URL
  };
  process.env.INSSA_EVIDENCE_STORAGE_PROVIDER = "supabase";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;

  try {
    const result = await persistEvidenceBundleToDurableStorage({
      bundleType: "playwright",
      campaignKey: "test_inssa_safe",
      checksumManifest: {},
      createdAt: new Date().toISOString(),
      environment: "staging",
      id: "77777777-7777-4777-8777-777777777777",
      indexedAt: new Date().toISOString(),
      itemCount: 0,
      product: "INSSA",
      retentionClass: "default",
      rootPath: "run-output/test",
      runId: "88888888-8888-4888-8888-888888888888",
      sensitive: false,
      sourceArtifactId: null,
      status: "indexed",
      storageBackend: "local-filesystem",
      storagePrefix: null,
      title: "Persistence test",
      totalBytes: 0,
      uploadError: null,
      uploadStatus: "local_only",
      uploadedAt: null
    }, []);
    assert.equal(result.status, "failed");
    assert.match(result.message, /requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    restoreEnv("INSSA_EVIDENCE_STORAGE_PROVIDER", previous.provider);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previous.serviceRoleKey);
    restoreEnv("SUPABASE_URL", previous.supabaseUrl);
  }
});

test("persistence verification accepts a complete schema and private Storage bucket", async () => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/rest/v1/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
      return;
    }
    if (request.url === "/storage/v1/bucket/inssa-evidence") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "inssa-evidence", name: "inssa-evidence", public: false }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await spawnAndCapture(process.execPath, ["scripts/provision-persistence.mjs", "--verify-only"], {
      ...process.env,
      INSSA_EVIDENCE_SUPABASE_BUCKET: "inssa-evidence",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      SUPABASE_URL: `http://127.0.0.1:${address.port}`
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /persistence:verify PASS/);
    assert.match(result.stdout, /Tables: 13\/13/);
    assert.match(result.stdout, /Evidence bucket: inssa-evidence \(private\)/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("persistence provisioning creates a missing private bucket through the Storage API", async () => {
  let bucketCreated = false;
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/rest/v1/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
      return;
    }
    if (request.method === "GET" && request.url === "/storage/v1/bucket/inssa-evidence") {
      response.writeHead(bucketCreated ? 200 : 404, { "content-type": "application/json" });
      response.end(bucketCreated
        ? JSON.stringify({ id: "inssa-evidence", name: "inssa-evidence", public: false })
        : JSON.stringify({ message: "not found" }));
      return;
    }
    if (request.method === "POST" && request.url === "/storage/v1/bucket") {
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      request.on("end", () => {
        const payload = JSON.parse(body) as { name?: string; public?: boolean };
        bucketCreated = payload.name === "inssa-evidence" && payload.public === false;
        response.writeHead(bucketCreated ? 200 : 400, { "content-type": "application/json" });
        response.end(JSON.stringify(bucketCreated ? { name: "inssa-evidence" } : { message: "invalid bucket" }));
      });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await spawnAndCapture(process.execPath, ["scripts/provision-persistence.mjs"], {
      ...process.env,
      INSSA_EVIDENCE_SUPABASE_BUCKET: "inssa-evidence",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      SUPABASE_URL: `http://127.0.0.1:${address.port}`
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(bucketCreated, true);
    assert.match(result.stdout, /persistence:provision PASS/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function commandSnapshot() {
  return {
    commandType: "campaign" as const,
    displayName: "INSSA Safe Suite",
    key: "test_inssa_safe",
    mutatesStaging: false,
    npmScript: "test:inssa:safe",
    operatorDescription: "Persistence compatibility test.",
    phase1Enabled: true,
    producesFindings: false,
    producesReports: true,
    riskLevel: "safe" as const,
    timeoutMs: 600_000
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function spawnAndCapture(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, shell: false });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}
