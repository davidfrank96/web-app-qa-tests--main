import { expect, test } from "./fixtures";

// Exercise the actual Safe fixture in two independent browser contexts. The page is
// fulfilled locally: this check creates no product draft and sends no product writes.
test.describe("Safe fixture state isolation", () => {
  test.describe.configure({ mode: "serial" });
  for (const execution of [1, 2]) {
    test(`independent execution ${execution} starts without previous compose state`, async ({ page }) => {
      await page.route("**/__qa_fixture_isolation", (route) => route.fulfill({ contentType: "text/html", body: "<p>QA isolation fixture</p>" }));
      await page.goto("/__qa_fixture_isolation");
      expect(await page.evaluate(() => localStorage.getItem("qa-fixture-draft-marker"))).toBeNull();
      expect(await page.evaluate(() => sessionStorage.getItem("qa-fixture-draft-marker"))).toBeNull();
      await page.evaluate(() => {
        localStorage.setItem("qa-fixture-draft-marker", crypto.randomUUID());
        sessionStorage.setItem("qa-fixture-draft-marker", crypto.randomUUID());
      });
    });
  }
});
