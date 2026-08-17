const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const process = require("node:process");
const {
  authenticationMonitorConfiguration,
  parseMethodSelection,
  sanitizedConfigurationLines
} = require("./authentication-monitoring-config");
const { overallStatusFor } = require("./authentication-monitoring-policy");

const repoRoot = path.resolve(__dirname, "..", "..");
const dashboardRoot = path.join(repoRoot, "dashboard");
const dashboardRequire = createRequire(path.join(dashboardRoot, "package.json"));
const { loadEnvConfig } = dashboardRequire("@next/env");

loadEnvConfig(dashboardRoot, process.env.INSSA_DASHBOARD_MODE !== "start");

const TARGETS = {
  production: "https://inssa.us",
  staging: "https://staging.inssa.us"
};
const METHODS = ["username-password", "google-oauth", "apple-sign-in"];
const environment = process.argv[2] || "staging";
let requestedMethods;

try {
  requestedMethods = parseMethodSelection(process.argv.slice(3));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

if (!(environment in TARGETS)) {
  process.stderr.write(`Unsupported authentication monitoring environment: ${environment}\n`);
  process.exit(2);
}

const targetUrl = TARGETS[environment];
const runId = resolveRunId();
const outputRoot = process.env.INSSA_RUN_OUTPUT_DIR
  ? path.join(process.env.INSSA_RUN_OUTPUT_DIR, "authentication-monitoring")
  : path.join(repoRoot, "reports", "authentication-monitoring", environment, runId);
const playwrightReportRoot = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR || path.join(outputRoot, "playwright-report");

fs.mkdirSync(outputRoot, { recursive: true });

const configuration = authenticationMonitorConfiguration(process.env, environment);
for (const line of sanitizedConfigurationLines(configuration)) process.stdout.write(`${line}\n`);
fs.writeFileSync(
  path.join(outputRoot, "authentication-monitoring-preflight.json"),
  `${JSON.stringify(configuration, null, 2)}\n`,
  "utf8"
);

if (environment === "production" && !productionIsConfirmed()) {
  const message = "Production authentication monitoring is blocked. Set AUTH_MONITOR_ALLOW_PRODUCTION=1 and confirm host inssa.us.";
  writeSummary(METHODS.map((method) => failedResult(method, message)));
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const playwrightBinary = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright"
);
const command = fs.existsSync(playwrightBinary) ? playwrightBinary : process.platform === "win32" ? "npx.cmd" : "npx";
const args = fs.existsSync(playwrightBinary)
  ? ["test", "tests/inssa/authentication-monitoring.spec.ts", "--project=inssa-chrome", "--workers=1", "--retries=0", "--trace=retain-on-failure"]
  : ["playwright", "test", "tests/inssa/authentication-monitoring.spec.ts", "--project=inssa-chrome", "--workers=1", "--retries=0", "--trace=retain-on-failure"];

const startedAt = new Date();
const child = spawnSync(command, args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    AUTH_MONITOR_RUN_ID: runId,
    AUTH_MONITOR_ENVIRONMENT: environment,
    ...(requestedMethods
      ? { [environment === "production" ? "AUTH_MONITOR_PRODUCTION_METHODS" : "AUTH_MONITOR_STAGING_METHODS"]: requestedMethods.join(",") }
      : {}),
    AUTH_MONITOR_OUTPUT_DIR: outputRoot,
    INSSA_URL: targetUrl,
    PLAYWRIGHT_HTML_OPEN: "never",
    PLAYWRIGHT_HTML_OUTPUT_DIR: playwrightReportRoot,
    PLAYWRIGHT_OUTPUT_DIR: process.env.PLAYWRIGHT_OUTPUT_DIR || path.join(outputRoot, "test-results")
  },
  shell: false,
  stdio: "inherit"
});

const results = METHODS.map((method) => readResult(method));
const summary = writeSummary(results, startedAt);
process.stdout.write(
  `${summary.overallStatus === "degraded" ? "WARNING: " : ""}Authentication monitoring ${environment}: ` +
    `overall=${summary.overallStatus}, checks=${results.map((result) => `${result.method}:${result.status}`).join(",")}\n`
);

if (child.error) {
  process.stderr.write(`Authentication monitoring process failed to start: ${child.error.message}\n`);
  process.exit(1);
}
process.exit(summary.overallStatus === "failed" ? 1 : 0);

function productionIsConfirmed() {
  return process.env.AUTH_MONITOR_ALLOW_PRODUCTION === "1" &&
    process.env.AUTH_MONITOR_PRODUCTION_CONFIRMATION?.trim().toLowerCase() === "inssa.us";
}

function resolveRunId() {
  const explicitRunId = process.env.AUTH_MONITOR_RUN_ID?.trim();
  if (explicitRunId) return explicitRunId;
  const runOutputRoot = process.env.INSSA_RUN_OUTPUT_DIR?.trim();
  if (runOutputRoot) return path.basename(path.resolve(runOutputRoot));
  return crypto.randomUUID();
}

function readResult(method) {
  const resultPath = path.join(outputRoot, method, "result.json");
  try {
    return JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch {
    const result = failedResult(method, `Authentication check did not produce ${path.relative(repoRoot, resultPath)}.`);
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  }
}

function failedResult(method, error) {
  const timestamp = new Date().toISOString();
  return {
    completedAt: timestamp,
    durationMs: 0,
    error,
    method,
    startedAt: timestamp,
    status: "failed"
  };
}

function writeSummary(results, startedAt = new Date()) {
  const completedAt = new Date();
  const summary = {
    checks: Object.fromEntries(results.map((result) => [result.method, result])),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    environment,
    evidenceReferences: {
      checks: Object.fromEntries(METHODS.map((method) => [method, providerEvidenceReferences(method)])),
      report: relativeEvidencePath(path.join(playwrightReportRoot, "index.html")),
      summary: relativeEvidencePath(path.join(outputRoot, "authentication-monitoring-summary.json"))
    },
    overallStatus: overallStatusFor(results),
    runId,
    schemaVersion: 2,
    startedAt: startedAt.toISOString(),
    targetHost: new URL(targetUrl).hostname
  };
  fs.writeFileSync(path.join(outputRoot, "authentication-monitoring-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  if (fs.existsSync(playwrightReportRoot)) {
    fs.writeFileSync(path.join(playwrightReportRoot, "authentication-monitoring-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  return summary;
}

function relativeEvidencePath(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function providerEvidenceReferences(method) {
  const methodRoot = path.join(outputRoot, method);
  const references = {
    result: relativeEvidencePath(path.join(methodRoot, "result.json"))
  };
  const optionalFiles = [
    ["consoleLog", "console-log.json"],
    ["screenshot", "screenshot.png"]
  ];
  for (const [key, fileName] of optionalFiles) {
    const candidate = path.join(methodRoot, fileName);
    if (fs.existsSync(candidate)) references[key] = relativeEvidencePath(candidate);
  }
  return references;
}
