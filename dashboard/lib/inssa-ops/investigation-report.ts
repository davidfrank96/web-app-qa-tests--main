import { redactInssaTextOutput } from "./redaction";
import type { AuthenticationMonitoringCheck, AuthenticationMonitoringSummary } from "../monitoring/authentication-result";
import type { InssaRunRecord } from "./types";

export const SUCCESS_EVIDENCE_PROFILE = "INVESTIGATION_READY_SUCCESS";
export type InvestigationStep = { title: string; duration: number; error?: string; steps?: InvestigationStep[] };
export type InvestigationResults = {
  schemaVersion: number; profile?: string; runId: string; campaignKey: string;
  environment?: string; startedAt?: string | null; completedAt?: string | null;
  stats: { startTime?: string; duration?: number; expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  notices: string[]; consoleSummary?: string[]; errorSummary?: string[];
  tests: { title: string; file: string; results: {
    outcome: string; status: string; retry: number; duration: number; project?: string; startTime?: string;
    steps?: InvestigationStep[]; errors?: string[]; stdout?: string[]; stderr?: string[];
  }[] }[];
  providerResults?: Record<string, AuthenticationMonitoringCheck>;
};
const escape = (value: unknown) => String(value ?? "Not recorded").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const duration = (ms: number | undefined) => typeof ms === "number" && Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "Not recorded";
const list = (lines: string[], empty: string) => lines.length ? `<ul>${lines.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`;
const steps = (items: InvestigationStep[]): string => `<ol>${items.map((step) => `<li>${escape(step.title)} <span class="muted">${duration(step.duration)}</span>${step.error ? `<p>${escape(step.error)}</p>` : ""}${step.steps?.length ? steps(step.steps) : ""}</li>`).join("")}</ol>`;

// A complete result report with inline styles and native details: no remote scripts,
// fonts, fetches or relative assets can disappear independently of its HTML.
export function renderInvestigationReport(results: InvestigationResults, legacy = false) {
  const providers = Object.entries(results.providerResults ?? {});
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Investigation report · ${escape(results.campaignKey)}</title><style>
body{font:16px/1.6 system-ui,sans-serif;color:#182536;background:#f2f5f8;margin:0}main{max-width:1100px;margin:auto;padding:36px 24px}h1{line-height:1.2;margin:12px 0}h2{margin-top:32px}h3{margin:0}p{margin:8px 0}.muted,small{color:#506074}.eyebrow{font-size:12px;letter-spacing:.08em}section,article{background:white;border:1px solid #d8e0e8;border-radius:12px;padding:20px;margin:14px 0}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}dt{font-size:12px;color:#506074}dd{margin:2px 0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #e2e8ef;vertical-align:top;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}li{overflow-wrap:anywhere}.notice{border-left:4px solid #b07910}code{font-size:13px;overflow-wrap:anywhere}a{color:#145999}@media(max-width:600px){main{padding:20px 12px}table{font-size:13px}th,td{padding:8px 4px}}
</style></head><body><main><p class="eyebrow">${legacy ? "PRESERVED HISTORICAL RESULTS" : SUCCESS_EVIDENCE_PROFILE}</p>
<h1>Investigation report</h1><p>${escape(results.campaignKey)}</p>
${legacy ? '<section class="notice"><strong>Historical report presentation restored</strong><p>This view uses the authentic structured results retained by Wave 4. Original traces, video, screenshots and unrecorded steps cannot be reconstructed. No historical test was rerun.</p></section>' : ""}
<section aria-label="Run correlation"><dl><div><dt>Run</dt><dd><code>${escape(results.runId)}</code></dd></div><div><dt>Campaign / environment</dt><dd>${escape(results.campaignKey)} / ${escape(results.environment)}</dd></div><div><dt>Started</dt><dd>${escape(results.startedAt ?? results.stats.startTime)}</dd></div><div><dt>Completed</dt><dd>${escape(results.completedAt)}</dd></div><div><dt>Test execution duration</dt><dd>${duration(results.stats.duration)}</dd></div><div><dt>Results</dt><dd>${results.tests.length} tests · ${escape(results.stats.flaky ?? 0)} flaky · ${escape(results.stats.skipped ?? 0)} skipped</dd></div></dl></section>
${providers.length ? `<h2>Provider outcomes</h2><section><table><thead><tr><th>Provider</th><th>Status</th><th>Duration</th><th>Reason / timing</th></tr></thead><tbody>${providers.map(([name, check]) => `<tr><td>${escape(name)}</td><td>${escape(check.status.toUpperCase())}</td><td>${duration(check.durationMs)}</td><td>${escape(check.error ?? "No provider error")}<br><small>${escape(check.startedAt)} → ${escape(check.completedAt)}</small></td></tr>`).join("")}</tbody></table></section>` : ""}
<h2>Warnings and notices</h2><section>${list(results.notices, "No warnings recorded.")}</section>
<h2>Test results and execution path</h2>${results.tests.map((test) => `<article><h3>${escape(test.title)}</h3><p class="muted">${escape(test.file)}</p>${test.results.map((result) => `<p><strong>${escape(result.status.toUpperCase())}</strong> · ${escape(result.outcome)} · ${duration(result.duration)} · Retry ${escape(result.retry)} · Project: ${escape(result.project)}</p><p class="muted">Started: ${escape(result.startTime)}</p><details open><summary>Recorded execution path</summary>${result.steps?.length ? steps(result.steps) : '<p class="muted">The test identity, attempt and final result are recorded above. This producer did not record individual steps.</p>'}</details>${result.errors?.length ? `<details open><summary>Error context</summary>${list(result.errors, "")}</details>` : ""}${result.stdout?.length || result.stderr?.length ? `<details><summary>Console output</summary>${list([...(result.stdout ?? []), ...(result.stderr ?? [])], "")}</details>` : ""}`).join("")}</article>`).join("")}
<h2>Console and error summary</h2><section>${list([...(results.consoleSummary ?? []), ...(results.errorSummary ?? [])], legacy ? "Additional console/error output was not retained in the historical summary." : "No additional console/error output recorded.")}</section>
<p class="muted">This report contains all its rendering assets. Timings and outcomes come from the stored run and test results.</p></main></body></html>`;
  return redactInssaTextOutput(Buffer.from(html));
}

// Read-only compatibility for the exact Wave 4 report format. Stored bytes and hashes
// remain unchanged, and the correlation must agree with the durable run record.
export function restoreLegacyRoutineReport(file: Buffer, run: InssaRunRecord | null): Buffer {
  const text = file.toString("utf8");
  if (!run || !text.includes("<p>Routine evidence summary</p><pre>")) return file;
  try {
    const encoded = text.match(/<p>Routine evidence summary<\/p><pre>([\s\S]*?)<\/pre>/)?.[1];
    if (!encoded) return file;
    const results = JSON.parse(encoded.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")) as InvestigationResults;
    if (results.schemaVersion !== 1 || results.runId !== run.id || results.campaignKey !== run.campaignKey ||
        !Array.isArray(results.tests) || !results.tests.length || !Array.isArray(results.notices) || !results.stats) return file;
    return Buffer.from(renderInvestigationReport({ ...results, environment: run.commandSnapshot.targetEnvironment ?? "staging",
      startedAt: run.startedAt, completedAt: run.completedAt }, true));
  } catch { return file; }
}

export function providerResults(auth: AuthenticationMonitoringSummary | null) {
  return auth ? { providerResults: auth.checks } : {};
}
