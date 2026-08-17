import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEvidenceMetadataForRun } from "../lib/inssa-ops/evidence";
import type { InssaRunStore } from "../lib/inssa-ops/run-store";
import type { InssaArtifactRecord, InssaEvidenceItemRecord, InssaRunRecord } from "../lib/inssa-ops/types";
import {
  authenticationCheckPresentation,
  authenticationEvidencePresentation,
  parseAuthenticationMonitoringSummary
} from "../lib/monitoring/authentication-result";
import { loadAuthenticationMonitoringResult, resolveAuthenticationMonitoringResult } from "../lib/monitoring/authentication-result-store";

const RUN_ID = "e348c0f9-3f61-4893-ae27-348916ee39f4";

test("all-provider degraded result maps to truthful dashboard labels without NO DATA", () => {
  const summary = parseAuthenticationMonitoringSummary(summaryFixture());
  assert.equal(authenticationCheckPresentation(summary.checks["username-password"]).label, "PASSED");
  assert.equal(authenticationCheckPresentation(summary.checks["google-oauth"]).label, "BLOCKED - PROVIDER");
  assert.equal(authenticationCheckPresentation(summary.checks["apple-sign-in"]).label, "MISSING CONFIGURATION");
  assert.equal(summary.checks["username-password"].durationMs > 0, true);
});

test("a completed result cannot silently omit a provider", () => {
  const complete = summaryFixture();
  const { "apple-sign-in": _missing, ...incompleteChecks } = complete.checks;
  const fixture = { ...complete, checks: incompleteChecks };
  assert.throws(() => parseAuthenticationMonitoringSummary(fixture), /apple-sign-in result must be an object/);
});

test("schema v2 preserves safe run-owned evidence references", () => {
  const fixture = {
    ...summaryFixture(),
    evidenceReferences: {
      checks: {
        "apple-sign-in": { result: `run-output/${RUN_ID}/authentication-monitoring/apple-sign-in/result.json` },
        "google-oauth": { result: `run-output/${RUN_ID}/authentication-monitoring/google-oauth/result.json` },
        "username-password": {
          consoleLog: `run-output/${RUN_ID}/authentication-monitoring/username-password/console-log.json`,
          result: `run-output/${RUN_ID}/authentication-monitoring/username-password/result.json`,
          screenshot: `run-output/${RUN_ID}/authentication-monitoring/username-password/screenshot.png`
        }
      },
      report: `run-output/${RUN_ID}/playwright-report/index.html`,
      summary: `run-output/${RUN_ID}/authentication-monitoring/authentication-monitoring-summary.json`
    },
    schemaVersion: 2
  };
  const summary = parseAuthenticationMonitoringSummary(fixture);
  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.evidenceReferences?.checks["username-password"].screenshot?.endsWith("screenshot.png"), true);
  assert.throws(
    () => parseAuthenticationMonitoringSummary({ ...fixture, evidenceReferences: { ...fixture.evidenceReferences, report: "../secret" } }),
    /Unsafe authentication monitoring evidence reference/
  );
});

test("Supabase-backed evidence reload returns the persisted provider results", async () => {
  const run = runFixture();
  const summary = summaryFixture();
  const item = evidenceItemFixture();
  const result = await resolveAuthenticationMonitoringResult(
    run,
    [reportArtifactFixture()],
    [item],
    { id: item.bundleId, uploadError: null, uploadStatus: "uploaded" },
    async (requestedItem) => {
      assert.equal(requestedItem.storageBackend, "supabase-storage");
      return Buffer.from(JSON.stringify(summary));
    }
  );
  assert.equal(result.state, "available");
  assert.equal(result.source, "evidence_file");
  assert.equal(result.result?.checks["username-password"].status, "passed");
  assert.equal(result.result?.checks["google-oauth"].status, "blocked_external");
  assert.equal(result.result?.checks["apple-sign-in"].status, "missing_configuration");
  assert.equal(result.evidence.reportArtifactId, "11111111-1111-4111-8111-111111111111");
});

test("new evidence metadata embeds the structured Authentication Monitoring result", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inssa-auth-result-"));
  const previousRoot = process.env.INSSA_QA_REPO_ROOT;
  process.env.INSSA_QA_REPO_ROOT = temporaryRoot;
  try {
    const relativePath = `run-output/${RUN_ID}/playwright-report/authentication-monitoring-summary.json`;
    const absolutePath = path.join(temporaryRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const body = `${JSON.stringify(summaryFixture())}\n`;
    fs.writeFileSync(absolutePath, body);
    const artifact = {
      ...reportArtifactFixture(),
      artifactType: "JSON Artifact",
      filePath: relativePath,
      fileSize: Buffer.byteLength(body),
      id: "22222222-2222-4222-8222-222222222222"
    };
    const evidence = buildEvidenceMetadataForRun(runFixture(), [artifact]);
    const metadata = evidence.items[0]?.metadata;
    assert.equal(metadata?.authenticationMonitoringResultState, "available");
    const persisted = parseAuthenticationMonitoringSummary(metadata?.authenticationMonitoringResult);
    assert.equal(persisted.checks["username-password"].status, "passed");
    assert.equal(persisted.checks["username-password"].durationMs, 39_412);
  } finally {
    if (previousRoot === undefined) delete process.env.INSSA_QA_REPO_ROOT;
    else process.env.INSSA_QA_REPO_ROOT = previousRoot;
    fs.rmSync(temporaryRoot, { recursive: true });
  }
});

test("reconciliation persists a legacy result and a later process reload no longer needs the evidence file", async () => {
  const run = runFixture();
  const artifact = reportArtifactFixture();
  const item = evidenceItemFixture();
  let metadataWrites = 0;
  const store = {
    getArtifacts: async () => [artifact],
    getEvidence: async () => ({
      bundles: [{ id: item.bundleId, uploadError: null, uploadStatus: "uploaded" }],
      items: [item]
    }),
    getRun: async () => run,
    updateEvidenceItemMetadata: async (_id: string, metadata: Record<string, unknown>) => {
      metadataWrites += 1;
      item.metadata = metadata;
      return item;
    }
  } as unknown as InssaRunStore;

  const recovered = await loadAuthenticationMonitoringResult(store, run.id, {
    loadDurableItem: async () => Buffer.from(JSON.stringify(summaryFixture())),
    persistRecoveredMetadata: true
  });
  assert.equal(recovered?.source, "evidence_file");
  assert.equal(metadataWrites, 1);

  const afterRestart = await loadAuthenticationMonitoringResult(store, run.id, {
    loadDurableItem: async () => { throw new Error("ephemeral filesystem and storage reader unavailable"); }
  });
  assert.equal(afterRestart?.source, "evidence_metadata");
  assert.equal(afterRestart?.result?.checks["username-password"].status, "passed");
  assert.equal(afterRestart?.result?.checks["google-oauth"].status, "blocked_external");
  assert.equal(afterRestart?.result?.checks["apple-sign-in"].status, "missing_configuration");
});

test("terminal runs expose RESULT_METADATA_MISSING instead of indefinite pending", async () => {
  const result = await resolveAuthenticationMonitoringResult(runFixture(), [], [], null, async () => Buffer.alloc(0));
  assert.equal(result.state, "result_metadata_missing");
  assert.match(result.reason ?? "", /RESULT_METADATA_MISSING/);
  assert.equal(
    authenticationCheckPresentation(undefined, result.reason ?? undefined).detail,
    result.reason
  );
});

test("historical evidence distinguishes uploaded, failed, terminal-missing, and processing states", () => {
  assert.deepEqual(
    authenticationEvidencePresentation({ reportArtifactId: "report", runStatus: "passed_with_warnings", uploadStatus: "uploaded" }),
    { label: "Open", state: "available" }
  );
  assert.deepEqual(
    authenticationEvidencePresentation({ reportArtifactId: "report", runStatus: "failed", uploadStatus: "failed" }),
    { label: "Evidence Upload Failed", state: "failed" }
  );
  assert.deepEqual(
    authenticationEvidencePresentation({ reportArtifactId: null, runStatus: "passed_with_warnings", uploadStatus: null }),
    { label: "Result metadata unavailable", state: "missing" }
  );
  assert.deepEqual(
    authenticationEvidencePresentation({ reportArtifactId: null, runStatus: "running", uploadStatus: null }),
    { label: "Processing", state: "processing" }
  );
});

function summaryFixture() {
  return {
    checks: {
      "apple-sign-in": check("apple-sign-in", "missing_configuration", 14_692),
      "google-oauth": check("google-oauth", "blocked_external", 31_302),
      "username-password": check("username-password", "passed", 39_412)
    },
    completedAt: "2026-08-16T17:02:01.915Z",
    durationMs: 113_079,
    environment: "staging",
    overallStatus: "degraded",
    runId: RUN_ID,
    schemaVersion: 1,
    startedAt: "2026-08-16T17:00:08.836Z",
    targetHost: "staging.inssa.us"
  };
}

function check(method: string, status: string, durationMs: number) {
  return {
    completedAt: "2026-08-16T17:01:00.000Z",
    durationMs,
    error: null,
    method,
    startedAt: "2026-08-16T17:00:00.000Z",
    status
  };
}

function runFixture(): InssaRunRecord {
  return {
    campaignKey: "monitor_inssa_auth_staging",
    commandSnapshot: {
      commandType: "campaign",
      displayName: "Authentication Monitoring - Staging",
      key: "monitor_inssa_auth_staging",
      mutatesStaging: false,
      npmScript: "test:inssa:monitor:auth:staging",
      operatorDescription: "Authentication monitoring",
      phase1Enabled: true,
      producesFindings: true,
      producesReports: true,
      riskLevel: "safe",
      targetEnvironment: "staging",
      timeoutMs: 360_000
    },
    completedAt: "2026-08-16T17:02:07.154Z",
    createdAt: "2026-08-16T17:00:06.925Z",
    durationMs: 119_295,
    exitCode: 0,
    id: RUN_ID,
    requestedBy: "scheduler:test",
    startedAt: "2026-08-16T17:00:07.859Z",
    status: "passed_with_warnings",
    updatedAt: "2026-08-16T17:02:40.047Z"
  };
}

function reportArtifactFixture(): InssaArtifactRecord {
  return {
    artifactType: "Playwright Report",
    contentType: "text/html",
    createdAt: "2026-08-16T17:02:07.154Z",
    filePath: `run-output/${RUN_ID}/playwright-report/index.html`,
    fileSize: 10,
    id: "11111111-1111-4111-8111-111111111111",
    renderInline: true,
    runId: RUN_ID,
    sensitive: false,
    sha256: "a".repeat(64)
  };
}

function evidenceItemFixture(): InssaEvidenceItemRecord {
  return {
    artifactId: "22222222-2222-4222-8222-222222222222",
    bundleId: "33333333-3333-4333-8333-333333333333",
    campaignKey: "monitor_inssa_auth_staging",
    contentType: "application/json",
    createdAt: "2026-08-16T17:02:07.154Z",
    fileName: "authentication-monitoring-summary.json",
    id: "44444444-4444-4444-8444-444444444444",
    itemType: "JSON Artifact",
    metadata: {},
    relativePath: `run-output/${RUN_ID}/playwright-report/authentication-monitoring-summary.json`,
    renderInline: true,
    retentionClass: "short-lived",
    runId: RUN_ID,
    sensitive: false,
    sha256: "b".repeat(64),
    sizeBytes: 1_414,
    storageBackend: "supabase-storage",
    storageKey: `runs/${RUN_ID}/summary.json`,
    uploadError: null,
    uploadStatus: "uploaded",
    uploadedAt: "2026-08-16T17:02:08.108Z"
  };
}
