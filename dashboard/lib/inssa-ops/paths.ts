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
