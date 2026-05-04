import { expect, type Locator, type Page } from "@playwright/test";
import { LocalManPage } from "../../../pages/localman/localman-page";
import {
  createCriticalPageMonitor,
  expectPageNotBlank,
  expectPageReady,
  expectVisiblePageUi
} from "../../../utils/assertions";
import { test } from "../fixtures";

const ADMIN_CREATE_VENDOR_PATH = "/admin/vendors/new";
const ADMIN_LOGIN_PATH = "/admin/login";
const SAFE_INJECTION_API_ERROR_PATTERN =
  /Failed to load resource: the server responded with a status of (400|422).*(?:\/api\/(?:vendors\/nearby|location\/reverse)|localhost:3000\/api\/(?:vendors\/nearby|location\/reverse))/i;
const INJECTION_PAYLOADS = [
  "' OR 1=1--",
  "\" OR \"\"=\"",
  "'; DROP TABLE vendors;--",
  "<script>alert(1)</script>"
] as const;
const VALID_GEOLOCATION = {
  latitude: 32.7767,
  longitude: -96.797
};

type Credentials = {
  email: string;
  password: string;
};

type TextInputCandidate = {
  description: string;
  locator: Locator;
};

test.describe("Local Man injection safety", () => {
  test.use({
    geolocation: VALID_GEOLOCATION,
    permissions: ["geolocation"]
  });

  test("public search input treats injection payloads as inert text and does not broaden results", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });
    const dialogs = installDialogTrap(page);

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    const search = await getPrimarySearchInput(page);
    const baselineVendorCount = await countVisibleVendorCards(page);

    for (const payload of INJECTION_PAYLOADS) {
      await search.fill(payload);
      await triggerSearch(page, search);
      await waitForSearchSettle(page, localman);

      await expectPageNotBlank(page);
      await expectVisiblePageUi(
        page,
        `Expected Local Man discovery to remain usable after injecting payload "${payload}" into the search input.`
      );
      await localman.expectMapOrFallback();
      await expect(search).toHaveValue(payload);

      const currentVendorCount = await countVisibleVendorCards(page);
      assertSearchResultsNotBroadened({
        baselineVendorCount,
        currentVendorCount,
        payload
      });
      expectNoDialogs(dialogs, `public search payload ${JSON.stringify(payload)}`);
    }

    await monitor.expectNoCriticalIssues([/ERR_ABORTED/i, SAFE_INJECTION_API_ERROR_PATTERN]);
  });

  test("visible filter text inputs treat injection payloads as inert text when the filter surface is available", async ({ page }) => {
    const localman = new LocalManPage(page);
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });
    const dialogs = installDialogTrap(page);

    await localman.gotoPublicDiscovery();
    await localman.expectPublicDiscoverySurface();
    await localman.expectMapOrFallback();

    const filterButton = await getFilterButton(page);
    await filterButton.click();

    const filterInputs = await getVisibleFilterTextInputs(page);
    if (filterInputs.length === 0) {
      await expectPageNotBlank(page);
      await expectVisiblePageUi(
        page,
        "Expected Local Man to remain usable when opening the filter surface, even if it exposes no additional text inputs."
      );
      expectNoDialogs(dialogs, "opening Local Man filters");
      await monitor.expectNoCriticalIssues([/ERR_ABORTED/i, SAFE_INJECTION_API_ERROR_PATTERN]);
      return;
    }

    const target = filterInputs[0]!;
    for (const payload of INJECTION_PAYLOADS) {
      await target.locator.fill(payload);
      await triggerFilterSubmission(page, target.locator);
      await waitForSearchSettle(page, localman);

      await expectPageNotBlank(page);
      await expectVisiblePageUi(
        page,
        `Expected Local Man filters to remain usable after injecting payload "${payload}" into "${target.description}".`
      );
      await expect(target.locator).toHaveValue(payload);
      expectNoDialogs(dialogs, `filter input ${target.description} payload ${JSON.stringify(payload)}`);
    }

    await monitor.expectNoCriticalIssues([/ERR_ABORTED/i, SAFE_INJECTION_API_ERROR_PATTERN]);
  });

  test("admin create form treats injection payloads as inert text on submit", async ({ page }) => {
    const credentials = getAdminCredentials();
    test.skip(!credentials, "Local Man admin credentials are not configured for injection coverage.");
    if (!credentials) {
      return;
    }

    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });
    const dialogs = installDialogTrap(page);
    const fields = [
      {
        description: "vendor name",
        selector: "input[name='name']"
      },
      {
        description: "short description",
        selector: "textarea[name='short_description']"
      },
      {
        description: "address",
        selector: "input[name='address_text']"
      }
    ] as const;

    await loginToAdmin(page, credentials);

    for (const field of fields) {
      for (const payload of INJECTION_PAYLOADS) {
        await page.goto(ADMIN_CREATE_VENDOR_PATH, { waitUntil: "domcontentloaded" });
        await expectAdminPageUsable(page, "Expected the Local Man admin create form to render visible UI during injection checks.");

        const target = page.locator(field.selector).first();
        await expect(target).toBeVisible();
        await target.fill(payload);
        await page.getByRole("button", { name: /^Create vendor$/i }).click();

        await expectPageNotBlank(page);
        await expectVisiblePageUi(
          page,
          `Expected the Local Man admin create form to remain usable after injecting payload "${payload}" into "${field.description}".`
        );
        await expect(target).toHaveValue(payload);
        await expect(page.getByText(/Vendor created successfully\./i)).toHaveCount(0);
        expectNoDialogs(dialogs, `admin create ${field.description} payload ${JSON.stringify(payload)}`);
      }
    }

    await monitor.expectNoCriticalIssues([/ERR_ABORTED/i]);
  });
});

function getAdminCredentials(): Credentials | null {
  const email = process.env.LOCALMAN_ADMIN_EMAIL?.trim();
  const password = process.env.LOCALMAN_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

async function loginToAdmin(page: Page, credentials: Credentials) {
  await page.goto(ADMIN_LOGIN_PATH, { waitUntil: "domcontentloaded" });
  await expectAdminPageUsable(page, "Expected the Local Man admin login page to render visible UI.");

  await page.getByLabel(/^Email$/i).fill(credentials.email);
  await page.getByLabel(/^Password$/i).fill(credentials.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  await page.waitForURL((url) => !url.pathname.endsWith(ADMIN_LOGIN_PATH), { timeout: 20_000 });
  await expectPageReady(page);
}

async function expectAdminPageUsable(page: Page, message: string) {
  await expectPageReady(page);
  await expectPageNotBlank(page);
  await expectVisiblePageUi(page, message);
}

function installDialogTrap(page: Page) {
  const dialogs: string[] = [];

  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss().catch(() => undefined);
  });

  return dialogs;
}

function expectNoDialogs(dialogs: string[], context: string) {
  const triggered = dialogs.splice(0);
  expect(
    triggered,
    `Expected Local Man to treat ${context} as inert text without executing it or opening dialogs.`
  ).toEqual([]);
}

async function getPrimarySearchInput(page: Page): Promise<Locator> {
  const search = await firstVisible([
    page.getByRole("searchbox", { name: /search/i }),
    page.getByRole("textbox", { name: /search/i }),
    page.getByRole("textbox", { name: /search|location|vendor|business/i })
  ]);

  expect(search, "Expected Local Man to render a visible primary search input.").not.toBeNull();
  return search!;
}

async function getFilterButton(page: Page): Promise<Locator> {
  const button = await firstVisible([
    page.getByRole("button", { name: /filter|open filters|close filters/i })
  ]);

  expect(button, "Expected Local Man to render a visible filter control.").not.toBeNull();
  return button!;
}

async function getVisibleFilterTextInputs(page: Page): Promise<TextInputCandidate[]> {
  const locator = page.locator("input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea");
  const count = await locator.count();
  const inputs: TextInputCandidate[] = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const descriptor = await candidate.evaluate((element) => {
      const control = element as HTMLInputElement | HTMLTextAreaElement;
      const ariaLabel = control.getAttribute("aria-label") ?? "";
      const placeholder = control.getAttribute("placeholder") ?? "";
      const name = control.getAttribute("name") ?? "";
      const label = [ariaLabel, placeholder, name].filter(Boolean).join(" ").trim();

      return {
        label,
        name,
        type: control instanceof HTMLInputElement ? control.type : "textarea"
      };
    });

    const signature = `${descriptor.label} ${descriptor.name} ${descriptor.type}`.trim();
    if (/search|location|vendor|business/i.test(signature)) {
      continue;
    }

    if (!/^(?:text|search|url|tel|email|textarea)$/i.test(descriptor.type)) {
      continue;
    }

    inputs.push({
      description: descriptor.label || descriptor.name || descriptor.type || `input-${index + 1}`,
      locator: candidate
    });
  }

  return inputs;
}

async function triggerSearch(page: Page, search: Locator) {
  const searchButton = await firstVisible([
    page.getByRole("button", { name: /^Search$/i }),
    page.getByRole("button", { name: /search/i })
  ], 1_000);

  if (searchButton && (await searchButton.isEnabled().catch(() => false))) {
    await searchButton.click();
  } else {
    await search.press("Enter").catch(() => undefined);
  }

  await search.blur().catch(() => undefined);
  await waitForPossibleRefresh(page);
}

async function triggerFilterSubmission(page: Page, input: Locator) {
  const applyButton = await firstVisible([
    page.getByRole("button", { name: /^Apply$/i }),
    page.getByRole("button", { name: /apply filters|update results|search/i })
  ], 1_000);

  if (applyButton && (await applyButton.isEnabled().catch(() => false))) {
    await applyButton.click();
  } else {
    await input.press("Enter").catch(() => undefined);
    await input.blur().catch(() => undefined);
  }

  await waitForPossibleRefresh(page);
}

async function waitForPossibleRefresh(page: Page) {
  const apiResponse = page.waitForResponse(
    (response) => /\/api\/(?:vendors\/nearby|location\/reverse)/i.test(response.url()),
    { timeout: 1_500 }
  ).catch(() => null);
  const idle = page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => undefined);

  await Promise.allSettled([apiResponse, idle]);
}

async function waitForSearchSettle(page: Page, localman: LocalManPage) {
  await waitForPossibleRefresh(page);
  await localman.expectPublicDiscoverySurface();
}

function assertSearchResultsNotBroadened(input: {
  baselineVendorCount: number;
  currentVendorCount: number;
  payload: string;
}) {
  const { baselineVendorCount, currentVendorCount, payload } = input;

  expect(
    currentVendorCount,
    `Expected Local Man search payload "${payload}" not to increase visible result count beyond the baseline ${baselineVendorCount}.`
  ).toBeLessThanOrEqual(baselineVendorCount);
}

async function countVisibleVendorCards(page: Page): Promise<number> {
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
      .filter({ has: page.locator("h1, h2, h3, [role='heading']") }),
    page
      .locator("main article, main [role='article'], [role='main'] article, [role='main'] [role='article']")
      .filter({ has: page.locator("h1, h2, h3, [role='heading']") }),
    page
      .locator("main li, main [role='listitem'], [role='main'] li, [role='main'] [role='listitem']")
      .filter({ has: page.locator("h1, h2, h3, [role='heading']") })
  ];

  for (const locator of candidates) {
    let visibleCount = 0;
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) {
        visibleCount += 1;
      }
    }

    if (visibleCount > 0) {
      return visibleCount;
    }
  }

  return 0;
}

async function firstVisible(locators: Locator[], timeoutMs = 5_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}
