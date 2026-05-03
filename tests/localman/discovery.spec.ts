import type { Locator, Page } from "@playwright/test";
import { LocalManPage } from "../../pages/localman/localman-page";
import { createCriticalPageMonitor } from "../../utils/assertions";
import { expect, test } from "./fixtures";
import {
  hasLocalManVendors,
  LOCALMAN_EMPTY_STATE_TEXT,
  type LocalManDiscoveryState
} from "../../utils/test-data";

const MAX_VENDOR_CARDS_TO_VALIDATE = 6;
const DISTANCE_PATTERN = /(\d+(?:\.\d+)?)\s*(km|mi|m)\b/i;

type DiscoveryContext = {
  localman: LocalManPage;
  monitor: ReturnType<typeof createCriticalPageMonitor>;
  state: LocalManDiscoveryState;
};

async function loadDiscovery(page: Page): Promise<DiscoveryContext> {
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

test.describe("Local Man vendor discovery", () => {
  test("discovery shows vendor cards or the correct empty state", async ({ page }) => {
    const { localman, monitor, state } = await loadDiscovery(page);

    await localman.expectVendorCardsOrValidEmptyState(state);

    if (!hasLocalManVendors(state)) {
      await expect(page.getByText(LOCALMAN_EMPTY_STATE_TEXT, { exact: false })).toBeVisible();
    }

    await monitor.expectNoCriticalIssues();
  });

  test("vendor cards render minimal info without duplicate cards or broken images when vendors exist", async ({ page }) => {
    const { monitor, state } = await loadDiscovery(page);
    skipIfNoVendors(state);

    const cards = await getVisibleVendorCards(page);
    expect(cards.length, "Expected visible vendor cards when Local Man discovery is in the vendor-present state.").toBeGreaterThan(0);

    const signatures: string[] = [];

    for (const card of cards) {
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
    const { localman, monitor, state } = await loadDiscovery(page);
    skipIfNoVendors(state);

    await localman.expectFirstVendorCardInteraction();
    await localman.openFirstVendorDetail();
    await monitor.expectNoCriticalIssues();
  });

  test("nearby distances are sorted when comparable distance values are rendered", async ({ page }) => {
    const { monitor, state } = await loadDiscovery(page);
    skipIfNoVendors(state);

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
  const excludedText = /selected vendor|no vendor selected|no vendors matched this search/i;

  return [
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

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
