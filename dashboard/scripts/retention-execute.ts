import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { createRetentionReader, readRetentionSnapshot } from "../lib/inssa-ops/retention-store";
import { certifyExecutionPlan, executeRetention, retentionComparison } from "../lib/inssa-ops/retention-executor";
import { createRetentionExecutorIO, retentionRpcClient } from "../lib/inssa-ops/retention-service";
loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
async function main() {
  const [command, occurrence, ...rest] = process.argv.slice(2);
  if (rest.length) throw new Error("Unexpected retention arguments.");
  if (command === "--compare" && !occurrence) {
    const comparison = retentionComparison(await readRetentionSnapshot(createRetentionReader()));
    certifyExecutionPlan(comparison.thirtyDays);
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`); return;
  }
  if (command === "--enable-monthly" && !occurrence) {
    certifyExecutionPlan(retentionComparison(await readRetentionSnapshot(createRetentionReader())).thirtyDays);
    await retentionRpcClient()("retention_enable_monthly", { p_policy_version: "evidence-retention-v3" });
    process.stdout.write('Monthly retention enabled: day 1 at 01:30 Europe/Dublin; no catch-up.\n'); return;
  }
  if (command !== "--execute" || !/^manual:[a-zA-Z0-9_-]+$/.test(occurrence ?? "")) throw new Error("Usage: retention:execute --compare | --execute manual:OCCURRENCE | --enable-monthly");
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort()); process.once("SIGINT", () => controller.abort());
  const result = await executeRetention(createRetentionExecutorIO(controller.signal), { occurrence, owner: `retention-${randomUUID()}`, signal: controller.signal });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result && typeof result === "object" && "status" in result && !["HEALTHY", "ALREADY_RECORDED"].includes(String(result.status))) process.exitCode = 2;
}
void main().catch((error) => { process.stderr.write(`Retention execution failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
