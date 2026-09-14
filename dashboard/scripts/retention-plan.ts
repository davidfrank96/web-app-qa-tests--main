import { loadEnvConfig } from "@next/env";
import { evaluateRetention } from "../lib/inssa-ops/retention";
import { createRetentionReader, readRetentionSnapshot } from "../lib/inssa-ops/retention-store";

loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--as-of")) throw new Error("Usage: retention:plan [--as-of ISO_TIMESTAMP]");
  const asOf = args[1] ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf) > Date.now()) throw new Error("asOf must be a valid timestamp at or before now.");
  const plan = evaluateRetention(await readRetentionSnapshot(createRetentionReader()), asOf);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (plan.reviewReasons.length) process.exitCode = 2;
}
void main().catch((error) => {
  process.stderr.write(`Retention dry run blocked: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
