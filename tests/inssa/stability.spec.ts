import { type Page, type Route } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { InssaPage } from "../../pages/inssa/inssa-page";
import { expectPageNotBlank } from "../../utils/assertions";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { expect, test } from "./fixtures";

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

  test("authenticated map surface survives repeated reloads", async ({ page }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
        phase: "navigation",
        route: "/"
      });
      await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
        phase: "assertion"
      });

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await monitor.step(`reload authenticated map cycle ${attempt + 1}`, async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
          await waitForSettledSurface(page);
          await landing.expectAuthenticatedLandingSurface();
          await expectAuthenticatedUrl(page, `reload cycle ${attempt + 1}`);
        }, { phase: "navigation" });
      }

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("authenticated session survives visibility loss and focus restore on the map surface", async ({ page, context }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
        phase: "navigation",
        route: "/"
      });
      await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
        phase: "assertion"
      });

      await monitor.step("background and refocus the authenticated tab", async () => {
        const secondary = await context.newPage();
        try {
          await secondary.goto("about:blank");
          await secondary.bringToFront();
          await page.waitForTimeout(750);
          await page.bringToFront();
          await page.waitForTimeout(1_000);
        } finally {
          await secondary.close().catch(() => {});
        }

        await waitForSettledSurface(page);
        await landing.expectAuthenticatedLandingSurface();
        await expectAuthenticatedUrl(page, "visibility/focus restore");
      }, { phase: "interaction" });

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("stable authenticated routes do not log out during direct navigation", async ({ page }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);
    const inssa = new InssaPage(page);

    const stableRoutes = [
      { path: "/points-ledger", assertSurface: () => inssa.expectPointsLedgerSurface() },
      { path: "/settings", assertSurface: () => inssa.expectSettingsSurface() },
      { path: "/profile/connections", assertSurface: () => inssa.expectConnectionsSurface() },
      { path: "/profile/connections/requests", assertSurface: () => inssa.expectRequestsSurface() }
    ];

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      for (const route of stableRoutes) {
        await monitor.step(`open authenticated route ${route.path}`, async () => {
          await inssa.goToPath(route.path);
          await waitForSettledSurface(page);
          await route.assertSurface();
          await expectAuthenticatedUrl(page, route.path);
        }, { phase: "navigation", route: route.path });
      }

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("slow network reload keeps the authenticated map surface mounted", async ({ page, context }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
        phase: "navigation",
        route: "/"
      });
      await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
        phase: "assertion"
      });

      const slowNetworkHandler = async (route: Route) => {
        const request = route.request();
        if (request.isNavigationRequest() || ["document", "xhr", "fetch"].includes(request.resourceType())) {
          await delay(300);
        }
        await route.continue();
      };

      await context.route("**/*", slowNetworkHandler);

      try {
        await monitor.step("reload authenticated map under delayed network", async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
          await waitForSettledSurface(page, 20_000);
          await landing.expectAuthenticatedLandingSurface();
          await expectAuthenticatedUrl(page, "slow-network map reload");
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

async function expectAuthenticatedUrl(page: Page, contextLabel: string): Promise<void> {
  const url = page.url();
  expect(
    !/\/signin\/?$|\/sign-in\/?$|\/login\/?$|\/auth/i.test(url),
    `Expected ${contextLabel} to remain on an authenticated INSSA route, but landed on "${url}".`
  ).toBeTruthy();
}

async function waitForSettledSurface(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  await expectPageNotBlank(page);

  const progressbar = page.getByRole("progressbar").first();
  if (await progressbar.isVisible().catch(() => false)) {
    await expect(progressbar, "Expected route loading to finish before assertions.").toBeHidden({ timeout }).catch(() => {});
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
