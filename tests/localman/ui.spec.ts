import { devices, type Locator, type Page } from "@playwright/test";
import { LocalManPage } from "../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../utils/assertions";
import { hasLocalManVendors, LOCALMAN_EMPTY_STATE_TEXT, type LocalManDiscoveryState } from "../../utils/test-data";
import { expect, test } from "./fixtures";

type UiContext = {
  localman: LocalManPage;
  monitor: ReturnType<typeof createCriticalPageMonitor>;
  state: LocalManDiscoveryState;
};

async function loadUiContext(page: Page): Promise<UiContext> {
  const localman = new LocalManPage(page);
  const monitor = createCriticalPageMonitor(page);

  await localman.gotoPublicDiscovery();
  await localman.expectPublicDiscoverySurface();

  return {
    localman,
    monitor,
    state: await localman.detectDiscoveryState()
  };
}

function skipIfNoVendors(state: LocalManDiscoveryState) {
  test.skip(!hasLocalManVendors(state), "Local Man discovery rendered the validated empty state in this environment.");
}

test.describe("Local Man desktop UI usability", () => {
  test("floating search and filter controls are visible, interactable, and not overlapped", async ({ page }) => {
    const { monitor } = await loadUiContext(page);

    const search = await getPrimarySearchInput(page);
    const filterButton = await getFilterButton(page);

    await expectControlInteractable(search, "Expected the Local Man floating search control to be usable.");
    await expectControlInteractable(filterButton, "Expected the Local Man filter control to be usable.");
    await expectNoOverlap(search, filterButton, "Expected the Local Man search bar and filter button not to overlap.");
    await expectResponsiveLayout(page);

    await search.fill("rice");
    await expect(search).toHaveValue("rice");
    await search.fill("");

    await filterButton.click();
    await expectControlInteractable(search, "Expected the search bar to remain usable after clicking filters.");
    await expectControlInteractable(filterButton, "Expected the filter button to remain usable after interaction.");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expectControlInteractable(search, "Expected the floating search control to remain visible after scrolling.");
    await expectControlInteractable(filterButton, "Expected the filter button to remain visible after scrolling.");

    await monitor.expectNoCriticalIssues();
  });

  test("vendor cards open detail when vendors exist, otherwise the empty state remains usable", async ({ page }) => {
    const { localman, monitor, state } = await loadUiContext(page);

    if (!hasLocalManVendors(state)) {
      await expect(page.getByText(LOCALMAN_EMPTY_STATE_TEXT, { exact: false })).toBeVisible();
      await expectControlInteractable(
        await getPrimarySearchInput(page),
        "Expected the search bar to remain usable when Local Man shows the empty state."
      );
      await expectControlInteractable(
        await getFilterButton(page),
        "Expected the filter button to remain usable when Local Man shows the empty state."
      );
      await monitor.expectNoCriticalIssues();
      return;
    }

    await localman.expectFirstVendorCardInteraction();
    await localman.openFirstVendorDetail();
    await monitor.expectNoCriticalIssues();
  });
});

test("Local Man mobile UI stays usable on an iPhone-sized viewport", async ({ browser, localmanResults }, testInfo) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: typeof testInfo.project.use.baseURL === "string" ? testInfo.project.use.baseURL : undefined
  });
  const page = await context.newPage();
  localmanResults.trackPage(page);

  try {
    const { monitor } = await loadUiContext(page);

    const search = await getPrimarySearchInput(page);
    const filterButton = await getFilterButton(page);

    await expectControlInteractable(search, "Expected the Local Man search control to be usable on mobile.");
    await expectControlInteractable(filterButton, "Expected the Local Man filter control to be usable on mobile.");
    await expectNoOverlap(search, filterButton, "Expected the mobile search bar and filter button not to overlap.");
    await expectResponsiveLayout(page);

    await search.fill("pepper");
    await expect(search).toHaveValue("pepper");
    await search.fill("");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await search.scrollIntoViewIfNeeded();
    await filterButton.scrollIntoViewIfNeeded();
    await expectControlInteractable(search, "Expected the primary mobile search control to remain reachable after scroll.");
    await expectControlInteractable(filterButton, "Expected the primary mobile filter control to remain reachable after scroll.");

    await monitor.expectNoCriticalIssues();
  } finally {
    await context.close();
  }
});

async function getPrimarySearchInput(page: Page): Promise<Locator> {
  const search = await firstVisible([
    page.getByRole("searchbox", { name: /search/i }),
    page.getByRole("textbox", { name: /search/i })
  ]);

  expect(search, "Expected Local Man to render a visible primary search input.").not.toBeNull();
  return search!;
}

async function getFilterButton(page: Page): Promise<Locator> {
  const button = await firstVisible([page.getByRole("button", { name: /filter|open filters/i })]);
  expect(button, "Expected Local Man to render a visible filter button.").not.toBeNull();
  return button!;
}

async function firstVisible(locators: Locator[], timeoutMs = 5_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
}

async function expectControlInteractable(locator: Locator, message: string) {
  await expect(locator, message).toBeVisible();
  await expect(locator, message).toBeEnabled();

  const box = await locator.boundingBox();
  expect(box, `${message} Expected a real layout box.`).not.toBeNull();
  expect(box!.width, `${message} Expected a non-zero width.`).toBeGreaterThan(0);
  expect(box!.height, `${message} Expected a non-zero height.`).toBeGreaterThan(0);

  const receivesPointer = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);

    return Boolean(top && (top === element || element.contains(top) || top.contains(element)));
  });

  expect(receivesPointer, `${message} Expected the control not to be hidden behind overlapping UI.`).toBeTruthy();
}

async function expectNoOverlap(first: Locator, second: Locator, message: string) {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();

  expect(firstBox, `${message} Missing first control bounds.`).not.toBeNull();
  expect(secondBox, `${message} Missing second control bounds.`).not.toBeNull();

  const overlaps =
    firstBox!.x < secondBox!.x + secondBox!.width &&
    firstBox!.x + firstBox!.width > secondBox!.x &&
    firstBox!.y < secondBox!.y + secondBox!.height &&
    firstBox!.y + firstBox!.height > secondBox!.y;

  expect(overlaps, message).toBeFalsy();
}

async function expectResponsiveLayout(page: Page) {
  const hasHorizontalOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > window.innerWidth + 1;
  });

  expect(
    hasHorizontalOverflow,
    "Expected the Local Man layout to fit the current viewport without horizontal overflow."
  ).toBeFalsy();
}
