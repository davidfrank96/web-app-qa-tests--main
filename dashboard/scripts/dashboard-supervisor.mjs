import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  acquireDashboardRuntimeLock,
  releaseDashboardRuntimeLock
} from "./dashboard-runtime-lock.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const mode = process.argv[2];

if (mode !== "dev" && mode !== "start") {
  process.stderr.write("Usage: node scripts/dashboard-supervisor.mjs <dev|start>\n");
  process.exit(2);
}

const binaryExtension = process.platform === "win32" ? ".cmd" : "";
const nextBinary = path.join(dashboardRoot, "node_modules", ".bin", `next${binaryExtension}`);
const nodeBinary = process.execPath;
const runtimeScript = path.join(dashboardRoot, "scripts", "dashboard-runtime.mjs");
const nextDir = path.join(dashboardRoot, ".next");
let runtimeOwner;
try {
  runtimeOwner = acquireDashboardRuntimeLock(mode);
} catch (error) {
  process.stderr.write(`Dashboard startup blocked: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const environment = {
  ...process.env,
  INSSA_DASHBOARD_LOCK_TOKEN: runtimeOwner.token,
  INSSA_DASHBOARD_MODE: mode,
  INSSA_QA_REPO_ROOT: repoRoot
};
const children = new Set();
let shuttingDown = false;

process.once("exit", () => releaseDashboardRuntimeLock(runtimeOwner));

if (mode === "dev") {
  fs.rmSync(nextDir, { force: true, recursive: true });
  process.stdout.write("Dashboard dev startup removed stale .next artifacts.\n");
}

const preflight = spawnSync(nodeBinary, [runtimeScript, `--mode=${mode}`, "--startup"], {
  cwd: dashboardRoot,
  env: environment,
  shell: false,
  stdio: "inherit"
});
if (preflight.error || preflight.status !== 0) {
  releaseDashboardRuntimeLock(runtimeOwner);
  if (preflight.error) process.stderr.write(`Dashboard preflight failed: ${preflight.error.message}\n`);
  process.exit(preflight.status ?? 1);
}

const worker = launch(nodeBinary, ["--import", "tsx", "scripts/inssa-worker.ts"], "worker");
const scheduler = launch(nodeBinary, ["--import", "tsx", "scripts/inssa-scheduler.ts"], "scheduler");
const dashboard = launch(nextBinary, [mode], "dashboard");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

worker.on("exit", (code, signal) => {
  if (!shuttingDown) {
    process.stderr.write(`Execution worker exited unexpectedly (code=${String(code)}, signal=${String(signal)}). Stopping dashboard.\n`);
    shutdown("SIGTERM", code ?? 1);
  }
});

scheduler.on("exit", (code, signal) => {
  if (!shuttingDown) {
    process.stderr.write(`Scheduler exited unexpectedly (code=${String(code)}, signal=${String(signal)}). Stopping dashboard.\n`);
    shutdown("SIGTERM", code ?? 1);
  }
});

dashboard.on("exit", (code, signal) => {
  if (!shuttingDown) {
    process.stdout.write(`Dashboard exited (code=${String(code)}, signal=${String(signal)}).\n`);
    shutdown("SIGTERM", code ?? 0);
  }
});

function launch(command, args, label) {
  const child = spawn(command, args, {
    cwd: dashboardRoot,
    env: environment,
    shell: false,
    stdio: "inherit"
  });
  children.add(child);
  child.on("error", (error) => {
    process.stderr.write(`Unable to start ${label}: ${error.message}\n`);
    shutdown("SIGTERM", 1);
  });
  child.on("exit", () => children.delete(child));
  return child;
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
  const forceTimer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 5_000);
  forceTimer.unref();
  Promise.all([...children].map((child) => new Promise((resolve) => child.once("exit", resolve)))).finally(() => {
    releaseDashboardRuntimeLock(runtimeOwner);
    process.exit(exitCode);
  });
}
