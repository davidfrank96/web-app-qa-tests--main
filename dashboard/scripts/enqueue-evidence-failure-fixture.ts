import { loadEnvConfig } from "@next/env";
import { getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";
loadEnvConfig(process.cwd(), false);
async function main() {
  if (!process.argv.includes("--enqueue") || process.env.INSSA_OPS_METADATA_STORE !== "supabase" ||
      process.env.INSSA_EVIDENCE_STORAGE_PROVIDER !== "supabase" ||
      new URL(process.env.SUPABASE_URL || "").hostname !== "qdrhzdulhlkjhckosdrv.supabase.co") {
    throw new Error("Explicit --enqueue and the authorized Supabase metadata/evidence target are required.");
  }
  const jobs = getInssaExecutionJobStore(), store = getInssaRunStore();
  if (await jobs.getActive()) throw new Error("Wait for the active QA job before running the controlled evidence fixture.");
  const run = await store.createRun({ campaignKey: "stabilization_evidence_fixture", requestedBy: "stabilization-wave-1",
    commandSnapshot: { key: "stabilization_evidence_fixture", displayName: "Controlled evidence failure fixture",
      npmScript: "test:fixture:evidence-failure", commandType: "healthcheck", mutatesStaging: false, phase1Enabled: false,
      producesFindings: false, producesReports: true, riskLevel: "safe", timeoutMs: 30_000,
      targetEnvironment: "staging", operatorDescription: "Expected exit 1; writes owned JSON and HTML evidence; zero product requests." } });
  try { await jobs.enqueue({ campaignKey: run.campaignKey, runId: run.id, idempotencyKey: run.id, maxAttempts: 1 }); }
  catch (error) { await store.updateRun(run.id,{status:"failed_startup",completedAt:new Date().toISOString()}); throw error; }
  console.log(JSON.stringify({ runId: run.id, expectedStatus: "failed", expectedEvidence: "uploaded", productRequests: 0 }));
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; });
