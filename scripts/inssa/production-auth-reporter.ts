import fs from "node:fs";
import path from "node:path";
import type { FullResult, Reporter, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { redactInssaLogLine } from "../../dashboard/lib/inssa-ops/redaction";

export function sanitizeProductionReportText(value: string) {
  let text = redactInssaLogLine(value);
  for (const [key, secret] of Object.entries(process.env)) {
    if (/PASSWORD|TOKEN|SECRET|API_KEY|AUTH_MONITOR_.*EMAIL/.test(key) && secret && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  return text;
}
// Production never invokes the stock HTML/JSON reporters: their action parameters and
// trace archives can contain credential inputs. Preserve safe outcomes, timings and errors.
export default class ProductionAuthReporter implements Reporter {
  private specs: object[] = [];
  private errors: { message: string }[] = [];
  private expected = 0;
  private unexpected = 0;
  private skipped = 0;
  onError(error: TestError) { this.errors.push({ message: sanitizeProductionReportText(error.message ?? "Monitor infrastructure error") }); }
  onTestEnd(test: TestCase, result: TestResult) {
    const expected = result.status === "passed";
    if (result.status === "skipped") this.skipped++; else if (expected) this.expected++; else this.unexpected++;
    this.specs.push({ title: test.title, file: "tests/inssa/authentication-monitoring.spec.ts", tests: [{
      status: expected ? "expected" : "unexpected", projectName: "inssa-chrome", results: [{ status: result.status,
        retry: result.retry, duration: result.duration, startTime: result.startTime.toISOString(),
        errors: result.errors.map(error => ({ message: sanitizeProductionReportText(error.message ?? "Authentication check failed") })),
        // Browser-level HAR, console and masked screenshots are captured separately by the test.
        stdout: [], stderr: [], steps: []
      }] }] });
    process.stdout.write(`Production authentication provider ${test.title}: ${result.status}\n`);
  }
  onEnd(result: FullResult) {
    const report = { suites: [{ specs: this.specs }], errors: this.errors,
      stats: { expected: this.expected, unexpected: this.unexpected, skipped: this.skipped, flaky: 0,
        startTime: result.startTime.toISOString(), duration: result.duration } };
    const root = process.env.AUTH_MONITOR_OUTPUT_DIR;
    if (!root) throw new Error("Production evidence output directory required");
    const jsonPath = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? path.join(root, "playwright-results.json");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(jsonPath, json + "\n");
    const htmlRoot = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? path.join(root, "playwright-report");
    fs.mkdirSync(htmlRoot, { recursive: true });
    const escaped = json.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    fs.writeFileSync(path.join(htmlRoot, "index.html"), `<!doctype html><meta charset="utf-8"><title>Production authentication diagnostics</title><h1>Production authentication diagnostics</h1><p>Provider outcomes, timing and redacted errors. Masked screenshots, sanitized network metadata and console diagnostics accompany this report. Raw credential-bearing traces and video are disabled.</p><pre>${escaped}</pre>`);
  }
}
