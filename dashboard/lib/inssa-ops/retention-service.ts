import { createClient } from "@supabase/supabase-js";
import { createRetentionReader, readRetentionSnapshot } from "./retention-store";
import type { RetentionExecutorIO } from "./retention-executor";
import type { RetentionHealth } from "./retention-types";

export function retentionRpcClient() {
  createRetentionReader(); // Validate durable configuration, including HTTPS and fail-closed local mode.
  const base = new URL(process.env.SUPABASE_URL!);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return async <T = unknown>(name: string, body?: Record<string, unknown>): Promise<T> => {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, base), { method: body ? "POST" : "GET", redirect: "error", cache: "no-store",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Retention ${name} failed (${response.status}).`);
    const text = await response.text(); return (text ? JSON.parse(text) : null) as T;
  };
}
export const readRetentionHealth = () => retentionRpcClient()<RetentionHealth>("retention_health");

export function createRetentionExecutorIO(signal?: AbortSignal): RetentionExecutorIO {
  const rpc = retentionRpcClient();
  if (process.env.INSSA_EVIDENCE_SUPABASE_BUCKET && process.env.INSSA_EVIDENCE_SUPABASE_BUCKET !== "inssa-evidence") throw new Error("Retention bucket mismatch.");
  const reader = createRetentionReader();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([
      AbortSignal.timeout(20_000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]) }) }
  });
  const bucket = client.storage.from("inssa-evidence");
  return {
    snapshot: () => readRetentionSnapshot(reader),
    claim: (id, owner, automatic, schedulerStartedAt) => rpc("retention_claim_occurrence", { p_id: id, p_owner: owner, p_automatic: automatic, p_scheduler_started_at: schedulerStartedAt ?? null }),
    heartbeat: (id, owner) => rpc("retention_heartbeat", { p_occurrence: id, p_owner: owner }),
    reserve: (i) => rpc("retention_reserve_bundle", { p_occurrence: i.occurrence, p_owner: i.owner, p_revision: i.snapshot.revision,
      p_bundle: i.bundleId, p_signature: i.signature, p_plan: i.planId, p_objects: i.objects }),
    remove: async (keys) => {
      if (!keys.length || keys.length > 100 || keys.some((key) => !key || key.startsWith("/") || key.split("/").includes(".."))) throw new Error("Invalid exact deletion keys.");
      const { error } = await bucket.remove(keys);
      if (error) throw new Error("Storage deletion API failed.");
    },
    verifyAbsent: async (keys) => {
      // Storage HEADs plus the transaction's independent inventory check precede pruning.
      for (let i = 0; i < keys.length; i += 8) {
        await Promise.all(keys.slice(i, i + 8).map(async (key) => {
          const result = await bucket.exists(key);
          if (result.data !== false) throw new Error("Storage object remains present.");
        }));
      }
    },
    settle: (id, owner, bundle, success, error) => rpc("retention_settle_bundle", { p_occurrence: id, p_owner: owner, p_bundle: bundle, p_success: success, p_error: error }),
    finish: (id, owner, error, protectedCount, reviewCount) => rpc("retention_finish_occurrence", { p_occurrence: id, p_owner: owner,
      p_error: error, p_protected: protectedCount, p_review: reviewCount })
  };
}
