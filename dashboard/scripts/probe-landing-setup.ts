// Opt-in, logged-out landing initialization only. Never call openBuryEntry.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { installSafeWriteAudit } from "../../utils/inssa-safe-write-audit";

async function main() {
  if (!process.argv.includes("--staging")) throw new Error("Explicit --staging is required for this landing-only probe.");
  process.env.INSSA_URL = "https://staging.inssa.us";
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-landing-setup-"));
  console.log(`Landing-only evidence: ${output}`);
  const browser = await chromium.launch();
  let failed = false;
  try {
    for (let iteration = 1; iteration <= 3; iteration++) {
      // SW blocking is essential to prevent Home's automatic seed writes bypassing routing.
      // The reported fresh guest used Desktop Chrome, no stored identity and no video.
      const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: process.env.INSSA_URL, serviceWorkers: "block" });
      const audit = await installSafeWriteAudit(context, "logged-out-no-account");
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage();
      const errors: Array<{kind: string; message: string}> = [];
      page.on("console", message => { if (message.type() === "error") errors.push({ kind: "console", message: message.text() }); });
      page.on("pageerror", error => errors.push({ kind: "pageerror", message: error.message }));
      const started = Date.now();
      let navigationMs = 0, failure: string | null = null;
      try {
        const landing = new LandingPage(page);
        await landing.goToHome(); navigationMs = Date.now() - started;
        await landing.expectPublicLandingSurface();
      } catch (error) { failure = String(error); failed = true; }
      const summary = { iteration, status: failure ? "failed" : "passed", navigationMs, elapsedMs: Date.now() - started,
        url: page.url(), failure, errors, writes: audit.records, auditFailures: audit.failures,
        limitations: ["Service workers blocked so mutation protection cannot be bypassed.", "No authenticated fixture or concurrent campaign load."] };
      await page.screenshot({ path: path.join(output, `${iteration}.png`) });
      await fs.writeFile(path.join(output, `${iteration}.json`), JSON.stringify(summary, null, 2), { mode: 0o600 });
      await audit.dispose();
      await context.tracing.stop({ path: path.join(output, `${iteration}.zip`) });
      await context.close();
      console.log(JSON.stringify({ iteration, status: summary.status, navigationMs, elapsedMs: summary.elapsedMs,
        blockedWrites: audit.records.filter(row => row.blocked).map(row => row.endpoint), failure }));
    }
  } finally { await browser.close(); }
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
