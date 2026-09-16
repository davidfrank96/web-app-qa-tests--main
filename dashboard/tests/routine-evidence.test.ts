import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fixture } from "./fixtures/retention";
import { reduceRoutineEvidence, routineEvidenceDecision, type RoutineEvidenceInput } from "../lib/inssa-ops/routine-evidence";
import { finalizeRunOutput } from "../lib/inssa-ops/run-output";
import { indexArtifactsForRun } from "../lib/inssa-ops/artifact-indexer";
import { buildEvidenceMetadataForRun } from "../lib/inssa-ops/evidence";
import { validateEvidenceManifest } from "../lib/inssa-ops/evidence-integrity";
import { parseAuthenticationMonitoringSummary } from "../lib/monitoring/authentication-result";
import { resolveAuthenticationMonitoringResult } from "../lib/monitoring/authentication-result-store";
import { getInssaPhase1Command } from "../lib/inssa-ops/command-registry";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";
const stamp = "2026-09-15T00:00:00Z";
function report(auth = false) { return { errors: [], stats: { flaky: 0, skipped: 0, unexpected: auth ? 2 : 0, expected: 1 }, suites: [{ specs:
  (auth ? ["Username & Password", "Google OAuth", "Apple Sign-In"] : ["Safe assertion"]).map((title, i) => ({ title, file: "fixture.spec.ts", tests: [
    { status: i ? "unexpected" : "expected", results: [{ status: i ? "failed" : "passed", retry: 0, duration: 10, attachments: [{ body: "heavy-inline-evidence" }] }] }] })) }] }; }
function authSummary() { return parseAuthenticationMonitoringSummary({ schemaVersion: 2, runId: "run-1", environment: "staging", targetHost: "staging.inssa.us", overallStatus: "degraded", startedAt: stamp, completedAt: stamp, durationMs: 30,
  checks: Object.fromEntries(["username-password", "google-oauth", "apple-sign-in"].map((method, i) => [method, { method, status: ["passed", "blocked_external", "missing_configuration"][i], error: i ? "Known provider outcome" : null, startedAt: stamp, completedAt: stamp, durationMs: 10 }])) }); }
function input(auth = false): RoutineEvidenceInput { const run = fixture().runs[0]; if (auth) { run.campaignKey = "monitor_inssa_auth_staging"; run.commandSnapshot = getInssaPhase1Command(run.campaignKey)!; }
  return { run, exitCode: 0, interrupted: false, warningLines: auth ? ["WARNING: Authentication monitoring staging: overall=degraded, checks=username-password:passed,google-oauth:blocked_external,apple-sign-in:missing_configuration"] : [], stderrLines: [] }; }
for (const auth of [false, true]) test(`${auth ? "known Authentication Monitoring" : "Safe Suite"} success publishes a valid lightweight bundle with no heavy copies`, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "routine-evidence-")); const before = process.env.INSSA_QA_REPO_ROOT; process.env.INSSA_QA_REPO_ROOT = temp;
  t.after(async () => { if (before === undefined) delete process.env.INSSA_QA_REPO_ROOT; else process.env.INSSA_QA_REPO_ROOT = before; await fs.rm(temp, { recursive: true, force: true }); });
  const i = input(auth);
  const store = getInssaRunStore();
  const created = await store.createRun({ campaignKey: i.run.campaignKey, commandSnapshot: i.run.commandSnapshot, requestedBy: "routine-evidence-test" });
  i.run = (await store.getRun(created.id))!;
  assert.equal(i.run.cleanup?.status, "not_required");
  const summary = authSummary(); summary.runId = i.run.id;
  const root = path.join(temp, "run-output", i.run.id); await fs.mkdir(path.join(root, "playwright-report/data"), { recursive: true });
  await fs.writeFile(path.join(root, "playwright-results.json"), JSON.stringify(report(auth)));
  await fs.writeFile(path.join(root, "playwright-report/index.html"), Buffer.alloc(2_000_000, "H"));
  await fs.writeFile(path.join(root, "playwright-report/data/trace.zip"), Buffer.alloc(200_000));
  if (auth) { await fs.mkdir(path.join(root, "authentication-monitoring")); await fs.writeFile(path.join(root, "authentication-monitoring/authentication-monitoring-summary.json"), JSON.stringify(summary)); }
  const result = await reduceRoutineEvidence(i); assert.ok(result); assert.ok(result.beforeBytes > 2_000_000); assert.ok(result.summaryBytes < 100_000);
  assert.equal(result.mode, "INVESTIGATION_READY_SUCCESS");
  const html = await fs.readFile(path.join(root, "playwright-report/index.html"), "utf8");
  assert.match(html, /Test results and execution path/); assert.match(html, /Warnings and notices/);
  assert.match(html, /fixture.spec.ts/); assert.match(html, /0.01 s/); assert.ok(html.includes(i.run.id));
  assert.doesNotMatch(html, /(?:src|href)=["']/); assert.doesNotMatch(html, /heavy-inline-evidence/);
  if (auth) { assert.match(html, /BLOCKED_EXTERNAL/); assert.match(html, /MISSING_CONFIGURATION/); }
  assert.deepEqual(await fs.readdir(path.dirname(root)), [i.run.id], "no staging or backup copy remains");
  const finalized = await finalizeRunOutput({ runId: i.run.id, campaignKey: i.run.campaignKey, startedAt: new Date(stamp), completedAt: new Date(stamp), skipLegacyCopy: true });
  const artifacts = await indexArtifactsForRun({ runId: i.run.id, outputRoot: root, startedAtMs: Date.parse(stamp), completedAtMs: Date.parse(stamp) });
  const evidence = buildEvidenceMetadataForRun(i.run, artifacts); assert.ok(evidence.bundle); validateEvidenceManifest(i.run.id, evidence.bundle, evidence.items);
  assert.ok(evidence.items.every((item) => !/\.(zip|png|webm)$/.test(item.relativePath))); assert.ok(evidence.bundle.totalBytes < 110_000);
  assert.ok(!JSON.stringify(finalized.manifest).includes("trace.zip")); assert.ok(!(await fs.readFile(path.join(root, "run-results.json"), "utf8")).includes("heavy-inline-evidence"));
  assert.ok(evidence.items.some((item) => (item.metadata.executionDiagnostics as { state?: string })?.state === "available"));
  if (auth) { const resolved = await resolveAuthenticationMonitoringResult(i.run, artifacts, evidence.items, evidence.bundle);
    assert.equal(resolved.state, "available"); assert.deepEqual(resolved.result?.checks, authSummary().checks); }
});
test("failure, retry, timeout, unexpected warnings, infrastructure stderr, mutation and security preserve every diagnostic byte", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "routine-preservation-")); const before = process.env.INSSA_QA_REPO_ROOT; process.env.INSSA_QA_REPO_ROOT = temp;
  t.after(async () => { if (before === undefined) delete process.env.INSSA_QA_REPO_ROOT; else process.env.INSSA_QA_REPO_ROOT = before; await fs.rm(temp, { recursive: true, force: true }); });
  const root = path.join(temp, "run-output/run-1"); await fs.mkdir(path.join(root, "test-results"), { recursive: true }); const trace = Buffer.from("full failure trace with network diagnostics"); await fs.writeFile(path.join(root, "test-results/trace.zip"), trace);
  for (const change of [(i: RoutineEvidenceInput, _r: ReturnType<typeof report>) => { i.exitCode = 1; }, (i: RoutineEvidenceInput) => { i.interrupted = true; },
    (_i: RoutineEvidenceInput, r: ReturnType<typeof report>) => { r.suites[0].specs[0].tests[0].results[0].retry = 1; },
    (i: RoutineEvidenceInput) => { i.warningLines = ["WARNING: unexpected application issue"]; }, (i: RoutineEvidenceInput) => { i.stderrLines = ["Infrastructure failure"]; },
    (i: RoutineEvidenceInput) => { i.run.commandSnapshot.mutatesStaging = true; }, (i: RoutineEvidenceInput) => { i.run.campaignKey = "security_campaign"; }]) {
    const i = input(), r = report(); change(i, r); const body = JSON.stringify(r); await fs.writeFile(path.join(root, "playwright-results.json"), body);
    assert.equal(await reduceRoutineEvidence(i), null); assert.deepEqual(await fs.readFile(path.join(root, "test-results/trace.zip")), trace); assert.equal(await fs.readFile(path.join(root, "playwright-results.json"), "utf8"), body);
  }
});
test("password failure, provider timeout, missing summary and incomplete report cannot select lightweight mode", () => {
  const i = input(true), s = authSummary(); s.checks["username-password"].status = "failed"; assert.equal(routineEvidenceDecision(i, report(true), s), false);
  const timeout = authSummary(); timeout.checks["google-oauth"].status = "timed_out"; assert.equal(routineEvidenceDecision(i, report(true), timeout), false);
  assert.equal(routineEvidenceDecision(i, report(true), null), false); const bad = report(true); bad.errors.push("infrastructure" as never); assert.equal(routineEvidenceDecision(i, bad, authSummary()), false);
});

test("the exact hosted npm configuration notice is retained as metadata; every other warning keeps full diagnostics", () => {
  const i = input();
  i.warningLines = i.stderrLines = ["npm warn config production Use `--omit=dev` instead."];
  assert.equal(routineEvidenceDecision(i, report(), null), true);
  i.stderrLines = ["npm warn config production unexpected failure"];
  assert.equal(routineEvidenceDecision(i, report(), null), false);
});

test("nonempty or unresolved cleanup manifests cannot select lightweight mode even when marked not required", () => {
  const empty: NonNullable<RoutineEvidenceInput["run"]["cleanup"]> = { affectedUsers: [], automaticCleanupAvailable: false, confirmedAt: null, confirmedBy: null, createdArtifactIds: [],
    createdCapsuleIds: [], createdMediaIds: [], finalActionPerformed: false, instructions: [], lifecycleState: null, runId: "run-1", schemaVersion: 1, status: "not_required" };
  for (const patch of [{ status: "pending" }, { status: "completed" }, { createdMediaIds: ["media-1"] }, { affectedUsers: ["user-1"] },
    { retentionUntil: stamp }, { evidencePaths: ["cleanup.json"] }, { unexpectedData: true }, { finalActionPerformed: true },
    { runId: "another-run" }, { schemaVersion: 2 }, { relatedDefectId: "defect-1" }, { cleanupResult: "completed" }]) {
    const i = input(); i.run.cleanup = { ...empty, ...patch } as NonNullable<typeof i.run.cleanup>;
    assert.equal(routineEvidenceDecision(i, report(), null), false, JSON.stringify(patch));
  }
});

test("a retried final pass keeps failed-attempt evidence and durable retry metadata", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "retry-evidence-")), prior = process.env.INSSA_QA_REPO_ROOT;
  process.env.INSSA_QA_REPO_ROOT = temp;
  t.after(async () => { if (prior === undefined) delete process.env.INSSA_QA_REPO_ROOT; else process.env.INSSA_QA_REPO_ROOT = prior; await fs.rm(temp, { recursive: true, force: true }); });
  const i = input(), root = path.join(temp, "run-output", i.run.id), r = report();
  r.stats.flaky = 1;
  r.suites[0].specs[0].tests[0].results = [
    { status: "failed", retry: 0, duration: 40, attachments: [{ body: "initial failure screenshot" }] },
    { status: "passed", retry: 1, duration: 20, attachments: [] }
  ];
  await fs.mkdir(path.join(root, "test-results"), { recursive: true });
  await fs.writeFile(path.join(root, "playwright-results.json"), JSON.stringify(r));
  const trace = Buffer.from("failed-attempt trace"); await fs.writeFile(path.join(root, "test-results/trace.zip"), trace);
  assert.equal(await reduceRoutineEvidence(i), null);
  const artifacts = await indexArtifactsForRun({ runId: i.run.id, outputRoot: root, startedAtMs: Date.parse(stamp), completedAtMs: Date.parse(stamp) });
  const evidence = buildEvidenceMetadataForRun(i.run, artifacts);
  assert.ok(evidence.items.some((item) => JSON.stringify(item.metadata.executionDiagnostics) === JSON.stringify({ schemaVersion: 1, state: "available", retryUsed: true, flaky: true })));
  assert.deepEqual(await fs.readFile(path.join(root, "test-results/trace.zip")), trace);
});
