import path from "node:path";

export function getRepoRoot() {
  if (process.env.INSSA_QA_REPO_ROOT?.trim()) {
    return path.resolve(process.env.INSSA_QA_REPO_ROOT);
  }

  return path.basename(process.cwd()) === "dashboard"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}

export function getLocalRunStorePath() {
  return path.join(getRepoRoot(), "dashboard", ".data", "inssa-runs.json");
}

export function getLocalExecutionJobStorePath() {
  return path.join(getRepoRoot(), "dashboard", ".data", "execution-jobs.json");
}

export function getLocalNotificationOutboxPath() {
  return path.join(getRepoRoot(), "dashboard", ".data", "notification-outbox.json");
}

export function getLocalMonitoringDefinitionPath() {
  return path.join(getRepoRoot(), "dashboard", ".data", "monitoring-definitions.json");
}

export function getLocalSchedulerStorePath() {
  return path.join(getRepoRoot(), "dashboard", ".data", "scheduler-state.json");
}

export function getLocalAuthRateLimitPath() {
  return path.join(getRepoRoot(), "dashboard", ".data", "auth-rate-limits.json");
}

export function getLocalRunLogDirectory() {
  return path.join(getRepoRoot(), "dashboard", ".data", "run-logs");
}

export function getRunOutputRoot(runId: string) {
  if (!/^[A-Za-z0-9-]+$/.test(runId)) {
    throw new Error(`Invalid run id for output path: ${runId}`);
  }
  return path.join(getRepoRoot(), "run-output", runId);
}
