import { expect, test as base, type Page } from "@playwright/test";
import { firestoreWrites, isExpectedInssaAccountMetadata, type ProductWrite } from "../../utils/inssa-product-writes";
import { AuthPage } from "../../pages/inssa/auth-page";
import { ensureInssaAuthStorageState } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";

type InssaFixtures = {
  authPage: AuthPage;
  productWriteAudit: void;
  productWriteAuditEnabled: boolean;
};

type InssaWorkerFixtures = {
  authStorageStatePath: string;
};

export const test = base.extend<InssaFixtures, InssaWorkerFixtures>({
  authStorageStatePath: [
    async ({ browser }, use) => {
      assertValidInssaUrl();
      const statePath = await ensureInssaAuthStorageState(browser);
      await use(statePath);
    },
    { scope: "worker", timeout: 120_000 }
  ],

  storageState: async ({ authStorageStatePath }, use) => {
    await use(authStorageStatePath);
  },

  productWriteAuditEnabled: [false, { option: true }],
  productWriteAudit: [async ({ page, productWriteAuditEnabled }, use, testInfo) => {
    if (!productWriteAuditEnabled) { await use(); return; }
    const writes: ProductWrite[] = [];
    const failures: string[] = [];
    page.on("request", request => {
      try { writes.push(...firestoreWrites(request.url(), request.postData() ?? "")); }
      catch { failures.push("Unrecognized Firestore write payload"); }
    });
    await use();
    await testInfo.attach("safe-suite-product-writes.json", {
      body: JSON.stringify({ writes, parseFailures: failures, expectedSideEffects: ["users.lastActive", "users.fcmSyncStatus"] }, null, 2),
      contentType: "application/json"
    });
    expect(failures, "Product write audit must understand every observed write").toEqual([]);
    expect(writes.filter(write => !isExpectedInssaAccountMetadata(write)), "Safe Suite must not create drafts, capsules, media or change profile data").toEqual([]);
  }, { auto: true }],

  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  }
});

export { expect } from "@playwright/test";
export type { Page };
