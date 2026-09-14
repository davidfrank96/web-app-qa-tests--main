import fs from "node:fs/promises";
import path from "node:path";
import { getRepoRoot } from "./paths";

type Role = "worker" | "scheduler";
const writes = new Map<Role, { at: number; pending: Promise<void> }>();
export async function recordProcessLiveness(role: Role) {
  const now = Date.now(), last = writes.get(role);
  if (last && now - last.at < 15_000) return last.pending;
  const pending = (async () => {
    const root = path.join(getRepoRoot(), "dashboard", ".data");
    await fs.mkdir(root, { recursive: true });
    const target = path.join(root, `${role}-liveness.json`), temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ at: new Date(now).toISOString(), pid: process.pid,
      ownerToken: process.env.INSSA_DASHBOARD_LOCK_TOKEN ?? null }));
    await fs.rename(temporary, target);
  })();
  writes.set(role, { at: now, pending });
  return pending;
}

export async function readProcessLiveness(role: Role, now = Date.now()): Promise<"healthy" | "stale"> {
  try {
    const root = path.join(getRepoRoot(), "dashboard", ".data");
    const [owner, heartbeat] = await Promise.all([
      fs.readFile(path.join(root, "dashboard-runtime.lock", "owner.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(root, `${role}-liveness.json`), "utf8").then(JSON.parse)
    ]);
    const maxAge = role === "worker" ? 60_000 : Math.max(180_000, 3 * (Number(process.env.INSSA_SCHEDULER_INTERVAL_MS) || 60_000));
    const age = now - Date.parse(heartbeat.at);
    if (!owner.token || heartbeat.ownerToken !== owner.token || !["start", "dev"].includes(owner.mode) ||
        !Number.isInteger(owner.pid) || !Number.isInteger(heartbeat.pid) || !(age >= 0 && age <= maxAge)) return "stale";
    process.kill(owner.pid, 0); process.kill(heartbeat.pid, 0);
    return "healthy";
  } catch { return "stale"; }
}
