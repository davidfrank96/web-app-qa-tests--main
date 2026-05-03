import { expect, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank, expectPageReady, expectVisiblePageUi } from "../../utils/assertions";
import { recordLocalManLoadTime } from "../../utils/localman-results";
import {
  detectLocalManDiscoveryState,
  hasLocalManVendors,
  LOCALMAN_EMPTY_STATE_PATTERN,
  type LocalManDiscoveryState
} from "../../utils/test-data";

const DEFAULT_TIMEOUT = 15_000;
const MAP_FALLBACK_PATTERN = /map unavailable|unable to load map|could not load map|list view only/i;
const PUBLIC_DISCOVERY_PATHS = [
  "/",
  "/discover",
  "/discovery",
  "/vendors",
  "/nearby",
  "/directory",
  "/map"
];

export class LocalManPage {
  constructor(private readonly page: Page) {}

  async gotoHome() {
    await this.gotoPath("/");
  }

  async gotoPublicDiscovery(): Promise<string> {
    for (const path of PUBLIC_DISCOVERY_PATHS) {
      const loaded = await this.gotoPath(path, { allowHttpError: true });
      if (!loaded) {
        continue;
      }

      if (await this.hasDiscoverySurface()) {
        return path;
      }
    }

    throw new Error(
      `Could not find a Local Man public discovery surface on any candidate route: ${PUBLIC_DISCOVERY_PATHS.join(", ")}`
    );
  }

  async expectHomePageLoad() {
    await expectPageReady(this.page);
    await this.expectBaselineUi("Expected the homepage to render visible Local Man UI.");
    await this.expectAnyVisible(
      [
        this.page.getByRole("main"),
        this.page.getByRole("banner"),
        this.page.getByRole("heading"),
        this.page.getByRole("link")
      ],
      "Expected the homepage to render a visible landmark, heading, or primary link."
    );
  }

  async expectPublicDiscoverySurface() {
    await expectPageReady(this.page);
    await this.expectBaselineUi("Expected the public discovery page to render visible Local Man UI.");
    await this.expectAnyVisible(
      [
        this.page.getByRole("heading", { name: /discover|directory|nearby|results|vendors?/i }),
        this.page.getByRole("searchbox"),
        this.page.getByRole("textbox", { name: /search|location|vendor|business/i }),
        this.page.getByRole("button", { name: /map|list|search|filter/i }),
        ...this.vendorCardLocators(),
        this.emptyStateMessageLocator(),
        this.mapContainerLocator()
      ],
      "Expected the public discovery page to render search, vendors, map content, or an empty state."
    );
  }

  async detectDiscoveryState(): Promise<LocalManDiscoveryState> {
    const deadline = Date.now() + DEFAULT_TIMEOUT;

    while (Date.now() <= deadline) {
      const state = detectLocalManDiscoveryState({
        emptyStateVisible: await this.emptyStateMessageLocator().isVisible().catch(() => false),
        vendorCount: await this.firstVisibleVendorCount()
      });
      if (state) {
        return state;
      }

      await this.page.waitForTimeout(250);
    }

    throw new Error(
      "Expected vendor cards to render or an empty state to appear on the Local Man discovery page."
    );
  }

  async expectVendorCardsVisible() {
    const vendorCards = await this.firstVendorCardLocator();
    expect(vendorCards, "Expected at least one vendor card on the discovery page.").not.toBeNull();
    await expect(vendorCards!.first()).toBeVisible();
  }

  async expectEmptyState() {
    await expect(this.emptyStateMessageLocator()).toBeVisible();
  }

  async expectVendorCardsOrValidEmptyState(state: LocalManDiscoveryState) {
    if (hasLocalManVendors(state)) {
      await this.expectVendorCardsVisible();
      return;
    }

    await this.expectEmptyState();
  }

  async expectMapOrFallback() {
    const mapContainer = this.mapContainerLocator();
    const mapContainerVisible = await mapContainer.isVisible().catch(() => false);

    if (mapContainerVisible) {
      const mountedMap = await this.waitForAnyVisible(this.mapReadyLocators(), 3_000);
      if (mountedMap) {
        return;
      }
    }

    const fallback = await this.waitForAnyVisible(this.mapFallbackLocators(), 3_000);
    expect(
      mapContainerVisible || fallback,
      "Expected either the Local Man map container or explicit fallback UI on the discovery page."
    ).toBeTruthy();

    if (fallback) {
      await expect(
        fallback,
        "Expected explicit map fallback text when the Local Man map surface is missing."
      ).toBeVisible();

      if (mapContainerVisible) {
        const containerText = (await mapContainer.textContent())?.replace(/\s+/g, " ").trim() ?? "";
        expect(
          containerText,
          "Map failed without rendering fallback content; blank map container detected."
        ).not.toBe("");
      }

      return;
    }

    await expect(
      mapContainer,
      "Expected the Local Man map container to be visible when fallback UI is absent."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async expectFirstVendorCardInteraction() {
    await this.getFirstVendorDetailTrigger();
  }

  async openFirstVendorDetail() {
    const currentUrl = this.page.url();
    const detailTrigger = await this.getFirstVendorDetailTrigger();
    await detailTrigger.click();
    await this.page.waitForLoadState("domcontentloaded");
    await this.expectBaselineUi("Expected the vendor detail surface to render visible Local Man UI.");

    const detailSurface = await this.waitForAnyVisible(
      [
        ...this.callActionLocators(),
        ...this.directionsActionLocators(),
        this.page.getByRole("button", { name: /back/i }),
        this.page.getByRole("link", { name: /back/i })
      ],
      DEFAULT_TIMEOUT
    );

    expect(
      this.page.url() !== currentUrl || detailSurface !== null,
      "Expected clicking the first vendor card to navigate to a detail page or reveal vendor detail actions."
    ).toBeTruthy();
  }

  async expectCallAndDirectionsVisible() {
    await this.expectAnyVisible(
      this.callActionLocators(),
      "Expected a visible call action on the vendor detail surface."
    );
    await this.expectAnyVisible(
      this.directionsActionLocators(),
      "Expected a visible directions action on the vendor detail surface."
    );
  }

  private async gotoPath(
    path: string,
    options: {
      allowHttpError?: boolean;
    } = {}
  ): Promise<boolean> {
    const startedAt = Date.now();

    try {
      const response = await this.page.goto(path, { waitUntil: "domcontentloaded" });
      if (response && response.status() >= 400) {
        if (options.allowHttpError) {
          return false;
        }

        throw new Error(`returned HTTP ${response.status()} for path "${path}"`);
      }

      await expectPageReady(this.page);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to load Local Man path "${path}": ${message}`);
    } finally {
      recordLocalManLoadTime(this.page, {
        durationMs: Date.now() - startedAt,
        metric: `navigate:${path}`,
        route: this.page.url() || path
      });
    }
  }

  private async hasDiscoverySurface(): Promise<boolean> {
    return Boolean(
      await this.waitForAnyVisible(
        [
          this.page.getByRole("heading", { name: /discover|directory|nearby|results|vendors?/i }),
          this.page.getByRole("searchbox"),
          this.page.getByRole("textbox", { name: /search|location|vendor|business/i }),
          ...this.vendorCardLocators(),
          this.emptyStateMessageLocator(),
          this.mapContainerLocator()
        ],
        3_000
      )
    );
  }

  private vendorCardLocators(): Locator[] {
    const mainContent = "main, [role='main']";
    return [
      this.page.locator(
        [
          "[data-testid*='vendor']",
          "[data-testid*='business']",
          "[data-testid*='listing']",
          "[data-test*='vendor']",
          "[data-qa*='vendor']"
        ].join(", ")
      ),
      this.page
        .locator(`${mainContent} article, ${mainContent} [role='article']`)
        .filter({ has: this.page.locator("h1, h2, h3, [role='heading']") }),
      this.page
        .locator(`${mainContent} li, ${mainContent} [role='listitem']`)
        .filter({ has: this.page.locator("h1, h2, h3, [role='heading']") })
    ];
  }

  private emptyStateMessageLocator(): Locator {
    return this.page.getByText(LOCALMAN_EMPTY_STATE_PATTERN);
  }

  private mapContainerLocator(): Locator {
    return this.page.getByRole("region", { name: /vendor map/i });
  }

  private mapReadyLocators(): Locator[] {
    const mapContainer = this.mapContainerLocator();
    return [
      mapContainer.getByRole("region", { name: /^map$/i }),
      mapContainer.getByRole("button", { name: /zoom in/i }),
      mapContainer.getByRole("button", { name: /zoom out/i }),
      mapContainer.getByRole("button", { name: /find my location/i }),
      mapContainer.getByRole("link", { name: /maplibre/i })
    ];
  }

  private mapFallbackLocators(): Locator[] {
    return [
      this.mapContainerLocator().getByText(MAP_FALLBACK_PATTERN),
      this.mapContainerLocator().getByRole("status").filter({
        hasText: MAP_FALLBACK_PATTERN
      }),
      this.page.getByText(MAP_FALLBACK_PATTERN),
      this.page.getByRole("status").filter({ hasText: MAP_FALLBACK_PATTERN })
    ];
  }

  private callActionLocators(): Locator[] {
    return [
      this.page.getByRole("link", { name: /call|phone/i }),
      this.page.getByRole("button", { name: /call|phone/i }),
      this.page.locator("a[href^='tel:']")
    ];
  }

  private directionsActionLocators(): Locator[] {
    return [
      this.page.getByRole("link", { name: /directions|get directions|navigate/i }),
      this.page.getByRole("button", { name: /directions|get directions|navigate/i }),
      this.page.locator(
        "a[href*='google.com/maps'], a[href*='maps.apple.com'], a[href*='maps.app'], a[href^='geo:']"
      )
    ];
  }

  private async firstVendorCardLocator(): Promise<Locator | null> {
    if (await this.emptyStateMessageLocator().isVisible().catch(() => false)) {
      return null;
    }

    for (const locator of this.vendorCardLocators()) {
      if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
        return locator;
      }
    }

    return null;
  }

  private async firstVisibleVendorCount(): Promise<number> {
    if (await this.emptyStateMessageLocator().isVisible().catch(() => false)) {
      return 0;
    }

    for (const locator of this.vendorCardLocators()) {
      const count = await locator.count();
      if (count === 0) {
        continue;
      }

      const first = locator.first();
      if (await first.isVisible().catch(() => false)) {
        return count;
      }
    }

    return 0;
  }

  private async getFirstVendorDetailTrigger(): Promise<Locator> {
    const vendorCards = await this.firstVendorCardLocator();
    expect(vendorCards, "Expected at least one vendor card before checking vendor actions.").not.toBeNull();

    const firstCard = vendorCards!.first();
    await expect(firstCard).toBeVisible();

    return this.expectAnyVisible(
      [
        firstCard.getByRole("link", { name: /view|details?|open|more/i }),
        firstCard.getByRole("button", { name: /view|details?|open|more/i }),
        firstCard.locator("h1 a, h2 a, h3 a, [role='heading'] a"),
        firstCard.locator(
          "a[href]:not([href^='tel:']):not([href^='mailto:']):not([href*='google.com/maps']):not([href*='maps.apple.com']):not([href^='#'])"
        ),
        firstCard.locator("button").filter({ hasNotText: /call|phone|directions|get directions|navigate/i })
      ],
      "Expected the first vendor card to expose a detail link or button."
    );
  }

  private async expectAnyVisible(
    candidates: Locator[],
    message: string,
    timeout = DEFAULT_TIMEOUT
  ): Promise<Locator> {
    const visible = await this.waitForAnyVisible(candidates, timeout);
    expect(visible, message).not.toBeNull();
    return visible!;
  }

  private async expectBaselineUi(message: string): Promise<void> {
    await expectPageNotBlank(this.page);
    await expectVisiblePageUi(this.page, message);
  }

  private async waitForAnyVisible(
    candidates: Locator[],
    timeout = DEFAULT_TIMEOUT
  ): Promise<Locator | null> {
    const deadline = Date.now() + timeout;

    while (Date.now() <= deadline) {
      for (const candidate of candidates) {
        const current = candidate.first();
        if (await current.isVisible().catch(() => false)) {
          return current;
        }
      }

      await this.page.waitForTimeout(200);
    }

    return null;
  }
}
