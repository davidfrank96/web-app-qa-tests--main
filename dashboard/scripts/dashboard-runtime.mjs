#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const dashboardRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const nextDir = path.join(dashboardRoot, ".next");

const REQUIRED_APP_ROUTES = [
  "/page",
  "/login/page"
];

const REQUIRED_ROUTE_BUNDLES = [
  "app/api/campaign-definitions/route.js",
  "app/api/runs/route.js",
  "app/api/runs/[id]/route.js",
  "app/api/runs/[id]/logs/route.js",
  "app/api/runs/[id]/artifacts/route.js",
  "app/api/artifacts/[id]/route.js",
  "app/api/artifacts/[id]/file/route.js"
];

const REQUIRED_PAGES_ROUTES = ["/_app", "/_error", "/_document"];

const REQUIRED_ROOT_SCRIPTS = [
  "test:inssa:safe",
  "test:inssa:campaign:security",
  "test:inssa:campaign:security:verify",
  "report:security",
  "report:lifecycle",
  "siem:export",
  "platform:healthcheck"
];

const LEVELS = {
  PASS: 0,
  WARN: 1,
  FAIL: 2
};

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--clean")) {
    cleanRuntimeArtifacts();
    return;
  }

  const startup = args.has("--startup");
  const mode = readArgValue("--mode") ?? "doctor";
  const result = runDoctor({ mode, startup });
  printResult(result, { mode, startup });

  if (result.status === "FAIL") {
    process.exitCode = 1;
  }
}

function readArgValue(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] ?? null;
  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function runDoctor({ mode, startup }) {
  loadEnvFiles();

  const checks = [
    checkNodeVersion(),
    checkPackageIntegrity(),
    checkNextVersion(),
    checkNextIntegrity({ mode, startup }),
    checkEnvironment(),
    checkSupabaseConfig(),
    checkRunnerPrerequisites(),
    checkPlaywrightInstallation()
  ];

  const status = checks.reduce((current, check) => {
    return LEVELS[check.status] > LEVELS[current] ? check.status : current;
  }, "PASS");

  return { checks, status };
}

function loadEnvFiles() {
  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.local"),
    path.join(dashboardRoot, ".env"),
    path.join(dashboardRoot, ".env.local")
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = line.slice(0, equalsIndex).trim();
      let value = line.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

function checkNodeVersion() {
  const version = process.versions.node;
  const [major, minor] = version.split(".").map((part) => Number(part));
  const ok = major > 18 || (major === 18 && minor >= 18);
  return makeCheck(
    "Node version",
    ok ? "PASS" : "FAIL",
    `Detected Node ${version}. Next.js 15 requires Node 18.18 or newer.`,
    ok ? null : "Install a supported Node runtime before starting the dashboard."
  );
}

function checkPackageIntegrity() {
  const dashboardPackage = readJson(path.join(dashboardRoot, "package.json"));
  const rootPackage = readJson(path.join(repoRoot, "package.json"));
  const dashboardLockExists = fs.existsSync(path.join(dashboardRoot, "package-lock.json"));
  const dashboardNodeModulesExists = fs.existsSync(path.join(dashboardRoot, "node_modules"));
  const rootNodeModulesExists = fs.existsSync(path.join(repoRoot, "node_modules"));

  const missing = [];
  if (!dashboardPackage.ok) missing.push("dashboard/package.json");
  if (!rootPackage.ok) missing.push("package.json");
  if (!dashboardLockExists) missing.push("dashboard/package-lock.json");
  if (!dashboardNodeModulesExists) missing.push("dashboard/node_modules");
  if (!rootNodeModulesExists) missing.push("node_modules");

  return makeCheck(
    "Package integrity",
    missing.length ? "FAIL" : "PASS",
    missing.length ? `Missing or unreadable: ${missing.join(", ")}.` : "Dashboard and repo package metadata are present.",
    missing.length ? "Run npm install at the repo root and inside dashboard if dependencies are missing." : null
  );
}

function checkNextVersion() {
  const installedNext = readJson(path.join(dashboardRoot, "node_modules", "next", "package.json"));
  const declaredPackage = readJson(path.join(dashboardRoot, "package.json"));
  if (!installedNext.ok) {
    return makeCheck(
      "Next version",
      "FAIL",
      "Installed Next.js package metadata is missing.",
      "Run npm --prefix dashboard install."
    );
  }

  const declared = declaredPackage.ok ? declaredPackage.data.dependencies?.next : null;
  return makeCheck(
    "Next version",
    "PASS",
    `Installed Next.js ${installedNext.data.version}; declared dependency ${declared ?? "unknown"}.`,
    null
  );
}

function checkNextIntegrity({ mode, startup }) {
  if (mode === "dev") {
    return checkDevRuntimeState();
  }

  return checkProductionRuntimeState({ startup });
}

function checkDevRuntimeState() {
  if (!fs.existsSync(nextDir)) {
    return makeCheck(
      "Next runtime",
      "PASS",
      ".next does not exist. next dev will create development artifacts.",
      null
    );
  }

  const buildIdExists = fs.existsSync(path.join(nextDir, "BUILD_ID"));
  const buildManifest = readJson(path.join(nextDir, "build-manifest.json"));
  const pagesManifest = readJson(path.join(nextDir, "server", "pages-manifest.json"));
  const productionLike =
    buildIdExists &&
    buildManifest.ok &&
    Boolean(buildManifest.data.pages?.["/_app"]) &&
    Boolean(buildManifest.data.pages?.["/_error"]) &&
    pagesManifest.ok &&
    Boolean(pagesManifest.data["/_document"]);

  if (productionLike) {
    return makeCheck(
      "Next runtime",
      "WARN",
      "Production .next artifacts are present before next dev startup.",
      "This is usually safe, but run npm run dashboard:clean if dev reloads show stale chunk or manifest errors."
    );
  }

  return makeCheck(
    "Next runtime",
    "PASS",
    "Development startup is allowed. Existing .next artifacts are not production-complete.",
    null
  );
}

function checkProductionRuntimeState({ startup }) {
  if (!fs.existsSync(nextDir)) {
    return makeCheck(
      "Next runtime",
      startup ? "FAIL" : "WARN",
      ".next does not exist.",
      "Run npm run dashboard:build before npm run dashboard:start."
    );
  }

  const requiredFiles = [
    "BUILD_ID",
    "build-manifest.json",
    "routes-manifest.json",
    path.join("server", "pages-manifest.json"),
    path.join("server", "app-paths-manifest.json")
  ];
  const missingFiles = requiredFiles.filter((filePath) => !fs.existsSync(path.join(nextDir, filePath)));

  const buildManifest = readJson(path.join(nextDir, "build-manifest.json"));
  const routesManifest = readJson(path.join(nextDir, "routes-manifest.json"));
  const pagesManifest = readJson(path.join(nextDir, "server", "pages-manifest.json"));
  const appPathsManifest = readJson(path.join(nextDir, "server", "app-paths-manifest.json"));

  const problems = [];
  const actions = [];

  if (missingFiles.length) {
    problems.push(`Missing runtime files: ${missingFiles.join(", ")}.`);
  }

  if (!buildManifest.ok) {
    problems.push(`build-manifest.json is unreadable: ${buildManifest.error}.`);
  } else {
    if (!buildManifest.data.pages) {
      problems.push("build-manifest.json has no pages map. This causes /_app runtime crashes.");
    } else {
      for (const pageRoute of ["/_app", "/_error"]) {
        if (!Array.isArray(buildManifest.data.pages[pageRoute])) {
          problems.push(`build-manifest.json is missing ${pageRoute}.`);
        }
      }
    }
  }

  if (!routesManifest.ok) {
    problems.push(`routes-manifest.json is unreadable: ${routesManifest.error}.`);
  }

  if (!pagesManifest.ok) {
    problems.push(`pages-manifest.json is unreadable: ${pagesManifest.error}.`);
  } else {
    for (const pageRoute of REQUIRED_PAGES_ROUTES) {
      if (!pagesManifest.data[pageRoute]) {
        problems.push(`pages-manifest.json is missing ${pageRoute}.`);
      }
    }
  }

  if (!appPathsManifest.ok) {
    problems.push(`app-paths-manifest.json is unreadable: ${appPathsManifest.error}.`);
  } else {
    for (const appRoute of REQUIRED_APP_ROUTES) {
      if (!appPathsManifest.data[appRoute]) {
        problems.push(`app-paths-manifest.json is missing ${appRoute}.`);
      }
    }
  }

  const bundleProblems = checkRequiredRouteBundles();
  problems.push(...bundleProblems);
  const chunkProblems = checkServerChunkLoader();
  problems.push(...chunkProblems);

  if (problems.length) {
    actions.push("Run npm run dashboard:clean, then npm run dashboard:build, then npm run dashboard:start.");
  }

  return makeCheck(
    "Next runtime",
    problems.length ? "FAIL" : "PASS",
    problems.length ? problems.join(" ") : "Production .next manifests and required route bundles are valid.",
    actions.length ? actions.join(" ") : null
  );
}

function checkRequiredRouteBundles() {
  const problems = [];
  for (const bundlePath of REQUIRED_ROUTE_BUNDLES) {
    if (!fs.existsSync(path.join(nextDir, "server", bundlePath))) {
      problems.push(`Compiled route bundle is missing: ${bundlePath}.`);
    }
  }
  return problems;
}

function checkServerChunkLoader() {
  const runtimePath = path.join(nextDir, "server", "webpack-runtime.js");
  if (!fs.existsSync(runtimePath)) return ["webpack-runtime.js is missing."];

  const runtimeSource = fs.readFileSync(runtimePath, "utf8");
  if (!runtimeSource.includes('require("./chunks/"+') && !runtimeSource.includes('require("./chunks/" +')) {
    return [
      "webpack-runtime.js does not load server chunks from ./chunks/. This causes production API routes to fail with missing chunk modules."
    ];
  }

  const chunksDir = path.join(nextDir, "server", "chunks");
  if (!fs.existsSync(chunksDir)) return ["server/chunks directory is missing."];

  const serverChunkFiles = fs
    .readdirSync(chunksDir)
    .filter((fileName) => fileName.endsWith(".js"));
  if (!serverChunkFiles.length) return ["server/chunks contains no JavaScript chunk files."];

  return [];
}

function checkEnvironment() {
  const rawUrl = process.env.INSSA_URL?.trim();
  if (!rawUrl) {
    return makeCheck(
      "Environment",
      "WARN",
      "INSSA_URL is not configured. Dashboard can start, but command execution will be blocked.",
      "Set INSSA_URL=https://staging.inssa.us before executing dashboard commands."
    );
  }

  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" && url.hostname === "staging.inssa.us") {
      return makeCheck("Environment", "PASS", "INSSA_URL targets staging.inssa.us.", null);
    }
    return makeCheck(
      "Environment",
      "FAIL",
      `INSSA_URL is ${url.origin}. Dashboard command execution must never target production or unknown hosts.`,
      "Set INSSA_URL=https://staging.inssa.us."
    );
  } catch {
    return makeCheck(
      "Environment",
      "FAIL",
      "INSSA_URL is present but not a valid URL.",
      "Set INSSA_URL=https://staging.inssa.us."
    );
  }
}

function checkSupabaseConfig() {
  const browserUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const browserKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [];
  if (!browserUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
  if (!browserKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY");

  if (missing.length) {
    return makeCheck(
      "Supabase configuration",
      "WARN",
      `Supabase Auth is not fully configured. Missing: ${missing.join(", ")}.`,
      "Set dashboard/.env.local with the Supabase URL and publishable key before using login."
    );
  }

  try {
    const parsed = new URL(browserUrl);
    if (!parsed.hostname.endsWith(".supabase.co") && !parsed.hostname.includes("localhost")) {
      return makeCheck(
        "Supabase configuration",
        "WARN",
        "Supabase URL is present but does not look like a standard Supabase project URL.",
        "Verify dashboard/.env.local before relying on authentication."
      );
    }
  } catch {
    return makeCheck(
      "Supabase configuration",
      "FAIL",
      "Supabase URL is present but invalid.",
      "Fix NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL."
    );
  }

  return makeCheck(
    "Supabase configuration",
    serviceKey ? "PASS" : "WARN",
    serviceKey
      ? "Supabase browser and service credentials are configured."
      : "Supabase browser credentials are configured; service role key is not set.",
    serviceKey ? null : "Metadata may fall back to anon/local behavior unless SUPABASE_SERVICE_ROLE_KEY is configured."
  );
}

function checkRunnerPrerequisites() {
  const rootPackage = readJson(path.join(repoRoot, "package.json"));
  if (!rootPackage.ok) {
    return makeCheck(
      "Runner prerequisites",
      "FAIL",
      "Root package.json is unreadable.",
      "Restore package.json before using the dashboard runner."
    );
  }

  const scripts = rootPackage.data.scripts ?? {};
  const missingScripts = REQUIRED_ROOT_SCRIPTS.filter((script) => !scripts[script]);
  const requiredDirs = [
    "tests/inssa",
    "scripts/inssa",
    "scripts/siem",
    "dashboard/.data"
  ];
  const missingDirs = requiredDirs.filter((dir) => !fs.existsSync(path.join(repoRoot, dir)));

  const problems = [];
  if (missingScripts.length) problems.push(`Missing npm scripts: ${missingScripts.join(", ")}.`);
  if (missingDirs.length) problems.push(`Missing directories: ${missingDirs.join(", ")}.`);

  return makeCheck(
    "Runner prerequisites",
    problems.length ? "FAIL" : "PASS",
    problems.length ? problems.join(" ") : "Runner scripts and metadata directory are present.",
    problems.length ? "Restore runner scripts/directories before executing dashboard commands." : null
  );
}

function checkPlaywrightInstallation() {
  const packagePath = path.join(repoRoot, "node_modules", "@playwright", "test", "package.json");
  const playwrightPackage = readJson(packagePath);
  const binaryPath = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");

  if (!playwrightPackage.ok || !fs.existsSync(binaryPath)) {
    return makeCheck(
      "Playwright installation",
      "FAIL",
      "Playwright package or binary is missing from root node_modules.",
      "Run npm install and npm run install:browsers."
    );
  }

  const versionCheck = spawnSync(binaryPath, ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false
  });

  if (versionCheck.status !== 0) {
    return makeCheck(
      "Playwright installation",
      "WARN",
      "Playwright package is installed, but the CLI version check failed.",
      "Run npm run install:browsers if browser execution fails."
    );
  }

  return makeCheck(
    "Playwright installation",
    "PASS",
    versionCheck.stdout.trim() || `Playwright ${playwrightPackage.data.version} is installed.`,
    null
  );
}

function cleanRuntimeArtifacts() {
  if (!fs.existsSync(nextDir)) {
    console.log("dashboard:clean PASS");
    console.log(`No runtime artifacts found at ${path.relative(repoRoot, nextDir)}.`);
    return;
  }

  const marker = crypto.randomUUID();
  const target = path.relative(repoRoot, nextDir);
  fs.rmSync(nextDir, { force: true, recursive: true });
  console.log("dashboard:clean PASS");
  console.log(`Removed ${target}.`);
  console.log(`Clean marker: ${marker}`);
}

function readJson(filePath) {
  try {
    return {
      data: JSON.parse(fs.readFileSync(filePath, "utf8")),
      ok: true
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

function makeCheck(name, status, message, action) {
  return { action, message, name, status };
}

function printResult(result, { mode, startup }) {
  console.log(`dashboard:doctor ${result.status}`);
  console.log(`Mode: ${mode}${startup ? " startup" : ""}`);
  for (const check of result.checks) {
    console.log(`${check.status.padEnd(4)} ${check.name}: ${check.message}`);
    if (check.action) {
      console.log(`     Action: ${check.action}`);
    }
  }
}

main();
