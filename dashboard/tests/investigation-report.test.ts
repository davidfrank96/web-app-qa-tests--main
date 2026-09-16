import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./fixtures/retention";
import { renderInvestigationReport, restoreLegacyRoutineReport, type InvestigationResults } from "../lib/inssa-ops/investigation-report";
const results: InvestigationResults = { schemaVersion: 1, runId: "run-1", campaignKey: "test_inssa_safe", stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 1234 }, notices: ["Known runtime notice"],
  tests: [{ title: "Navigation <script>alert(1)</script>", file: "safe.spec.ts", results: [{ outcome: "expected", status: "passed", retry: 0, duration: 1234,
    project: "inssa-chrome", steps: [{ title: "Open page", duration: 800 }, { title: "Assert result", duration: 434 }] }] }] };
test("self-contained investigation report exposes identity, timings, steps and warnings with safe HTML", () => {
  const html = renderInvestigationReport(results);
  for (const value of ["run-1", "safe.spec.ts", "inssa-chrome", "1.23 s", "Open page", "Assert result", "Known runtime notice"]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /<script>|(?:src|href)=["']|url\(/); assert.match(html, /&lt;script&gt;/);
});
test("historical Wave 4 report is restored read-only from authentic results, with missing detail disclosed", () => {
  const encoded = JSON.stringify(results).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const original = Buffer.from(`<html><p>Routine evidence summary</p><pre>${encoded}</pre></html>`);
  const before = Buffer.from(original), run = fixture().runs[0];
  const restored = restoreLegacyRoutineReport(original, run).toString();
  assert.match(restored, /Historical report presentation restored/); assert.match(restored, /cannot be reconstructed/); assert.match(restored, /1.23 s/);
  assert.deepEqual(original, before);
  assert.deepEqual(restoreLegacyRoutineReport(original, { ...run, id: "wrong-run" }), original);
  assert.deepEqual(restoreLegacyRoutineReport(Buffer.from("<html>Original full report</html>"), run), Buffer.from("<html>Original full report</html>"));
});
