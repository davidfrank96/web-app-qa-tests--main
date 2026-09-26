import fs from "node:fs/promises";
import path from "node:path";
import { getRepoRoot } from "./paths";
import { readProcessLiveness } from "./process-liveness";
import { quotaCeiling, quotaLevel } from "./quota-status";
import type { BackgroundRequestSnapshot } from "./background-request-metrics";

type Usage = { at: string; databaseBytes: number; storageBytes: number; evidenceBytes: number; unknownSizeObjects: number };
let cached: { at: number; value: Usage } | null = null;
let pending: Promise<Usage> | null = null;
async function readUsage(): Promise<Usage> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    if (process.env.INSSA_OPS_METADATA_STORE !== "supabase" || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Usage unavailable");
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qa_usage_snapshot`, {
      method: "POST", body: "{}", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }
    });
    if (!response.ok) throw new Error("Usage unavailable");
    const value = await response.json() as Usage;
    if (!Number.isFinite(Date.parse(value.at)) || [value.databaseBytes, value.storageBytes, value.evidenceBytes, value.unknownSizeObjects].some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid usage snapshot");
    cached = { at: Date.now(), value };
    return value;
  })();
  try { return await pending; } finally { pending = null; }
}
async function readRequests(role: "worker" | "scheduler"): Promise<BackgroundRequestSnapshot | null> {
  if (await readProcessLiveness(role) !== "healthy") return null;
  try {
    const heartbeat = JSON.parse(await fs.readFile(path.join(getRepoRoot(), "dashboard", ".data", `${role}-liveness.json`), "utf8"));
    const value = heartbeat.requests as BackgroundRequestSnapshot | null;
    return value && Number.isFinite(value.requestsPerMinute) && value.windowMs > 0 ? value : null;
  } catch { return null; }
}
export async function readOperationsUsage() {
  const [usage, worker, scheduler] = await Promise.all([readUsage(), readRequests("worker"), readRequests("scheduler")]);
  // Explicit conservative decimal operational ceilings, not a billing entitlement API.
  const databaseCeiling = quotaCeiling(process.env.QA_DATABASE_CEILING_BYTES, 500_000_000);
  const storageCeiling = quotaCeiling(process.env.QA_STORAGE_CEILING_BYTES, 1_000_000_000);
  return { ...usage, databaseCeiling, storageCeiling,
    databaseStatus: quotaLevel(usage.databaseBytes, databaseCeiling),
    storageStatus: quotaLevel(usage.unknownSizeObjects ? null : usage.storageBytes, storageCeiling),
    worker, scheduler };
}
export type OperationsUsage = Awaited<ReturnType<typeof readOperationsUsage>>;
