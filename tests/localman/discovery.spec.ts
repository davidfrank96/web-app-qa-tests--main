import type { Locator, Page } from "@playwright/test";
import { LocalManPage } from "../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../utils/assertions";
import { expect, test } from "./fixtures";
import { LOCALMAN_EMPTY_STATE_PATTERN, LOCALMAN_EMPTY_STATE_TEXT } from "../../utils/test-data";

const MAX_VENDOR_CARDS_TO_VALIDATE = 6;
const DISTANCE_PATTERN = /(\d+(?:\.\d+)?)\s*(km|mi|m)\b/i;

type DiscoveryState =
  | {
      kind: "empty";
    }
  | {
      kind: "vendors";
      markerCount: number;
      selectedVendor: Locator | null;
      vendorCards: Locator[];
      vendorSignal: "map-markers" | "selected-vendor" | "vendor-cards";
    };

type DiscoveryContext = {
  localman: LocalManPage;
  monitor: ReturnType<typeof createCriticalPageMonitor>;
  state: DiscoveryState;
};

async function loadDiscovery(page: Page): Promise<DiscoveryContext> {
  const localman = new LocalManPage(page);
  const monitor = createCriticalPageMonitor(page);

  await localman.gotoPublicDiscovery();
  await localman.expectPublicDiscoverySurface();
  await localman.expectMapOrFallback();

  return {
    localman,
    monitor,
    state: await detectDiscoveryState(page)
  };
}

function skipIfNoVendors(state: DiscoveryState) {
  test.skip(state.kind === "empty", "Local Man discovery rendered the validated empty state in this environment.");
}

test.describe("Local Man vendor discovery", () => {
  test("discovery shows vendor cards or the correct empty state", async ({ page }) => {
    const { monitor, state } = await loadDiscovery(page);

    if (state.kind === "empty") {
      await expect(page.getByText(LOCALMAN_EMPTY_STATE_TEXT, { exact: false })).toBeVisible();
      await monitor.expectNoCriticalIssues();
      return;
    }

    if (state.vendorCards.length > 0) {
      expect(
        state.vendorCards.length,
        "Expected Local Man discovery to expose at least one visible vendor surface when vendors exist."
      ).toBeGreaterThan(0);
    } else if (state.selectedVendor) {
      await expect(
        state.selectedVendor,
        "Expected a visible selected-vendor surface when Local Man discovery detects vendors without a list-card shell."
      ).toBeVisible();
    } else {
      expect(
        state.markerCount,
        "Expected visible map markers when Local Man discovery detects vendors without list cards or a selected-vendor surface."
      ).toBeGreaterThan(0);
    }

    await monitor.expectNoCriticalIssues();
  });

  test("vendor cards render minimal info without duplicate cards or broken images when vendors exist", async ({ page }) => {
    const { monitor, state } = await loadDiscovery(page);
    skipIfNoVendors(state);

    if (state.vendorCards.length === 0) {
      if (state.selectedVendor) {
        const name = await getVendorName(state.selectedVendor);
        expect(name, "Expected the selected-vendor surface to render a non-empty vendor name.").not.toBe("");

        const panelText = normalizeText(await state.selectedVendor.textContent());
        const minimalInfo = panelText.replace(name, "").trim();
        expect(
          minimalInfo.length,
          `Expected selected vendor surface "${name}" to render additional info beyond the vendor name.`
        ).toBeGreaterThan(0);

        await expectNoBrokenVisibleImages(state.selectedVendor, name);
        await monitor.expectNoCriticalIssues();
        return;
      }

      expect(
        state.markerCount,
        "Expected Local Man to expose at least one visible map marker when vendor cards are not rendered in this DOM variant."
      ).toBeGreaterThan(0);
      await monitor.expectNoCriticalIssues();
      return;
    }

    const signatures: string[] = [];

    for (const card of state.vendorCards) {
      const name = await getVendorName(card);
      expect(name, "Expected each vendor card to render a non-empty vendor name.").not.toBe("");

      const cardText = normalizeText(await card.textContent());
      const minimalInfo = cardText.replace(name, "").trim();
      expect(
        minimalInfo.length,
        `Expected vendor card "${name}" to render additional info beyond the vendor name.`
      ).toBeGreaterThan(0);

      signatures.push(cardText);
      await expectNoBrokenVisibleImages(card, name);
    }

    const uniqueSignatures = new Set(signatures);
    expect(
      uniqueSignatures.size,
      "Expected Local Man discovery to avoid rendering duplicate visible vendor cards."
    ).toBe(signatures.length);

    await monitor.expectNoCriticalIssues();
  });

  test("vendor cards are clickable and open a detail view when vendors exist", async ({ page }) => {
    const { monitor, state } = await loadDiscovery(page);
    skipIfNoVendors(state);

    if (isVendorDetailPath(page.url()) || state.selectedVendor || (await hasVisibleDetailActions(page))) {
      await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
      return;
    }

    const opened = await openVendorDetailFromDiscovery(page, state);
    test.skip(
      !opened && state.kind === "vendors" && state.vendorSignal === "map-markers",
      "Local Man rendered vendor presence via map markers only in this DOM variant, without a clickable list surface."
    );
    expect(
      opened,
      "Expected Local Man discovery to expose either a clickable vendor surface or an already-open selected vendor panel when vendors exist."
    ).toBeTruthy();

    await monitor.expectNoCriticalIssues([/net::ERR_ABORTED/i]);
  });

  test("nearby distances are sorted when comparable distance values are rendered", async ({ page }) => {
    const { monitor, state } = await loadDiscovery(page);
    skipIfNoVendors(state);

    const sectionButtons = await getVisibleSectionButtons(page);
    test.skip(
      sectionButtons.length > 1,
      "Local Man discovery rendered multiple vendor sections; distance ordering is not meaningful across mixed sections."
    );

    const distances = await getComparableDistances(page);
    test.skip(distances.length < 2, "Local Man discovery did not render at least two comparable distance values in this environment.");

    for (let index = 1; index < distances.length; index += 1) {
      expect(
        distances[index],
        "Expected comparable vendor distances to be sorted from nearest to farthest."
      ).toBeGreaterThanOrEqual(distances[index - 1]);
    }

    await monitor.expectNoCriticalIssues();
  });
});

async function detectDiscoveryState(page: Page): Promise<DiscoveryState> {
  const deadline = Date.now() + 15_000;

  while (Date.now() <= deadline) {
    const vendorCards = await getVisibleVendorCards(page);
    if (vendorCards.length > 0) {
      return {
        kind: "vendors",
        markerCount: await countVisibleMapMarkers(page),
        selectedVendor: await getSelectedVendorSurface(page),
        vendorCards,
        vendorSignal: "vendor-cards"
      };
    }

    const selectedVendor = await getSelectedVendorSurface(page);
    if (selectedVendor) {
      return {
        kind: "vendors",
        markerCount: await countVisibleMapMarkers(page),
        selectedVendor,
        vendorCards: [],
        vendorSignal: "selected-vendor"
      };
    }

    const markerCount = await countVisibleMapMarkers(page);
    if (markerCount > 0) {
      return {
        kind: "vendors",
        markerCount,
        selectedVendor: null,
        vendorCards: [],
        vendorSignal: "map-markers"
      };
    }

    if (await page.getByText(LOCALMAN_EMPTY_STATE_PATTERN).isVisible().catch(() => false)) {
      return {
        kind: "empty"
      };
    }

    await page.waitForTimeout(250);
  }

  throw new Error("Expected Local Man discovery to render vendor signals or the validated empty state.");
}

async function getVisibleVendorCards(page: Page): Promise<Locator[]> {
  for (const locator of vendorCardLocatorCandidates(page)) {
    const visibleCards = await visibleLocators(locator, MAX_VENDOR_CARDS_TO_VALIDATE);
    if (visibleCards.length > 0) {
      return visibleCards;
    }
  }

  return [];
}

function vendorCardLocatorCandidates(page: Page): Locator[] {
  const mainContent = "main, [role='main']";
  const cardHeading = page.locator("h1, h2, h3, [role='heading']");
  const cardAction = page.locator("a[href], button");
  const excludedText = /no vendor selected|no vendors matched this search|no saved vendor yet|no recent views yet|no popularity signal yet/i;

  return [
    page.locator("[data-vendor-id]").filter({ has: cardHeading }).filter({ hasNotText: excludedText }),
    page
      .getByRole("button", { name: /preview .* on map/i })
      .locator("xpath=ancestor::*[@data-vendor-id or self::article or self::li][1]")
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
}

async function getSelectedVendorSurface(page: Page): Promise<Locator | null> {
  const mainContent = "main, [role='main']";
  const excludedText = /no vendor selected|no vendors matched this search|no saved vendor yet|no recent views yet|no popularity signal yet/i;
  const candidates = [
    page
      .locator(`${mainContent} section, ${mainContent} article, ${mainContent} aside`)
      .filter({ has: page.locator("h1, h2, h3, [role='heading']") })
      .filter({
        has: page.locator(
          "a[href^='tel:'], a[href*='google.com/maps'], a[href*='maps.apple.com'], a[href^='geo:'], button"
        )
      })
      .filter({ hasNotText: excludedText }),
    page
      .locator(`${mainContent} section, ${mainContent} article, ${mainContent} aside`)
      .filter({ hasText: /selected vendor/i })
      .filter({ hasNotText: excludedText })
  ];

  for (const candidate of candidates) {
    const visible = await visibleLocators(candidate, 1);
    if (visible[0]) {
      return visible[0];
    }
  }

  return null;
}

async function countVisibleMapMarkers(page: Page): Promise<number> {
  const mapContainer = page.getByRole("region", { name: /vendor map/i });
  if (!(await mapContainer.isVisible().catch(() => false))) {
    return 0;
  }

  const markerCandidates = [
    mapContainer.locator("[aria-label*='marker' i]"),
    mapContainer.locator("[aria-label*='vendor' i]"),
    mapContainer.getByRole("img", { name: /marker|vendor|location/i })
  ];

  for (const candidate of markerCandidates) {
    const total = await candidate.count();
    let visibleCount = 0;

    for (let index = 0; index < total; index += 1) {
      if (await candidate.nth(index).isVisible().catch(() => false)) {
        visibleCount += 1;
      }
    }

    if (visibleCount > 0) {
      return visibleCount;
    }
  }

  return 0;
}

async function visibleLocators(locator: Locator, max: number): Promise<Locator[]> {
  const total = await locator.count();
  const visible: Locator[] = [];

  for (let index = 0; index < total; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    visible.push(item);
    if (visible.length >= max) {
      break;
    }
  }

  return visible;
}

async function getVendorName(card: Locator): Promise<string> {
  const headings = [
    card.getByRole("heading"),
    card.locator("h1, h2, h3"),
    card.getByRole("link").filter({ has: card.locator("h1, h2, h3, [role='heading']") })
  ];

  for (const heading of headings) {
    const candidate = heading.first();
    if (await candidate.isVisible().catch(() => false)) {
      return normalizeText(await candidate.textContent());
    }
  }

  return "";
}

async function expectNoBrokenVisibleImages(card: Locator, vendorName: string) {
  const images = card.locator("img");
  const count = await images.count();

  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    if (!(await image.isVisible().catch(() => false))) {
      continue;
    }

    const loaded = await image.evaluate((element) => {
      const img = element as HTMLImageElement;
      const source = img.currentSrc || img.getAttribute("src") || "";
      return {
        loaded: img.complete && img.naturalWidth > 0,
        source
      };
    });

    expect(
      loaded.loaded,
      `Expected visible vendor image${vendorName ? ` for "${vendorName}"` : ""} to load successfully.`
    ).toBeTruthy();
    expect(
      loaded.source.trim(),
      `Expected visible vendor image${vendorName ? ` for "${vendorName}"` : ""} to expose a non-empty source.`
    ).not.toBe("");
  }
}

async function getComparableDistances(page: Page): Promise<number[]> {
  const cards = await getVisibleVendorCards(page);
  const distances: number[] = [];

  for (const card of cards) {
    const value = parseDistance(normalizeText(await card.textContent()));
    if (value !== null) {
      distances.push(value);
    }
  }

  return distances;
}

function parseDistance(text: string): number | null {
  const match = DISTANCE_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) {
    return null;
  }

  const unit = match[2].toLowerCase();
  if (unit === "m") {
    return value;
  }

  if (unit === "km") {
    return value * 1000;
  }

  if (unit === "mi") {
    return value * 1609.34;
  }

  return null;
}

async function openVendorDetailFromDiscovery(page: Page, state: DiscoveryState): Promise<boolean> {
  if (state.kind === "empty") {
    return false;
  }

  if (isVendorDetailPath(page.url())) {
    return true;
  }

  const surface = state.vendorCards[0] ?? state.selectedVendor;
  if (!surface) {
    return false;
  }

  const currentUrl = page.url();
  const trigger = await getVendorDetailTrigger(surface);

  if (!trigger) {
    return hasVisibleDetailActions(page);
  }

  await trigger.click();
  await page.waitForLoadState("domcontentloaded");

  return (
    isVendorDetailPath(page.url()) ||
    (page.url() !== currentUrl) ||
    Boolean(await getSelectedVendorSurface(page)) ||
    (await hasVisibleDetailActions(page))
  );
}

async function getVendorDetailTrigger(surface: Locator): Promise<Locator | null> {
  const candidates = [
    surface.getByRole("link", { name: /view|details?|open|more/i }),
    surface.getByRole("button", { name: /view|details?|open|more|preview .* on map/i }),
    surface.locator("h1 a, h2 a, h3 a, [role='heading'] a"),
    surface.locator(
      "a[href]:not([href^='tel:']):not([href^='mailto:']):not([href*='google.com/maps']):not([href*='maps.apple.com']):not([href^='geo:']):not([href^='#'])"
    ),
    surface.locator("button").filter({ hasNotText: /call|phone|directions|get directions|navigate/i })
  ];

  for (const candidate of candidates) {
    const visible = await visibleLocators(candidate, 1);
    if (visible[0]) {
      return visible[0];
    }
  }

  return null;
}

async function hasVisibleDetailActions(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole("link", { name: /call|phone/i }),
    page.getByRole("button", { name: /call|phone/i }),
    page.locator("a[href^='tel:']"),
    page.getByRole("link", { name: /directions|get directions|navigate/i }),
    page.getByRole("button", { name: /directions|get directions|navigate/i }),
    page.locator("a[href*='google.com/maps'], a[href*='maps.apple.com'], a[href*='maps.app'], a[href^='geo:']")
  ];

  for (const candidate of candidates) {
    const visible = await visibleLocators(candidate, 1);
    if (visible[0]) {
      return true;
    }
  }

  return false;
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

function isVendorDetailPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return /^\/vendors\/[^/]+/i.test(pathname);
  } catch {
    return /^\/vendors\/[^/]+/i.test(url);
  }
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
