import { loadEnvConfig } from "@next/env";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";
import { getInssaExecutionJobStore } from "../lib/inssa-ops/execution-job-store";
import { classifyHistoricalEvidenceSources, markHistoricalEvidenceUnavailable } from "../lib/inssa-ops/evidence-recovery";
import { persistEvidenceBundleToDurableStorage } from "../lib/inssa-ops/evidence-storage";

loadEnvConfig(process.cwd(), false);
const ids = process.argv.find((arg) => arg.startsWith("--bundle-ids="))?.slice(13).split(",") ?? [];
if (!ids.length || ids.some((id) => !/^[a-f0-9-]{36}$/.test(id))) throw new Error("Provide explicit --bundle-ids=<uuid,...>; no unscoped recovery is allowed.");
const apply = process.argv.includes("--apply");
const store = getInssaRunStore();
async function assertInactive(runId: string) {
  const run = await store.getRun(runId), job = await getInssaExecutionJobStore().getByRunId(runId);
  if (!run || !["failed", "timed_out", "failed_startup", "cancelled"].includes(run.status) ||
      (job && ["queued", "claimed", "running"].includes(job.status))) throw new Error("Historical recovery requires an inactive failed run.");
}
async function main() {
  const remaining = new Set(ids);
  for (const run of await store.listRuns()) {
    if (!["failed", "timed_out", "failed_startup", "cancelled"].includes(run.status)) continue;
    const evidence = await store.getEvidence(run.id);
    for (const bundle of evidence.bundles.filter((b) => remaining.has(b.id))) {
      remaining.delete(bundle.id);
      if (bundle.uploadStatus === "uploaded") { console.log(JSON.stringify({ bundleId: bundle.id, state: "ALREADY_UPLOADED" })); continue; }
      await assertInactive(run.id);
      const items = evidence.items.filter((item) => item.bundleId === bundle.id);
      const classification = await classifyHistoricalEvidenceSources(bundle, items);
      let state: string = "DRY_RUN";
      if (apply) {
        const result = classification.classification === "SOURCE_BYTES_GONE" ? markHistoricalEvidenceUnavailable(bundle, items) :
          await persistEvidenceBundleToDurableStorage(bundle, items, { assertSafe: () => assertInactive(run.id) });
        await assertInactive(run.id);
        await store.replaceRunEvidence(run.id, result.bundle, result.items);
        state = result.bundle.uploadStatus;
      }
      console.log(JSON.stringify({ bundleId: bundle.id, runId: run.id, ...classification, state }));
    }
  }
  if (remaining.size) throw new Error(`${remaining.size} requested bundles were not found in failed runs.`);
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
