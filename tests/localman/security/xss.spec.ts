import { expect, type Locator, type Page } from "@playwright/test";
import {
  createCriticalPageMonitor,
  expectPageNotBlank,
  expectPageReady,
  expectVisiblePageUi
} from "../../../utils/assertions";
import {
  cleanupQaPayloads,
  createQaCleanupReport,
  logQaCleanupReport,
  mergeQaCleanupReport
} from "../../../utils/cleanup";
import { test } from "../fixtures";

const ADMIN_CREATE_VENDOR_PATH = "/admin/vendors/new";
const ADMIN_LOGIN_PATH = "/admin/login";
const ADMIN_QA_CLEANUP_PATH = "/api/admin/vendors/cleanup-qa-admin";
const ADMIN_SESSION_STORAGE_KEY = "local-man-admin-session";
const DEFAULT_VENDOR_LATITUDE = "32.7767";
const DEFAULT_VENDOR_LONGITUDE = "-96.797";
const XSS_PAYLOAD = "<img src=x onerror=alert(1)>";

type Credentials = {
  email: string;
  password: string;
};

type VendorRecord = {
  area: string;
  created: boolean;
  description: string;
  id: string | null;
  isTest: true;
  name: string;
  slug: string;
};

test.describe.serial("Local Man XSS safety", () => {
  const createdVendors: VendorRecord[] = [];

  test.afterAll(async ({ browser }, testInfo) => {
    if (createdVendors.length === 0) {
      return;
    }

    const credentials = getAdminCredentials();
    const baseURL = testInfo.project.use.baseURL;
    const context = await browser.newContext(typeof baseURL === "string" ? { baseURL } : {});
    const page = await context.newPage();
    let cleanupReport = createQaCleanupReport();
    let cleanupError: unknown;

    try {
      await loginToAdmin(page, credentials);
      const cleanupResult = await cleanupQaPayloads(page, {
        cleanupPath: ADMIN_QA_CLEANUP_PATH,
        entities: createdVendors,
        storageKey: ADMIN_SESSION_STORAGE_KEY
      });
      cleanupReport = mergeQaCleanupReport(cleanupReport, cleanupResult);

      if (createdVendors.some((vendor) => vendor.created)) {
        expect(
          cleanupResult.actualDeletedCount,
          "Expected Local Man QA cleanup to remove at least one created XSS payload vendor."
        ).toBeGreaterThan(0);
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      logQaCleanupReport(cleanupReport, {
        scope: "localman-xss-payloads"
      });
      await context.close();
      if (cleanupError) {
        throw cleanupError;
      }
    }
  });

  test("public search field treats the XSS payload as inert text", async ({ page }) => {
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });
    const dialogs = installDialogTrap(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectPublicPageUsable(page, "Expected the Local Man discovery surface to render visible UI.");

    const searchInput = await getPrimarySearchInput(page);
    await searchInput.fill(XSS_PAYLOAD);
    await triggerSearch(page, searchInput);

    await expectPublicPageUsable(page, "Expected the Local Man discovery surface to remain usable after entering an XSS payload.");
    await expect(searchInput).toHaveValue(XSS_PAYLOAD);
    await expect(
      page.locator('img[src="x"]').first(),
      "Expected the Local Man search UI not to interpret the XSS payload as markup."
    ).toHaveCount(0);
    expectNoDialogs(dialogs, "the Local Man public search field");
    await monitor.expectNoCriticalIssues([/ERR_ABORTED/i]);
  });

  test("admin-created vendor payloads render as text on the public view", async ({ page }) => {
    const credentials = getAdminCredentials();
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });
    const dialogs = installDialogTrap(page);
    const vendor = buildVendorRecord();
    createdVendors.push(vendor);

    await loginToAdmin(page, credentials);
    await page.goto(ADMIN_CREATE_VENDOR_PATH, { waitUntil: "domcontentloaded" });
    await expectAdminPageUsable(page, "Expected the Local Man admin create vendor page to render visible UI.");

    await fillCreateVendorIdentity(page, vendor);
    await page.getByLabel(/I do not have this vendor's opening hours yet\./i).check();
    await page.getByLabel(/I do not have featured dishes yet\./i).check();
    await page.getByLabel(/I do not have vendor images yet\./i).check();
    await page.getByRole("button", { name: /^Create vendor$/i }).click();

    await expect(page.getByText(/Vendor created successfully\./i)).toBeVisible({ timeout: 15_000 });
    vendor.created = true;
    vendor.id = await captureVendorIdFromRegistry(page, vendor.name);

    const bodyText = await waitForPublicVendorBody(page, vendor.slug);
    expect(
      bodyText.includes(vendor.name),
      `Expected the public vendor page to render the XSS payload in the vendor name as text.`
    ).toBeTruthy();
    expect(
      bodyText.includes(vendor.description),
      `Expected the public vendor page to render the XSS payload in the vendor description as text.`
    ).toBeTruthy();
    await expect(
      page.locator('img[src="x"]').first(),
      "Expected the Local Man public vendor page not to interpret the XSS payload as markup."
    ).toHaveCount(0);
    expectNoDialogs(dialogs, "the Local Man public vendor detail page");
    await monitor.expectNoCriticalIssues([/ERR_ABORTED/i]);
  });
});

function buildVendorRecord(): VendorRecord {
  const suffix = Date.now().toString(36);

  return {
    area: `QA_TEST_XSS Area ${suffix}`,
    created: false,
    description: `QA_TEST_XSS Description ${suffix} ${XSS_PAYLOAD}`,
    id: null,
    isTest: true,
    name: `QA Admin Vendor ${suffix} ${XSS_PAYLOAD}`,
    slug: `qa-admin-vendor-xss-${suffix}`
  };
}

function getAdminCredentials(): Credentials {
  const email = process.env.LOCALMAN_ADMIN_EMAIL?.trim();
  const password = process.env.LOCALMAN_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error("LOCALMAN_ADMIN_EMAIL and LOCALMAN_ADMIN_PASSWORD must be configured for Local Man XSS tests.");
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

async function fillCreateVendorIdentity(page: Page, vendor: VendorRecord) {
  await page.locator("input[name='name']").fill(vendor.name);
  await page.locator("input[name='slug']").fill(vendor.slug);
  await selectFirstCategory(page.locator("select[name='category_slug']"));
  await page.locator("select[name='price_band']").selectOption("budget");
  await page.locator("input[name='latitude']").fill(DEFAULT_VENDOR_LATITUDE);
  await page.locator("input[name='longitude']").fill(DEFAULT_VENDOR_LONGITUDE);
  await page.locator("input[name='area']").fill(vendor.area);
  await page.locator("textarea[name='short_description']").fill(vendor.description);
  await page.locator("input[name='address_text']").fill(`QA XSS Address ${vendor.slug}`);
}

async function selectFirstCategory(select: Locator) {
  await expect(select).toBeVisible();

  const deadline = Date.now() + 15_000;
  while (Date.now() <= deadline) {
    const values = await select.locator("option").evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value.trim())
        .filter((value) => value.length > 0)
    );

    if (values[0]) {
      await select.selectOption(values[0]);
      return;
    }

    await select.page().waitForTimeout(200);
  }

  throw new Error("Expected the Local Man create vendor form to load at least one vendor category option.");
}

async function captureVendorIdFromRegistry(page: Page, vendorName: string): Promise<string> {
  await page.goto("/admin/vendors", { waitUntil: "domcontentloaded" });
  await expectAdminPageUsable(page, "Expected the Local Man admin vendor registry page to render visible UI.");
  await page.getByLabel(/^Search$/i).fill(vendorName);
  await page.getByRole("button", { name: /^Apply$/i }).click();

  const vendorButton = page.getByRole("button", {
    name: new RegExp(escapeRegExp(vendorName), "i")
  });
  await expect(vendorButton.first()).toBeVisible({ timeout: 15_000 });
  await vendorButton.first().click();

  const editLink = page.getByRole("link", { name: /open edit workspace/i });
  await expect(editLink).toBeVisible();

  const href = await editLink.getAttribute("href");
  expect(href, "Expected the vendor registry preview to expose an edit workspace link.").toBeTruthy();

  const vendorId = href?.split("/").filter(Boolean).at(-1) ?? null;
  expect(vendorId, "Expected to extract a vendor id from the edit workspace link.").toBeTruthy();
  return vendorId!;
}

async function waitForPublicVendorBody(page: Page, slug: string): Promise<string> {
  const detailPath = `/vendors/${slug}`;
  let lastBodyText = "";
  const deadline = Date.now() + 20_000;

  while (Date.now() <= deadline) {
    const response = await page.goto(detailPath, { waitUntil: "domcontentloaded" });
    await expectPublicPageUsable(page, "Expected the Local Man public vendor page to render visible UI.");
    const bodyText = normalizeText(await page.locator("body").textContent());

    if (response && response.status() < 400 && bodyText.length > 0) {
      return bodyText;
    }

    lastBodyText = bodyText;
    await page.waitForTimeout(500);
  }

  throw new Error(`Expected the Local Man public vendor page to become available. Last body text: ${lastBodyText}`);
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

async function waitForPossibleRefresh(page: Page) {
  const apiResponse = page.waitForResponse(
    (response) => /\/api\/(?:vendors\/nearby|location\/reverse)/i.test(response.url()),
    { timeout: 2_000 }
  ).catch(() => null);
  const idle = page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);

  await Promise.allSettled([apiResponse, idle]);
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
    `Expected Local Man to treat the XSS payload in ${context} as inert text without executing it or opening dialogs.`
  ).toEqual([]);
}

async function expectAdminPageUsable(page: Page, message: string) {
  await expectPageReady(page);
  await expectPageNotBlank(page);
  await expectVisiblePageUi(page, message);
}

async function expectPublicPageUsable(page: Page, message: string) {
  await expectPageReady(page);
  await expectPageNotBlank(page);
  await expectVisiblePageUi(page, message);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
