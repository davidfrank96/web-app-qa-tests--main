import path from "node:path";
import { expect, test as safeTest } from "./fixtures";

// Supply an offline seed to the real Safe storageState fixture. CI deliberately
// has no staging credentials; isolation itself must not require a product login.
const test = safeTest.extend({
  authStorageStatePath: [async ({ browser }, use, workerInfo) => {
    const statePath = path.join(workerInfo.project.outputDir, `isolation-seed-${workerInfo.workerIndex}.json`);
    const context = await browser.newContext({ storageState: {
      cookies: [],
      origins: [{ origin: new URL(workerInfo.project.use.baseURL!).origin,
        localStorage: [{ name: "qa-fixture-seed", value: "safe-storage-state" }] }]
    } });
    await context.storageState({ path: statePath });
    await context.close();
    await use(statePath);
  }, { scope: "worker" }]
});

// Exercise the actual Safe fixture in two independent browser contexts. The page is
// fulfilled locally: this check creates no product draft and sends no product writes.
test.describe("Safe fixture state isolation", () => {
  test.describe.configure({ mode: "serial" });
  for (const execution of [1, 2]) {
    test(`independent execution ${execution} starts without previous compose state`, async ({ page }) => {
      await page.route("**/__qa_fixture_isolation", (route) => route.fulfill({ contentType: "text/html", body: "<p>QA isolation fixture</p>" }));
      await page.goto("/__qa_fixture_isolation");
      expect(await page.evaluate(() => localStorage.getItem("qa-fixture-seed"))).toBe("safe-storage-state");
      expect(await page.evaluate(() => localStorage.getItem("qa-fixture-draft-marker"))).toBeNull();
      expect(await page.evaluate(() => sessionStorage.getItem("qa-fixture-draft-marker"))).toBeNull();
      await page.evaluate(() => {
        localStorage.setItem("qa-fixture-draft-marker", crypto.randomUUID());
        sessionStorage.setItem("qa-fixture-draft-marker", crypto.randomUUID());
      });
    });
  }
});
