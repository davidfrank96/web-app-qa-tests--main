import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  acquireDashboardRuntimeLock,
  releaseDashboardRuntimeLock
} from "./dashboard-runtime-lock.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(dashboardRoot, ".next");
const nextBinary = path.join(
  dashboardRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next"
);
const doctorScript = path.join(dashboardRoot, "scripts", "dashboard-runtime.mjs");

let owner;
let exitCode = 1;
try {
  owner = acquireDashboardRuntimeLock("build");
  fs.rmSync(nextDir, { force: true, recursive: true });
  process.stdout.write("dashboard:build removed stale .next artifacts before compiling.\n");

  const build = spawnSync(nextBinary, ["build"], {
    cwd: dashboardRoot,
    env: { ...process.env, INSSA_DASHBOARD_LOCK_TOKEN: owner.token },
    shell: false,
    stdio: "inherit"
  });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    exitCode = build.status ?? 1;
  } else {
    const doctor = spawnSync(process.execPath, [doctorScript, "--mode=start"], {
      cwd: dashboardRoot,
      env: { ...process.env, INSSA_DASHBOARD_LOCK_TOKEN: owner.token },
      shell: false,
      stdio: "inherit"
    });
    if (doctor.error) throw doctor.error;
    exitCode = doctor.status ?? 1;
  }
} catch (error) {
  process.stderr.write(`dashboard:build FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  if (owner) releaseDashboardRuntimeLock(owner);
}

process.exit(exitCode);
