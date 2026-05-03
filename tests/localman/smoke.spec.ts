import { test } from "./fixtures";
import { LocalManPage } from "../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../utils/assertions";
import { hasLocalManVendors, type LocalManDiscoveryState } from "../../utils/test-data";

async function loadDiscoveryState(localman: LocalManPage): Promise<LocalManDiscoveryState> {
  await localman.gotoPublicDiscovery();
  await localman.expectPublicDiscoverySurface();
  return localman.detectDiscoveryState();
}

function skipIfNoVendors(state: LocalManDiscoveryState) {
  test.skip(!hasLocalManVendors(state), "Local Man discovery rendered the validated empty state in this environment.");
}

test.describe("Local Man always-run smoke checks", () => {
  test("homepage loads", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    await localman.gotoHome();
    await localman.expectHomePageLoad();
    await monitor.expectNoCriticalIssues();
  });

  test("public discovery page loads", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await monitor.expectNoCriticalIssues();
  });

  test("map container renders or explicit fallback renders", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();
    await monitor.expectNoCriticalIssues();
  });

  test("user can open discovery page and see either at least 1 vendor card or a valid empty state message", async ({
    page
  }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const state = await loadDiscoveryState(localman);
    await localman.expectVendorCardsOrValidEmptyState(state);
    await monitor.expectNoCriticalIssues();
  });
});

test.describe("Local Man vendor interaction smoke checks", () => {
  test("first vendor card is interactive when vendors exist", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const state = await loadDiscoveryState(localman);
    await monitor.expectNoCriticalIssues();
    skipIfNoVendors(state);

    await localman.expectFirstVendorCardInteraction();
    await monitor.expectNoCriticalIssues();
  });

  test("first vendor card can open a detail page when vendors exist", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const state = await loadDiscoveryState(localman);
    await monitor.expectNoCriticalIssues();
    skipIfNoVendors(state);

    await localman.openFirstVendorDetail();
    await monitor.expectNoCriticalIssues();
  });

  test("call and directions buttons are visible when vendors exist", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page);
    const state = await loadDiscoveryState(localman);
    await monitor.expectNoCriticalIssues();
    skipIfNoVendors(state);

    await localman.openFirstVendorDetail();
    await localman.expectCallAndDirectionsVisible();
    await monitor.expectNoCriticalIssues();
  });
});
