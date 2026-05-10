import { Buffer } from "node:buffer";
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import {
  createCriticalPageMonitor,
  expectPageNotBlank,
  expectPageReady,
  expectVisiblePageUi
} from "../../../utils/assertions";
import {
  cleanupQaVendors,
  createQaCleanupReport,
  logQaCleanupReport,
  mergeQaCleanupReport
} from "../../../utils/cleanup";
import { expect as localExpect, test } from "../fixtures";

const ADMIN_LOGIN_PATH = "/admin/login";
const ADMIN_CREATE_VENDOR_PATH = "/admin/vendors/new";
const ADMIN_QA_CLEANUP_PATH = "/api/admin/vendors/cleanup-qa-admin";
const ADMIN_SESSION_STORAGE_KEY = "local-man-admin-session";
const ADMIN_VENDOR_REGISTRY_PATH = "/admin/vendors";
const DEFAULT_VENDOR_LATITUDE = "32.7767";
const DEFAULT_VENDOR_LONGITUDE = "-96.797";
const VENDOR_IMAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2xY9kAAAAASUVORK5CYII=",
  "base64"
);
const CREATE_INTENT_ERRORS = [
  "Confirm that opening hours will be added later.",
  "Confirm that featured dishes will be added later.",
  "Confirm that vendor images will be added later."
] as const;

type VendorRecord = {
  area: string;
  deleted: boolean;
  id: string | null;
  initialDescription: string;
  isTest: true;
  name: string;
  slug: string;
  updatedArea: string;
  updatedDescription: string;
};

test.describe.serial("Local Man admin vendor management", () => {
  const credentials = getAdminCredentials();
  const vendor = buildVendorRecord();

  test.afterAll(async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const context = await browser.newContext(typeof baseURL === "string" ? { baseURL } : {});
    const page = await context.newPage();
    let cleanupReport = createQaCleanupReport();
    let cleanupError: unknown;

    try {
      await loginToAdmin(page, credentials);
      const cleanupResult = await cleanupQaVendors(page, {
        cleanupPath: ADMIN_QA_CLEANUP_PATH,
        entities: [vendor],
        storageKey: ADMIN_SESSION_STORAGE_KEY
      });
      cleanupReport = mergeQaCleanupReport(cleanupReport, cleanupResult);

      if (vendor.id && !vendor.deleted) {
        localExpect(
          cleanupResult.actualDeletedCount,
          `Expected QA admin cleanup to remove the created vendor "${vendor.name}" after the admin test run.`
        ).toBeGreaterThan(0);
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      logQaCleanupReport(cleanupReport, {
        scope: "localman-admin-vendors"
      });
      await context.close();
      if (cleanupError) {
        throw cleanupError;
      }
    }
  });

  test("admin can validate and manage the vendor lifecycle through the public app", async ({ page }) => {
    test.slow();

    await test.step("sign in and reach the vendor workspace", async () => {
      await loginToAdmin(page, credentials);
      await page.goto(ADMIN_VENDOR_REGISTRY_PATH, { waitUntil: "domcontentloaded" });
      await expectAdminPageUsable(page, "Expected the Local Man admin vendor workspace to render visible UI.");
      await localExpect(page.getByRole("button", { name: /log out/i }).first()).toBeVisible();
      await localExpect(page.getByRole("heading", { name: /manage vendors/i }).first()).toBeVisible();
    });

    await page.goto(ADMIN_CREATE_VENDOR_PATH, { waitUntil: "domcontentloaded" });
    await expectAdminPageUsable(page, "Expected the Local Man create vendor page to render visible UI.");
    const monitor = createAdminMonitor(page);

    await test.step("validation blocks incomplete vendor creation", async () => {
      await fillCreateVendorIdentity(page, vendor);
      await page.getByRole("button", { name: /^Create vendor$/i }).click();

      for (const message of CREATE_INTENT_ERRORS) {
        await localExpect(page.getByText(message, { exact: false })).toBeVisible();
      }

      await localExpect(page.getByText(/Vendor created successfully\./i)).toHaveCount(0);
    });

    await test.step("create vendor and verify public visibility", async () => {
      await page.getByLabel(/I do not have this vendor's opening hours yet\./i).check();
      await page.getByLabel(/I do not have featured dishes yet\./i).check();
      await page.getByLabel(/I do not have vendor images yet\./i).check();
      await page.getByRole("button", { name: /^Create vendor$/i }).click();

      await localExpect(page.getByText(/Vendor created successfully\./i)).toBeVisible({ timeout: 15_000 });
      vendor.id = await captureVendorIdFromRegistry(page, vendor.name);

      await assertPublicVendorDetail(page, vendor, {
        expectedArea: vendor.area,
        expectedDescription: vendor.initialDescription
      });
    });

    await test.step("edit vendor and verify public updates", async () => {
      localExpect(vendor.id, "Expected a created vendor id before running the edit flow.").not.toBeNull();

      await page.goto(`${ADMIN_VENDOR_REGISTRY_PATH}/${vendor.id}`, { waitUntil: "domcontentloaded" });
      await expectAdminPageUsable(page, "Expected the Local Man edit vendor page to render visible UI.");
      const updateForm = page.locator("form").filter({
        has: page.getByRole("button", { name: /^Update vendor$/i })
      }).first();
      await updateForm.locator("input[name='area']").fill(vendor.updatedArea);
      await updateForm.locator("textarea[name='short_description']").fill(vendor.updatedDescription);
      await updateForm.getByRole("button", { name: /^Update vendor$/i }).click();

      await waitForAdminStatus(page, [/Vendor updated successfully\./i, /Vendor list refreshed\./i]);
      await assertPublicVendorDetail(page, vendor, {
        expectedArea: vendor.updatedArea,
        expectedDescription: vendor.updatedDescription
      });
    });

    await test.step("upload vendor image and verify it loads publicly", async () => {
      localExpect(vendor.id, "Expected a created vendor id before running the image upload flow.").not.toBeNull();

      await page.goto(`${ADMIN_VENDOR_REGISTRY_PATH}/${vendor.id}`, { waitUntil: "domcontentloaded" });
      await expectAdminPageUsable(page, "Expected the Local Man edit vendor page to render before uploading an image.");
      const imageForm = page.locator("form").filter({
        has: page.getByRole("button", { name: /upload vendor image/i })
      }).first();
      await imageForm.getByLabel(/Image file/i).setInputFiles({
        buffer: VENDOR_IMAGE_PNG,
        mimeType: "image/png",
        name: `${vendor.slug}.png`
      });
      await imageForm.getByRole("button", { name: /upload vendor image/i }).click();

      await localExpect(page.getByText(/Image uploaded successfully\./i)).toBeVisible({ timeout: 15_000 });
      await assertPublicVendorImage(page, vendor);
    });

    await test.step("deactivate vendor and verify public removal", async () => {
      await page.goto(`${ADMIN_VENDOR_REGISTRY_PATH}/${vendor.id}`, { waitUntil: "domcontentloaded" });
      await expectAdminPageUsable(page, "Expected the Local Man edit vendor page to render before deactivating the vendor.");
      const updateForm = page.locator("form").filter({
        has: page.getByRole("button", { name: /^Update vendor$/i })
      }).first();
      const deactivateButton = updateForm.getByRole("button", { name: /deactivate/i });
      await localExpect(
        deactivateButton,
        "Expected the configured Local Man admin account to expose the Deactivate action."
      ).toBeVisible();

      const deactivationResponsePromise = waitForVendorDeactivationResponse(page, vendor.id!);
      const uiChangePromise = waitForDeactivationUiChange(page, vendor);
      await deactivateButton.click();
      await confirmVendorDeactivationIfNeeded(page);

      await Promise.race([deactivationResponsePromise, uiChangePromise]);
      await waitForAdminStatus(page, [/Vendor deactivated successfully\./i, /Vendor list refreshed\./i], 5_000).catch(
        () => undefined
      );
      await assertVendorMissingFromAdminRegistry(page, vendor);
      vendor.deleted = true;
      await assertPublicVendorMissing(page, vendor);
    });

    await monitor.expectNoCriticalIssues();
  });
});

function buildVendorRecord(): VendorRecord {
  const suffix = Date.now().toString(36);

  return {
    area: `QA_TEST_Area ${suffix}`,
    deleted: false,
    id: null,
    initialDescription: `QA_TEST vendor description ${suffix}`,
    isTest: true,
    name: `QA Admin Vendor ${suffix}`,
    slug: `qa-admin-vendor-${suffix}`,
    updatedArea: `QA_TEST_Updated Area ${suffix}`,
    updatedDescription: `QA_TEST updated vendor description ${suffix}`
  };
}

function getAdminCredentials() {
  const email = process.env.LOCALMAN_ADMIN_EMAIL?.trim();
  const password = process.env.LOCALMAN_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error("LOCALMAN_ADMIN_EMAIL and LOCALMAN_ADMIN_PASSWORD must be configured for Local Man admin tests.");
  }

  return { email, password };
}

async function loginToAdmin(
  page: Page,
  credentials: {
    email: string;
    password: string;
  }
) {
  await page.goto(ADMIN_LOGIN_PATH, { waitUntil: "domcontentloaded" });
  await expectAdminPageUsable(page, "Expected the Local Man admin login page to render visible UI.");

  await page.getByLabel(/^Email$/i).fill(credentials.email);
  await page.getByLabel(/^Password$/i).fill(credentials.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  try {
    await page.waitForURL((url) => !url.pathname.endsWith(ADMIN_LOGIN_PATH), { timeout: 20_000 });
  } catch (error) {
    const bodyText = normalizeText(await page.locator("body").textContent());
    throw new Error(
      `Admin login did not complete. Last visible page content: ${bodyText || "blank page"}.${
        error instanceof Error ? ` ${error.message}` : ""
      }`
    );
  }

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
  await page.locator("textarea[name='short_description']").fill(vendor.initialDescription);
  await page.locator("input[name='address_text']").fill(`QA Test Address ${vendor.slug}`);
}

async function selectFirstCategory(select: Locator) {
  await localExpect(select).toBeVisible();

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
  await page.goto(ADMIN_VENDOR_REGISTRY_PATH, { waitUntil: "domcontentloaded" });
  await expectAdminPageUsable(page, "Expected the Local Man vendor registry page to render visible UI.");
  await page.getByLabel(/^Search$/i).fill(vendorName);
  await page.getByRole("button", { name: /^Apply$/i }).click();

  const vendorButton = page.getByRole("button", {
    name: new RegExp(escapeRegExp(vendorName), "i")
  });
  await localExpect(
    vendorButton.first(),
    `Expected the newly created vendor "${vendorName}" to appear in the Local Man admin registry.`
  ).toBeVisible({ timeout: 15_000 });
  await vendorButton.first().click();

  const editLink = page.getByRole("link", { name: /open edit workspace/i });
  await localExpect(editLink).toBeVisible();

  const href = await editLink.getAttribute("href");
  localExpect(href, "Expected the vendor registry preview to expose an edit workspace link.").toBeTruthy();

  const vendorId = href?.split("/").filter(Boolean).at(-1) ?? null;
  localExpect(vendorId, "Expected to extract a vendor id from the edit workspace link.").toBeTruthy();
  return vendorId!;
}

async function assertPublicVendorDetail(
  page: Page,
  vendor: VendorRecord,
  expectations: {
    expectedArea: string;
    expectedDescription: string;
  }
) {
  const bodyText = await waitForPublicVendorHeading(page, vendor);
  localExpect(
    bodyText.includes(vendor.name),
    `Expected the public vendor page to render the created vendor name "${vendor.name}".`
  ).toBeTruthy();
  localExpect(
    bodyText.includes(expectations.expectedDescription),
    `Expected the public vendor page for "${vendor.name}" to render the updated description.`
  ).toBeTruthy();
  localExpect(
    bodyText.includes(expectations.expectedArea),
    `Expected the public vendor page for "${vendor.name}" to render the updated area.`
  ).toBeTruthy();
}

async function assertPublicVendorImage(page: Page, vendor: VendorRecord) {
  const image = page.getByRole("img", {
    name: new RegExp(`${escapeRegExp(vendor.name)} food or storefront`, "i")
  });
  const detailPath = `/vendors/${vendor.slug}`;
  let lastState = "no image rendered";
  const deadline = Date.now() + 20_000;

  while (Date.now() <= deadline) {
    await page.goto(detailPath, { waitUntil: "domcontentloaded" });
    await expectPublicPageUsable(page, "Expected the Local Man public vendor page to render after image upload.");

    const fallbackVisible = await page.getByText(/No image available/i).isVisible().catch(() => false);
    if (fallbackVisible) {
      lastState = "public page still renders the no-image fallback";
      await page.waitForTimeout(500);
      continue;
    }

    if (await image.isVisible().catch(() => false)) {
      const loaded = await image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return {
          loaded: img.complete && img.naturalWidth > 0,
          source: img.currentSrc || img.getAttribute("src") || ""
        };
      });

      if (loaded.loaded && loaded.source.trim().length > 0) {
        return;
      }

      lastState = loaded.source.trim().length > 0 ? "image source exists but did not load" : "image source was empty";
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Expected uploaded vendor image for "${vendor.name}" to load on the public app. Last observed state: ${lastState}.`);
}

async function assertPublicVendorMissing(page: Page, vendor: VendorRecord) {
  const detailPath = `/vendors/${vendor.slug}`;
  let lastStatus: number | null = null;
  let lastBodyText = "";
  const deadline = Date.now() + 20_000;

  while (Date.now() <= deadline) {
    const response = await page.goto(detailPath, { waitUntil: "domcontentloaded" });
    await expectPageReady(page);
    lastStatus = response?.status() ?? null;
    lastBodyText = normalizeText(await page.locator("body").textContent());

    if (!lastBodyText.includes(vendor.name) && (lastStatus === 404 || /not found|404|vendor detail unavailable/i.test(lastBodyText))) {
      await assertVendorMissingFromPublicDiscovery(page, vendor);
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `Expected the deactivated vendor "${vendor.name}" to disappear from the public app. Last status: ${String(lastStatus)}. Last body text: ${lastBodyText}`
  );
}

async function assertVendorMissingFromAdminRegistry(page: Page, vendor: VendorRecord) {
  const deadline = Date.now() + 20_000;
  let lastBodyText = "";

  while (Date.now() <= deadline) {
    await page.goto(ADMIN_VENDOR_REGISTRY_PATH, { waitUntil: "domcontentloaded" });
    await expectAdminPageUsable(page, "Expected the Local Man vendor registry to remain usable after deactivation.");

    const search = page.getByLabel(/^Search$/i);
    if (await search.isVisible().catch(() => false)) {
      await search.fill(vendor.name);
      await page.getByRole("button", { name: /^Apply$/i }).click();
    }

    const vendorSignals = await countVisibleLocators(adminVendorRegistrySignals(page, vendor));
    if (vendorSignals === 0) {
      return;
    }

    lastBodyText = normalizeText(await page.locator("body").textContent());
    await page.waitForTimeout(500);
  }

  throw new Error(
    `Expected deactivated vendor "${vendor.name}" to disappear from the Local Man admin registry. Last body text: ${lastBodyText}`
  );
}

async function assertVendorMissingFromPublicDiscovery(page: Page, vendor: VendorRecord) {
  const discoveryPath = `/?q=${encodeURIComponent(vendor.name)}`;
  let lastBodyText = "";
  const deadline = Date.now() + 20_000;

  while (Date.now() <= deadline) {
    await page.goto(discoveryPath, { waitUntil: "domcontentloaded" });
    await expectPublicPageUsable(page, "Expected the Local Man public discovery page to remain usable after vendor deactivation.");

    const vendorSignals = await countVisibleLocators(publicDiscoveryVendorSignals(page, vendor));
    if (vendorSignals === 0) {
      return;
    }

    lastBodyText = normalizeText(await page.locator("body").textContent());
    await page.waitForTimeout(500);
  }

  throw new Error(
    `Expected deactivated vendor "${vendor.name}" to disappear from the Local Man public discovery results. Last body text: ${lastBodyText}`
  );
}

async function waitForPublicVendorHeading(page: Page, vendor: VendorRecord): Promise<string> {
  const detailPath = `/vendors/${vendor.slug}`;
  let lastBodyText = "";
  const deadline = Date.now() + 20_000;

  while (Date.now() <= deadline) {
    const response = await page.goto(detailPath, { waitUntil: "domcontentloaded" });
    await expectPublicPageUsable(page, "Expected the Local Man public vendor page to render visible UI.");
    const bodyText = normalizeText(await page.locator("body").textContent());

    if (response && response.status() >= 400) {
      lastBodyText = bodyText;
      await page.waitForTimeout(500);
      continue;
    }

    if (bodyText.includes(vendor.name)) {
      return bodyText;
    }

    lastBodyText = bodyText;
    await page.waitForTimeout(500);
  }

  throw new Error(
    `Expected the created vendor "${vendor.name}" to become visible on the Local Man public app. Last body text: ${lastBodyText}`
  );
}

async function confirmVendorDeactivationIfNeeded(page: Page) {
  const dialog = page
    .locator("[role='dialog'], [role='alertdialog']")
    .filter({
      has: page.getByRole("button", { name: /deactivate|confirm|continue|yes/i })
    })
    .first();

  const deadline = Date.now() + 2_000;
  while (Date.now() <= deadline) {
    if (await dialog.isVisible().catch(() => false)) {
      const confirmButton = dialog.getByRole("button", { name: /deactivate|confirm|continue|yes/i }).first();
      await localExpect(confirmButton, "Expected the Local Man deactivation modal to expose a confirm action.").toBeVisible();
      await confirmButton.click();
      return;
    }

    await page.waitForTimeout(100);
  }
}

async function waitForVendorDeactivationResponse(page: Page, vendorId: string): Promise<void> {
  const response = await page.waitForResponse(
    (candidate) => isVendorDeactivationResponse(candidate, vendorId),
    { timeout: 20_000 }
  );

  localExpect(
    response.ok(),
    `Expected Local Man vendor deactivation request for "${vendorId}" to succeed, but received ${response.status()} ${response.statusText()}.`
  ).toBeTruthy();
}

async function waitForDeactivationUiChange(page: Page, vendor: VendorRecord): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastBodyText = "";

  while (Date.now() <= deadline) {
    const pathname = safePathname(page.url());
    const bodyText = normalizeText(await page.locator("body").textContent());
    const deactivateVisible = await page.getByRole("button", { name: /deactivate/i }).first().isVisible().catch(() => false);
    const modalVisible = await page.locator("[role='dialog'], [role='alertdialog']").first().isVisible().catch(() => false);

    if (
      pathname === ADMIN_VENDOR_REGISTRY_PATH ||
      /Vendor deactivated successfully\.|Vendor list refreshed\./i.test(bodyText) ||
      (!deactivateVisible && !modalVisible && !bodyText.includes(vendor.name))
    ) {
      return;
    }

    lastBodyText = bodyText;
    await page.waitForTimeout(250);
  }

  throw new Error(
    `Expected Local Man admin deactivation to change the UI for "${vendor.name}". Last body text: ${lastBodyText}`
  );
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

function adminVendorRegistrySignals(page: Page, vendor: VendorRecord): Locator[] {
  const vendorPattern = new RegExp(escapeRegExp(vendor.name), "i");
  return [
    page.getByRole("button", { name: vendorPattern }),
    page.getByRole("link", { name: vendorPattern }),
    page.locator("[data-vendor-id], article, li, tr, [role='row']").filter({ hasText: vendorPattern })
  ];
}

function publicDiscoveryVendorSignals(page: Page, vendor: VendorRecord): Locator[] {
  const vendorPattern = new RegExp(escapeRegExp(vendor.name), "i");
  return [
    page.locator(`a[href='/vendors/${vendor.slug}']`),
    page.getByRole("link", { name: vendorPattern }),
    page.getByRole("button", { name: vendorPattern }),
    page
      .locator("main article, main li, [role='main'] article, [role='main'] li, [role='main'] [role='article'], [role='main'] [role='listitem']")
      .filter({ hasText: vendorPattern })
  ];
}

async function waitForAdminStatus(page: Page, patterns: RegExp[], timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastBodyText = "";

  while (Date.now() <= deadline) {
    lastBodyText = normalizeText(await page.locator("body").textContent());
    if (patterns.some((pattern) => pattern.test(lastBodyText))) {
      return lastBodyText;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    `Expected Local Man admin status to match one of ${patterns.map((pattern) => pattern.toString()).join(", ")}. Last body text: ${lastBodyText}`
  );
}

function createAdminMonitor(page: Page) {
  return createCriticalPageMonitor(page, {
    ignorePatterns: [/ERR_ABORTED/i]
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isVendorDeactivationResponse(response: Response, vendorId: string): boolean {
  const request = response.request();
  if (!["DELETE", "PATCH", "POST"].includes(request.method())) {
    return false;
  }

  return response.url().includes(`/api/admin/vendors/${vendorId}`);
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

async function countVisibleLocators(locators: Locator[]): Promise<number> {
  let visibleCount = 0;

  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) {
        visibleCount += 1;
      }
    }
  }

  return visibleCount;
}
