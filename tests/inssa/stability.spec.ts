import { type Page, type Route } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { expect, test } from "./fixtures";

const NAVIGATION_ACTION_PATTERN = /my contacts|contacts|requests|alerts|following|loved|favorites|edit profile/i;
const EMPTY_STATE_PATTERN =
  /no (contacts?|connections?|people|posts?|capsules?|content|items?|results?) (yet|found)|nothing (here|to show|yet)|be the first|coming soon|empty/i;

type ActionCandidate = { text: string };

test.describe("INSSA stability checks", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  test.beforeEach(async ({ page }) => {
    page.setDefaultNavigationTimeout(30_000);
  });

  test("authenticated surface survives repeated reloads", async ({ page, authPage }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", async () => {
        await authPage.goToProfile();
        await authPage.expectProfileSurface();
      }, { phase: "navigation" });

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await monitor.step(`reload authenticated profile cycle ${attempt + 1}`, async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
          await waitForSettledSurface(page);
          await expectStableAuthenticatedSurface(page);
          await expectAuthenticatedRoute(page, `reload cycle ${attempt + 1}`);
        }, { phase: "navigation" });
      }

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("rapid authenticated navigation clicks remain stable", async ({ page, authPage }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", async () => {
        await authPage.goToProfile();
        await authPage.expectProfileSurface();
      }, { phase: "navigation" });

      const actions = await collectNavigationActions(page);
      expect(actions.length, "Expected at least two visible authenticated section actions.").toBeGreaterThanOrEqual(2);

      for (let cycle = 0; cycle < 2; cycle += 1) {
        for (const action of actions.slice(0, 2)) {
          await monitor.step(`rapid navigation cycle ${cycle + 1} via "${action.text}"`, async () => {
            await authPage.goToProfile();
            await authPage.expectProfileSurface();

            const beforeUrl = page.url();
            await clickVisibleAction(page, action.text);
            await page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 5_000 }).catch(() => {});

            await waitForSettledSurface(page);
            await expectStableAuthenticatedSurface(page);
            await expectAuthenticatedRoute(page, `navigation action "${action.text}"`);
          }, { phase: "navigation" });
        }
      }

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("slow network reload does not break the authenticated UI", async ({ page, context, authPage }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", async () => {
        await authPage.goToProfile();
        await authPage.expectProfileSurface();
      }, { phase: "navigation" });

      const slowNetworkHandler = async (route: Route) => {
        const request = route.request();
        if (request.isNavigationRequest() || ["document", "xhr", "fetch"].includes(request.resourceType())) {
          await delay(300);
        }
        await route.continue();
      };

      await context.route("**/*", slowNetworkHandler);

      try {
        const progressbar = page.getByRole("progressbar").first();
        const loadingObserved = progressbar
          .waitFor({ state: "visible", timeout: 4_000 })
          .then(() => true)
          .catch(() => false);

        await monitor.step("reload authenticated profile under delayed network", async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
          const progressbarShown = await loadingObserved;

          await waitForSettledSurface(page, 20_000);
          await expectStableAuthenticatedSurface(page);
          await expectAuthenticatedRoute(page, "slow-network reload");

          if (progressbarShown) {
            await expect(progressbar, "Expected the delayed loading indicator to resolve.").toBeHidden({ timeout: 10_000 });
          }
        }, { phase: "navigation" });
      } finally {
        await context.unroute("**/*", slowNetworkHandler);
      }

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});

async function collectNavigationActions(page: Page): Promise<ActionCandidate[]> {
  const actions = page.locator("button, a[href]").filter({ hasText: NAVIGATION_ACTION_PATTERN });
  const seen = new Set<string>();
  const results: ActionCandidate[] = [];
  const total = await actions.count();

  for (let index = 0; index < total; index += 1) {
    const action = actions.nth(index);
    if (!(await action.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await action.textContent());
    if (!text || seen.has(text)) {
      continue;
    }

    results.push({ text });
    seen.add(text);
  }

  return results;
}

async function clickVisibleAction(page: Page, text: string): Promise<void> {
  const action = page
    .locator("button, a[href]")
    .filter({ hasText: new RegExp(escapeRegExp(text), "i") })
    .first();

  await expect(action, `Expected the action "${text}" to be visible.`).toBeVisible();
  await action.click();
}

async function expectStableAuthenticatedSurface(page: Page): Promise<void> {
  await expectPageNotBlank(page);

  const interactiveCount = await page.locator("a[href], button, input:not([type='hidden']), select, textarea").count();
  const emptyState = page
    .locator("main, [role='main'], body")
    .locator("h1, h2, h3, p, span, div, li")
    .filter({ hasText: EMPTY_STATE_PATTERN })
    .first();

  expect(
    interactiveCount > 0 || (await emptyState.isVisible().catch(() => false)),
    "Expected the authenticated INSSA surface to expose interactive UI or a valid empty state."
  ).toBeTruthy();
}

async function expectAuthenticatedRoute(page: Page, contextLabel: string): Promise<void> {
  const url = page.url();
  expect(
    !/\/signin\/?$|\/sign-in\/?$|\/login\/?$|\/auth/i.test(url),
    `Expected ${contextLabel} to remain on an authenticated INSSA route, but landed on "${url}".`
  ).toBeTruthy();
}

async function waitForSettledSurface(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});

  const progressbar = page.getByRole("progressbar").first();
  if (await progressbar.isVisible().catch(() => false)) {
    await expect(progressbar, "Expected route loading to finish before assertions.").toBeHidden({ timeout }).catch(() => {});
  }
}

function normalizeText(value: string | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
