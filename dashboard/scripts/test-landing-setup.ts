import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type TestInfo } from "@playwright/test";
import { dismissInssaSessionWarning } from "../../utils/inssa-session-warning";
import { createInssaStabilityMonitor } from "../../utils/monitor";
import { createInssaErrorMonitor } from "../../utils/auth";
import { classifyInssaLifecyclePersistence, createInssaLifecycleNetworkMonitor } from "../../utils/inssa-lifecycle-network";

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-setup-fixtures-"));
  const cwd = process.cwd();
  process.chdir(dir); // Lifecycle diagnostic screenshots stay outside real run artifacts.
  const { captureInssaSetupFailure } = await import("../../utils/inssa-live-artifacts");
  const browser = await chromium.launch();
  try {
    for (const scenario of ["absent", "dismissible", "animated", "disabled", "occluded", "broken-handler"]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const html = `<style>@keyframes enter { from {transform:translateY(80px)} to {transform:translateY(0)} }</style><main>
        ${scenario === "absent" ? "" : `<section role="status" ${scenario === "animated" ? 'style="animation:enter 800ms linear"' : ""}>
        Heads up about this browser session<button ${scenario === "disabled" ? "disabled" : ""}
        onclick="${scenario === "broken-handler" ? "" : "this.parentElement.remove()"}">Got it</button></section>`}
        ${scenario === "occluded" ? '<div id="blocking-dialog" role="dialog" style="position:fixed;inset:0;z-index:100;background:white">Blocking modal</div>' : ""}
        <button onclick="window.unrelated=true">Got it</button></main>`;
      await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://fixture.invalid/landing");
      const started = Date.now();
      if (["disabled", "occluded", "broken-handler"].includes(scenario)) {
        let failure: unknown;
        try { await dismissInssaSessionWarning(page, { timeoutMs: 700 }); } catch (error) { failure = error; }
        assert.ok(failure instanceof Error, `${scenario} must fail`);
        if (scenario === "disabled") assert.match(failure.message, /locator.click[\s\S]*element is not enabled/);
        if (scenario === "occluded") assert.match(failure.message, /locator.click[\s\S]*intercepts pointer events/);
        if (scenario === "broken-handler") assert.match(failure.message, /not.toBeVisible\(\) failed/);
        assert.equal(await page.getByRole("status").isVisible(), true);

        // The fixture page deliberately remains blank, as in the reported failure.
        const fixturePage = await context.newPage();
        const fixtureErrors = createInssaErrorMonitor(fixturePage);
        const guestErrors = createInssaErrorMonitor(page);
        await page.evaluate(() => console.error("fixture guest error"));
        const attachments = new Map<string, any>();
        const testInfo = { titlePath: ["fixture", scenario], attach: async (name: string, value: any) => {
          attachments.set(name, value);
        } } as unknown as TestInfo;
        const monitor = createInssaStabilityMonitor(fixturePage, testInfo, fixtureErrors);
        await assert.rejects(monitor.step("guest setup", async () => {
          // Record an error during the observed step, rather than on fixturePage.
          guestErrors.issues.push({ kind: "pageerror", message: "fixture setup error", action: "guest setup", pageUrl: page.url() });
          throw failure;
        }, { page, errorMonitor: guestErrors, phase: "navigation" }), error => error === failure);
        await captureInssaSetupFailure(page, testInfo, guestErrors.issues, failure, `${scenario}.png`);
        await monitor.finalize();
        const report = JSON.parse(attachments.get("inssa-monitor.json").body);
        assert.equal(report.summary.finalRoute, "https://fixture.invalid/landing");
        assert.equal(report.records[0].pageErrors, 1);
        const diagnostic = JSON.parse(attachments.get("inssa-guest-setup-failure.json").body);
        assert.equal(diagnostic.url, "https://fixture.invalid/landing");
        assert.equal(diagnostic.error.message, failure.message);
        assert.deepEqual(diagnostic.captureErrors, []);
        assert.ok((await fs.stat(attachments.get("inssa-guest-setup-failure.png").path)).size > 0);
      } else {
        await dismissInssaSessionWarning(page);
        assert.equal(await page.getByRole("status").isVisible(), false);
      }
      assert.equal(await page.evaluate(() => Boolean((window as any).unrelated)), false);
      console.log(`PASS ${scenario}: ${Date.now() - started}ms`);
      await context.close();
    }
    const input = { finalShareEvidence: null, finalShareLink: null, finalUrl: "https://fixture.invalid/landing",
      networkSummary: createInssaLifecycleNetworkMonitor({ getPhase: () => "pre-create" }).summarize(),
      observedCreateSuccess: false, possibleFinalCapsuleId: null, possibleShareToken: null,
      revealAudience: null, revealSettingsContinueClicked: false, revealSettingsFollowupClickedLabel: null, revealTiming: null };
    assert.equal(classifyInssaLifecyclePersistence({ ...input, setupFailed: true, finalizationAttempted: false }), "setup-failed");
    assert.equal(classifyInssaLifecyclePersistence({ ...input, setupFailed: false, finalizationAttempted: false }), "finalization-not-attempted");
    assert.equal(classifyInssaLifecyclePersistence({ ...input, finalizationAttempted: true, revealSettingsContinueClicked: true }), "finalization-response-missing");
    console.log("PASS setup/not-attempted/attempted classification");
  } finally { await browser.close(); process.chdir(cwd); await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
