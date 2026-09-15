import { getInssaPhase1Command } from "./command-registry";
import fs from "node:fs/promises";
import path from "node:path";
import { getRunOutputRoot } from "./paths";
import { parseAuthenticationMonitoringSummary, type AuthenticationMonitoringSummary } from "../monitoring/authentication-result";
import type { InssaRunRecord } from "./types";

type Result = { status: string; retry: number; duration: number };
type Spec = { title: string; file: string; tests: { status: string; results: Result[] }[] };
type Suite = { suites?: Suite[]; specs?: Spec[] };
type Report = { suites: Suite[]; errors: unknown[]; stats: { flaky: number; skipped: number; unexpected: number; expected: number } };
export type RoutineEvidenceInput = {
  run: InssaRunRecord; exitCode: number | null; interrupted: boolean; warningLines: string[]; stderrLines: string[];
};
const METHODS = { "Username & Password": "username-password", "Google OAuth": "google-oauth", "Apple Sign-In": "apple-sign-in" } as const;
function specs(suites: Suite[]): Spec[] { return suites.flatMap((suite) => [...(suite.specs ?? []), ...specs(suite.suites ?? [])]); }

export function routineEvidenceDecision(input: RoutineEvidenceInput, report: Report, auth: AuthenticationMonitoringSummary | null) {
  const command = input.run.commandSnapshot;
  const known = getInssaPhase1Command(input.run.campaignKey);
  if (!known || command.key !== input.run.campaignKey || command.npmScript !== known.npmScript || command.riskLevel !== known.riskLevel) return false;
  if (input.exitCode !== 0 || input.interrupted || command.mutatesStaging || command.cleanupRequired || command.requiresSecondaryAccount || input.run.cleanup ||
      !["test_inssa_safe", "monitor_inssa_auth_staging", "monitor_inssa_auth_production"].includes(input.run.campaignKey)) return false;
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length || !report.stats ||
      report.stats.flaky !== 0 || report.stats.skipped !== 0 || input.stderrLines.length) return false;
  const all = specs(report.suites);
  if (!all.length || !Number.isInteger(report.stats.expected) || !Number.isInteger(report.stats.unexpected) ||
      report.stats.expected + report.stats.unexpected !== all.reduce((n, s) => n + s.tests.length, 0) || all.some((s) => !s.tests.length || s.tests.some((t) => t.results.length !== 1 || t.results[0].retry !== 0 || !Number.isFinite(t.results[0].duration) || t.results[0].duration < 0 ||
      !["passed", "failed"].includes(t.results[0].status) || !["expected", "unexpected"].includes(t.status)))) return false;
  if (input.run.campaignKey === "test_inssa_safe") return input.warningLines.length === 0 && report.stats.unexpected === 0 &&
    all.every((s) => s.tests.every((t) => t.status === "expected" && t.results[0].status === "passed"));
  if (!auth || auth.runId !== input.run.id || auth.environment !== (input.run.campaignKey.endsWith("_production") ? "production" : "staging") || !["passed", "degraded"].includes(auth.overallStatus) ||
      auth.checks["username-password"].status !== "passed" || !["passed", "blocked_external"].includes(auth.checks["google-oauth"].status) ||
      !["passed", "missing_configuration"].includes(auth.checks["apple-sign-in"].status) || all.length !== 3) return false;
  const expectedWarning = `WARNING: Authentication monitoring ${auth.environment}: overall=degraded, checks=` +
    Object.values(METHODS).map((method) => `${method}:${auth.checks[method].status}`).join(",");
  if (input.warningLines.some((line) => line.trim() !== expectedWarning)) return false;
  return new Set(all.map((s) => s.title)).size === 3 && all.every((s) => {
    const method = METHODS[s.title as keyof typeof METHODS]; if (!method || s.tests.length !== 1) return false;
    const expectedPass = auth.checks[method].status === "passed";
    return s.tests[0].results[0].status === (expectedPass ? "passed" : "failed") && s.tests[0].status === (expectedPass ? "expected" : "unexpected");
  });
}

// Only unpublished, quiescent output belonging to this run is reduced. Failure, retry,
// security, cleanup, warning or incomplete-report paths return without changing any byte.
export async function reduceRoutineEvidence(input: RoutineEvidenceInput) {
  const root = getRunOutputRoot(input.run.id);
  let report: Report; let auth: AuthenticationMonitoringSummary | null = null;
  try {
    report = JSON.parse(await fs.readFile(path.join(root, "playwright-results.json"), "utf8"));
    if (input.run.campaignKey.startsWith("monitor_inssa_auth_")) auth = parseAuthenticationMonitoringSummary(JSON.parse(
      await fs.readFile(path.join(root, "authentication-monitoring/authentication-monitoring-summary.json"), "utf8")));
    if (!routineEvidenceDecision(input, report, auth)) return null;
  } catch { return null; }
  const files = await collectFiles(root);
  // Symlinks or files outside the expected output layout indicate an unrecognized producer.
  if (files.some((file) => !/^(playwright-report\/|test-results\/|authentication-monitoring\/|evidence-manifest\.json$|playwright-results\.json$)/.test(file))) return null;
  const beforeBytes = (await Promise.all(files.map(async (file) => (await fs.stat(path.join(root, file))).size))).reduce((a, b) => a + b, 0);
  const results = { schemaVersion: 1, runId: input.run.id, campaignKey: input.run.campaignKey, stats: report.stats,
    tests: specs(report.suites).map((s) => ({ title: s.title, file: s.file, results: s.tests.map((t) => ({ outcome: t.status, status: t.results[0].status, retry: t.results[0].retry, duration: t.results[0].duration })) })) };
  const output = new Map<string, string>();
  output.set("run-results.json", JSON.stringify(results, null, 2) + "\n");
  const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  output.set("playwright-report/index.html", `<!doctype html><html lang="en"><meta charset="utf-8"><title>Run results</title><body><h1>Run results</h1><p>Routine evidence summary</p><pre>${escape(JSON.stringify({ ...results, ...(auth ? { providerResults: auth.checks } : {}) }, null, 2))}</pre></body></html>`);
  if (auth) {
    // The parsed provider summary is retained exactly; remove references to deliberately discarded diagnostics.
    const summary = { ...auth }; delete summary.evidenceReferences;
    output.set("authentication-monitoring/authentication-monitoring-summary.json", JSON.stringify(summary, null, 2) + "\n");
    for (const [method, result] of Object.entries(auth.checks)) output.set(`authentication-monitoring/${method}/result.json`, JSON.stringify(result, null, 2) + "\n");
  }
  // Stage the complete reduced tree first. A rename failure restores the original tree.
  const staged = `${root}.routine-${crypto.randomUUID()}`, backup = `${root}.unpublished-${crypto.randomUUID()}`;
  let moved = false, installed = false;
  try {
    await fs.mkdir(staged, { recursive: true });
    for (const [file, content] of output) { await fs.mkdir(path.dirname(path.join(staged, file)), { recursive: true }); await fs.writeFile(path.join(staged, file), content); }
    const footprint = { mode: "routine_summary", beforeBytes, summaryBytes: [...output.values()].reduce((n, value) => n + Buffer.byteLength(value), 0),
      originalFiles: files.length, retainedFiles: output.size + 2, reason: auth ? "Known provider outcomes; no retry or unexpected warning" : "All tests passed without retries or warnings" };
    await fs.writeFile(path.join(staged, "evidence-footprint.json"), JSON.stringify(footprint, null, 2) + "\n");
    await fs.rename(root, backup); moved = true;
    await fs.rename(staged, root); installed = true;
    await fs.rm(backup, { recursive: true, force: true });
    return footprint;
  } catch (error) {
    if (moved && !installed) await fs.rename(backup, root);
    throw error;
  } finally { await fs.rm(staged, { recursive: true, force: true }); }
}
async function collectFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) return ["UNRECOGNIZED_SYMLINK"];
    if (entry.isDirectory()) files.push(...await collectFiles(root, `${file}/`)); else files.push(file);
  }
  return files;
}
