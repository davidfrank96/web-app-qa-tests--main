import type { Locator, Page } from "@playwright/test";
import { LocalManPage } from "../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../utils/assertions";
import { recordLocalManLoadTime } from "../../utils/localman-results";
import { expect, test } from "./fixtures";

const SLOW_THRESHOLD_MS = 5_000;
const FAIL_THRESHOLD_MS = 10_000;
const RELOAD_CYCLES = 4;
const EMPTY_VENDOR_STATE_PATTERN =
  /No vendors matched this search|No saved vendor yet|No recent views yet|No popularity signal yet|No vendor selected/i;
const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};

test.describe("Local Man stability and performance", () => {
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("homepage shell and discovery state load within thresholds", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    const home = await measureDuration(async () => {
      await localman.gotoHome();
      await localman.expectHomePageLoad();
    });
    assertDurationWithinThreshold({
      durationMs: home.durationMs,
      metric: "page-load",
      route: page.url(),
      testName: testInfo.title
    });
    recordLocalManLoadTime(page, {
      durationMs: home.durationMs,
      metric: "page-load",
      route: page.url()
    });

    const discovery = await measureDuration(async () => {
      await localman.gotoPublicDiscovery();
      await localman.expectPublicDiscoverySurface();
      const state = await localman.detectDiscoveryState();
      await localman.expectVendorCardsOrValidEmptyState(state);
      await localman.expectMapOrFallback();
    });
    assertDurationWithinThreshold({
      durationMs: discovery.durationMs,
      metric: "discovery-load",
      route: page.url(),
      testName: testInfo.title
    });
    recordLocalManLoadTime(page, {
      durationMs: discovery.durationMs,
      metric: "discovery-load",
      route: page.url()
    });

    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/]);
  });

  test("repeated reloads keep the discovery UI stable", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();

    for (let cycle = 1; cycle <= RELOAD_CYCLES; cycle += 1) {
      const reload = await measureDuration(async () => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await localman.expectPublicDiscoverySurface();
        const state = await localman.detectDiscoveryState();
        await localman.expectVendorCardsOrValidEmptyState(state);
      });

      assertDurationWithinThreshold({
        durationMs: reload.durationMs,
        metric: `reload-${cycle}`,
        route: page.url(),
        testName: testInfo.title
      });
      recordLocalManLoadTime(page, {
        durationMs: reload.durationMs,
        metric: `reload-${cycle}`,
        route: page.url()
      });
    }

    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/]);
  });

  test("rapid discovery interactions do not break the UI", async ({ page }, testInfo) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();

    const interaction = await measureDuration(async () => {
      const sectionButtons = await getVisibleSectionButtons(page);
      expect(sectionButtons.length, "Expected Local Man discovery to expose at least two visible section buttons.").toBeGreaterThanOrEqual(2);

      for (const button of sectionButtons.slice(0, 4)) {
        await button.click();
        await expect(button).toBeVisible();
      }

      const vendorCards = await getActualVendorCards(page);
      if (vendorCards.length === 0) {
        const placeholder = await findVisibleByText(page, EMPTY_VENDOR_STATE_PATTERN);
        expect(
          placeholder,
          "Expected a visible empty or placeholder vendor state after rapid Local Man discovery interactions."
        ).not.toBeNull();
        return;
      }

      await localman.expectFirstVendorCardInteraction();
      await localman.openFirstVendorDetail();
    });

    assertDurationWithinThreshold({
      durationMs: interaction.durationMs,
      metric: "rapid-interaction",
      route: page.url(),
      testName: testInfo.title
    });
    recordLocalManLoadTime(page, {
      durationMs: interaction.durationMs,
      metric: "rapid-interaction",
      route: page.url()
    });

    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/]);
  });
});

async function measureDuration<T>(operation: () => Promise<T>) {
  const startedAt = Date.now();
  const result = await operation();
  return {
    durationMs: Date.now() - startedAt,
    result
  };
}

function assertDurationWithinThreshold(input: {
  durationMs: number;
  metric: string;
  route: string;
  testName: string;
}) {
  const status = classifyDuration(input.durationMs);
  console.log(
    `LOCALMAN_STABILITY ${JSON.stringify({
      durationMs: input.durationMs,
      metric: input.metric,
      route: input.route,
      status,
      test: input.testName
    })}`
  );

  expect(
    input.durationMs,
    `Expected Local Man ${input.metric} to complete within ${FAIL_THRESHOLD_MS}ms. Measured ${input.durationMs}ms (${status}).`
  ).toBeLessThanOrEqual(FAIL_THRESHOLD_MS);
}

function classifyDuration(durationMs: number) {
  if (durationMs > FAIL_THRESHOLD_MS) {
    return "fail";
  }

  if (durationMs > SLOW_THRESHOLD_MS) {
    return "slow";
  }

  return "healthy";
}

async function getVisibleSectionButtons(page: Page): Promise<Locator[]> {
  const locator = page.getByRole("button", { name: /nearby|recent|popular|last selected/i });
  const count = await locator.count();
  const visible: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const button = locator.nth(index);
    if (await button.isVisible().catch(() => false)) {
      visible.push(button);
    }
  }

  return visible;
}

async function getActualVendorCards(page: Page): Promise<Locator[]> {
  const mainContent = "main, [role='main']";
  const cardHeading = page.locator("h1, h2, h3, [role='heading']");
  const cardAction = page.locator("a[href], button");
  const excludedText = /selected vendor|no vendor selected|no vendors matched this search|no saved vendor yet|no recent views yet|no popularity signal yet/i;

  const candidates = [
    page
      .locator(
        [
          "[data-testid*='vendor']",
          "[data-testid*='business']",
          "[data-testid*='listing']",
          "[data-test*='vendor']",
          "[data-qa*='vendor']"
        ].join(", ")
      )
      .filter({ has: cardHeading })
      .filter({ hasNotText: excludedText }),
    page
      .locator(`${mainContent} article, ${mainContent} [role='article']`)
      .filter({ has: cardHeading })
      .filter({ has: cardAction })
      .filter({ hasNotText: excludedText }),
    page
      .locator(`${mainContent} li, ${mainContent} [role='listitem']`)
      .filter({ has: cardHeading })
      .filter({ has: cardAction })
      .filter({ hasNotText: excludedText })
  ];

  for (const locator of candidates) {
    const count = await locator.count();
    const visible: Locator[] = [];

    for (let index = 0; index < count; index += 1) {
      const card = locator.nth(index);
      if (await card.isVisible().catch(() => false)) {
        visible.push(card);
      }
    }

    if (visible.length > 0) {
      return visible;
    }
  }

  return [];
}

async function findVisibleByText(page: Page, pattern: RegExp): Promise<Locator | null> {
  const locator = page.getByText(pattern);
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return null;
}
