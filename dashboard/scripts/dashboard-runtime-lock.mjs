import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockDirectory = path.join(dashboardRoot, ".data", "dashboard-runtime.lock");
const ownerPath = path.join(lockDirectory, "owner.json");
const INCOMPLETE_LOCK_GRACE_MS = 30_000;

export class DashboardRuntimeLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "DashboardRuntimeLockError";
  }
}

export function acquireDashboardRuntimeLock(mode) {
  fs.mkdirSync(path.dirname(lockDirectory), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockDirectory);
      const owner = {
        acquiredAt: new Date().toISOString(),
        mode,
        pid: process.pid,
        token: crypto.randomUUID()
      };
      fs.writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
      return owner;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const state = inspectDashboardRuntimeLock();
      if (state.active) {
        throw new DashboardRuntimeLockError(
          `Dashboard runtime is already owned by ${describeDashboardRuntimeOwner(state.owner)}. Stop it before starting ${mode}.`
        );
      }
    }
  }

  throw new DashboardRuntimeLockError(`Unable to acquire dashboard runtime ownership for ${mode}.`);
}

export function releaseDashboardRuntimeLock(owner) {
  const state = readLockState();
  if (!state.owner || state.owner.token !== owner.token || state.owner.pid !== owner.pid) return false;
  fs.rmSync(lockDirectory, { force: true, recursive: true });
  return true;
}

export function inspectDashboardRuntimeLock() {
  if (!fs.existsSync(lockDirectory)) return { active: false, owner: null, staleRemoved: false };

  const state = readLockState();
  if (state.owner && isProcessAlive(state.owner.pid)) {
    return { active: true, owner: state.owner, staleRemoved: false };
  }

  if (!state.owner && state.ageMs < INCOMPLETE_LOCK_GRACE_MS) {
    return {
      active: true,
      owner: { acquiredAt: null, mode: "initializing", pid: null, token: null },
      staleRemoved: false
    };
  }

  fs.rmSync(lockDirectory, { force: true, recursive: true });
  return { active: false, owner: state.owner, staleRemoved: true };
}

export function describeDashboardRuntimeOwner(owner) {
  if (!owner) return "an unknown process";
  const pid = Number.isInteger(owner.pid) ? `pid ${owner.pid}` : "an initializing process";
  return `${owner.mode || "unknown mode"} (${pid})`;
}

function readLockState() {
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch {
    // A newly-created lock directory can briefly exist before owner.json is written.
  }

  let ageMs = 0;
  try {
    ageMs = Math.max(0, Date.now() - fs.statSync(lockDirectory).mtimeMs);
  } catch {
    ageMs = Number.POSITIVE_INFINITY;
  }
  return { ageMs, owner };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
