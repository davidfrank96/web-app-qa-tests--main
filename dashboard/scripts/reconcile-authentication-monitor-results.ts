import { loadEnvConfig } from "@next/env";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";
import {
  isAuthenticationMonitoringCampaign,
  isTerminalAuthenticationMonitoringRun
} from "../lib/monitoring/authentication-result";
import { loadAuthenticationMonitoringResult } from "../lib/monitoring/authentication-result-store";

loadEnvConfig(process.cwd(), process.env.INSSA_DASHBOARD_MODE !== "start");

const write = process.argv.includes("--write");
const runIdArgument = process.argv.find((argument) => argument.startsWith("--run-id="));
const explicitRunId = runIdArgument?.slice("--run-id=".length).trim();
const allTerminal = process.argv.includes("--all-terminal");

if ((!explicitRunId && !allTerminal) || (explicitRunId && allTerminal)) {
  process.stderr.write("Specify exactly one of --run-id=<uuid> or --all-terminal. Add --write to persist reconciliation.\n");
  process.exit(2);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const store = getInssaRunStore();
  const runs = explicitRunId
    ? [await store.getRun(explicitRunId)].filter((run) => run !== null)
    : (await store.listRuns()).filter(
        (run) => isAuthenticationMonitoringCampaign(run.campaignKey) && isTerminalAuthenticationMonitoringRun(run.status)
      );

  if (runs.length === 0) throw new Error("No matching Authentication Monitoring runs were found.");

  let unavailable = 0;
  for (const run of runs) {
    if (!isAuthenticationMonitoringCampaign(run.campaignKey) || !isTerminalAuthenticationMonitoringRun(run.status)) {
      process.stderr.write(`Refusing non-terminal or non-authentication-monitor run ${run.id}.\n`);
      unavailable += 1;
      continue;
    }
    const resolution = await loadAuthenticationMonitoringResult(store, run.id, { persistRecoveredMetadata: write });
    if (!resolution) {
      unavailable += 1;
      continue;
    }
    const outcome = resolution.state === "available"
      ? `AVAILABLE:${resolution.result?.overallStatus ?? "unknown"}`
      : resolution.state === "result_metadata_missing"
        ? "RESULT_METADATA_MISSING"
        : resolution.state.toUpperCase();
    process.stdout.write(`${run.id} ${outcome} source=${resolution.source ?? "none"} write=${write}\n`);
    if (resolution.state !== "available") unavailable += 1;

    if (write) {
      const marker = `Authentication monitoring result reconciliation: ${outcome}`;
      const logs = await store.getLogs(run.id);
      if (!logs.some((log) => log.message.startsWith(marker))) {
        await store.appendLog(run.id, "system", `${marker}; source=${resolution.source ?? "none"}.`);
      }
    }
  }

  process.exitCode = unavailable > 0 ? 1 : 0;
}
