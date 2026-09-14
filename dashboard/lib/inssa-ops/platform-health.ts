import { dashboardWorkerIsHealthy } from "./live-campaigns";
import { readProcessLiveness } from "./process-liveness";

type DependencyHealth = { supabase: "healthy" | "unhealthy" | "not_configured"; evidenceProvider: "supabase" | "local" | "misconfigured" };
let cached: { key: string; expiresAt: number; value: Promise<DependencyHealth> } | undefined;

async function dependencyHealth(): Promise<DependencyHealth> {
  const metadata = process.env.INSSA_OPS_METADATA_STORE;
  const provider = process.env.INSSA_EVIDENCE_STORAGE_PROVIDER?.trim().toLowerCase() || "local";
  const url = process.env.SUPABASE_URL?.trim(), key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.INSSA_EVIDENCE_SUPABASE_BUCKET?.trim() || "inssa-evidence";
  const cacheKey = JSON.stringify([metadata,provider,url,key,bucket]);
  if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) return cached.value;
  const value = (async (): Promise<DependencyHealth> => {
    const probe = async (resource: string, privateBucket = false) => {
      if (!url || !key) return false;
      try {
        const response = await fetch(`${url.replace(/\/$/, "")}/${resource}`, {
          headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2_000), cache: "no-store"
        });
        if (!response.ok) return false;
        if (privateBucket) return (await response.json()).public === false;
        return Array.isArray(await response.json());
      } catch { return false; }
    };
    const [metadataOkay, bucketOkay] = await Promise.all([
      metadata === "supabase" ? probe("rest/v1/campaign_runs?select=id&limit=1") : Promise.resolve(true),
      provider === "supabase" ? probe(`storage/v1/bucket/${encodeURIComponent(bucket)}`, true) : Promise.resolve(provider === "local")
    ]);
    return { supabase: metadata === "supabase" ? metadataOkay ? "healthy" : "unhealthy" : "not_configured",
      evidenceProvider: !bucketOkay ? "misconfigured" : provider === "supabase" ? "supabase" : "local" };
  })();
  cached = { key: cacheKey, expiresAt: Date.now() + 30_000, value };
  return value;
}

export async function getPlatformHealth() {
  const [dependencies, worker, scheduler, supervisor] = await Promise.all([
    dependencyHealth(), readProcessLiveness("worker"), readProcessLiveness("scheduler"), dashboardWorkerIsHealthy()
  ]);
  // Infrastructure checks deliberately do not consume OAuth provider-monitor results.
  const healthy = supervisor && worker === "healthy" && scheduler === "healthy" && dependencies.supabase !== "unhealthy" &&
    dependencies.evidenceProvider !== "misconfigured";
  return { ...dependencies, worker, scheduler, web: "healthy" as const,
    platformInfrastructure: healthy ? "healthy" : "unhealthy",
    metadataBackend: process.env.INSSA_OPS_METADATA_STORE === "supabase" ? "supabase" : "local-json",
    status: healthy ? "ok" : "unhealthy", supervisor: supervisor ? "running" : "unavailable",
    timestamp: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()) };
}
