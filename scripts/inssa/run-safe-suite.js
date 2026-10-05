const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const safeTestArgs = ["test", "tests/inssa/inssa-time-capsule-create.spec.ts", "tests/inssa/us-compose-location-matrix.spec.ts",
  "tests/inssa/media-step-capability.spec.ts", "tests/inssa/fixture-isolation.spec.ts", "--project=inssa-chrome", "--workers=1", "--retries=0"];

async function runSafeSuite(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== "--list")) throw new Error("Safe Suite accepts only --list; workers and retries are fixed.");
  const listing = args.includes("--list");
  const temporary = listing ? undefined : fs.mkdtempSync(path.join(os.tmpdir(), "inssa-safe-session-"));
  const output = path.resolve(process.env.INSSA_RUN_OUTPUT_DIR || path.join("run-output", `safe-${randomUUID()}`));
  const env = { ...process.env };
  delete env.INSSA_SAFE_AUTH_STATE_PATH;
  delete env.INSSA_SAFE_AUTH_PREFLIGHT_PATH;
  if (temporary) {
    Object.assign(env, {
      INSSA_SAFE_AUTH_STATE_PATH: path.join(temporary, "storage-state.json"),
      INSSA_SAFE_AUTH_PREFLIGHT_PATH: path.join(output, "safe-auth-preflight.json"),
      PLAYWRIGHT_OUTPUT_DIR: env.PLAYWRIGHT_OUTPUT_DIR || path.join(output, "test-results"),
      PLAYWRIGHT_HTML_OUTPUT_DIR: env.PLAYWRIGHT_HTML_OUTPUT_DIR || path.join(output, "playwright-report"),
      PLAYWRIGHT_JSON_OUTPUT_FILE: env.PLAYWRIGHT_JSON_OUTPUT_FILE || path.join(output, "playwright-results.json"),
      PLAYWRIGHT_HTML_OPEN: "never"
    });
  }
  let child;
  const terminate = signal => child?.kill(signal);
  const sigint = () => terminate("SIGINT"), sigterm = () => terminate("SIGTERM");
  process.on("SIGINT", sigint); process.on("SIGTERM", sigterm);
  try {
    return await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), ...safeTestArgs, ...args], { env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", sigint); process.off("SIGTERM", sigterm);
    // Credential-bearing state is outside evidence roots, including on failure.
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
module.exports = { safeTestArgs, runSafeSuite };
if (require.main === module) runSafeSuite().then(code => { process.exitCode = code; }).catch(() => {
  console.error("SAFE_AUTH_SETUP_FAILED: Safe runner could not start. Safe tests NOT STARTED.");
  process.exitCode = 1;
});
