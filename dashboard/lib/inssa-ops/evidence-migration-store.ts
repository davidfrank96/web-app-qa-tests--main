import { MigrationError, type MigrationStore, type MigrationLedger, type MigrationState } from "./evidence-migration";
const CODES: MigrationState[] = ["BLOCKED_PROTECTION", "BLOCKED_CHANGED_SOURCE", "BLOCKED_SOURCE_INTEGRITY", "BLOCKED_DESTINATION_CONFLICT", "ROLLBACK_REQUIRED"];
export function createMigrationStore(fetcher: typeof fetch = fetch): MigrationStore & { candidates(limit: number, after?: string): Promise<string[]> } {
  const url = new URL(process.env.SUPABASE_URL ?? ""); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || !key || process.env.INSSA_OPS_METADATA_STORE !== "supabase") throw new Error("Durable migration configuration required.");
  async function request(path: string, body?: unknown) {
    const response = await fetcher(new URL(`/rest/v1/${path}`, url), { method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
      headers: { apikey: key!, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { const message = await response.text(); throw new MigrationError(CODES.find(c => message.includes(c)) ?? "FAILED_RETRYABLE"); }
    return response.json();
  }
  return {
    inspect: bundle => request("rpc/evidence_migration_inspect", { p_bundle: bundle }),
    ledger: async bundle => (await request(`evidence_storage_migrations?bundle_id=eq.${encodeURIComponent(bundle)}&limit=1`))[0] as MigrationLedger ?? null,
    step: (bundle, action, args = {}) => request("rpc/evidence_migration_step", { p_bundle: bundle, p_action: action, p_owner: args.owner ?? null,
      p_bucket: args.bucket ?? null, p_signature: args.signature ?? null, p_proof: args.proof ?? null, p_error: args.error ?? null }),
    candidates: async (limit, after) => (await request(`evidence_bundles?select=id&storage_backend=eq.supabase-storage&status=eq.indexed&upload_status=eq.uploaded&order=id.asc&limit=${limit}${after ? `&id=gt.${encodeURIComponent(after)}` : ""}`)).map((r: { id: string }) => r.id),
  };
}
