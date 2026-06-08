#!/usr/bin/env node

const { spawnSync } = require("child_process");
const { existsSync, statSync } = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DEFAULT_INGESTION_URL = "https://wazuh.kbeanprobo.com/inssa";

const REQUIRED_FILES = [
  "README.md",
  ".env.inssa.live-staging.example",
  "package.json",
  "scripts/siem/export-campaign-summary.js",
  "scripts/siem/normalize-findings.js",
  "scripts/siem/send-to-wazuh.js",
  "scripts/inssa/run-campaign-with-siem.js",
  "services/inssa-ingestion/server.js",
  "services/inssa-ingestion/inssa-ingestion.service",
  "services/inssa-ingestion/nginx-inssa-ingestion.conf",
  "docs/inssa-platform-operations.md",
  "docs/inssa-final-program-report.md",
  "docs/inssa-final-platform-status.md",
  "docs/inssa-siem-architecture.md",
  "docs/inssa-dashboard-engineering.md",
  "docs/inssa-alert-routing.md"
];

const REQUIRED_REPORTS = [
  "reports/siem/latest-siem-export.json",
  "reports/security/security-verification.html",
  "reports/security/cross-user-security.html",
  "reports/security/reveal-later-security.html"
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const checks = [];

  checks.push(checkFiles("required-files", REQUIRED_FILES));
  checks.push(checkFiles("report-files", REQUIRED_REPORTS, { warningOnly: true }));
  checks.push(runCommandCheck("siem-export", ["npm", "run", "siem:export"]));
  checks.push(runCommandCheck("siem-send-dry-run", ["npm", "run", "siem:send", "--", "--dry-run"]));
  checks.push(await checkIngestionReachability());
  checks.push(checkDashboardAssumptions());

  const failed = checks.filter((check) => check.status === "FAIL");
  const warnings = checks.filter((check) => check.status === "WARN");
  const verdict = failed.length ? "FAIL" : warnings.length ? "PASS WITH WARNINGS" : "PASS";

  console.log("\nINSSA Platform Healthcheck");
  console.log(`Verdict: ${verdict}`);
  for (const check of checks) {
    console.log(`- ${check.name}: ${check.status}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  if (verdict === "FAIL") {
    process.exitCode = 1;
  }
}

function checkFiles(name, files, options = {}) {
  const missing = files.filter((file) => !existsSync(path.resolve(ROOT, file)));
  if (missing.length) {
    return {
      name,
      status: options.warningOnly ? "WARN" : "FAIL",
      detail: `missing ${missing.length}: ${missing.join(", ")}`
    };
  }

  return {
    name,
    status: "PASS",
    detail: `${files.length} files present`
  };
}

function runCommandCheck(name, command) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    env: process.env,
    shell: false,
    encoding: "utf8"
  });

  if (result.error) {
    return { name, status: "FAIL", detail: result.error.message };
  }

  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
    return {
      name,
      status: "FAIL",
      detail: output.slice(0, 500) || `exit code ${result.status}`
    };
  }

  return {
    name,
    status: "PASS",
    detail: summarizeCommandOutput(result.stdout)
  };
}

async function checkIngestionReachability() {
  const url =
    process.env.PLATFORM_HEALTHCHECK_INGESTION_URL ||
    process.env.SIEM_WAZUH_URL ||
    process.env.WAZUH_WEBHOOK_URL ||
    process.env.WAZUH_URL ||
    DEFAULT_INGESTION_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);

    return {
      name: "ingestion-reachability",
      status: response.status < 500 ? "PASS" : "WARN",
      detail: `${url} returned HTTP ${response.status}`
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      name: "ingestion-reachability",
      status: "WARN",
      detail: `${url} not reachable from this environment: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function checkDashboardAssumptions() {
  const docsPresent = [
    "docs/inssa-dashboard-engineering.md",
    "docs/inssa-dashboard-runbook.md",
    "docs/inssa-alert-routing.md"
  ].every((file) => existsSync(path.resolve(ROOT, file)));

  const siemExportPath = path.resolve(ROOT, "reports/siem/latest-siem-export.json");
  const exportUpdated = existsSync(siemExportPath) && statSync(siemExportPath).size > 0;

  if (docsPresent && exportUpdated) {
    return {
      name: "dashboard-connectivity-assumptions",
      status: "WARN",
      detail: "dashboard design/docs and SIEM export exist; live dashboard visibility requires Wazuh UI access"
    };
  }

  return {
    name: "dashboard-connectivity-assumptions",
    status: "FAIL",
    detail: "dashboard docs or SIEM export missing"
  };
}

function summarizeCommandOutput(output) {
  const lines = String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-3).join(" | ") || "completed";
}
