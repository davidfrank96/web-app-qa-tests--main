import { expect, test as base, type Page } from "@playwright/test";
import { installSafeWriteAudit, type SafeWriteRecord } from "../../utils/inssa-safe-write-audit";
import { AuthPage } from "../../pages/inssa/auth-page";
import { ensureInssaAuthStorageState, hasCompleteInssaSession } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";

type InssaFixtures = {
  authPage: AuthPage;
  productWriteAudit: void;
  productWriteAuditEnabled: boolean;
};

type InssaWorkerFixtures = {
  authStorageStatePath: string;
  safeSession: boolean;
  authSetupWrites: SafeWriteRecord[];
};

export const test = base.extend<InssaFixtures, InssaWorkerFixtures>({
  safeSession: [false, { scope: "worker", option: true }],
  authSetupWrites: [async ({}, use) => { await use([]); }, { scope: "worker" }],
  authStorageStatePath: [
    async ({ browser, safeSession, authSetupWrites }, use) => {
      assertValidInssaUrl();
      const statePath = await ensureInssaAuthStorageState(browser, { safe: safeSession, onAudit: records => authSetupWrites.push(...records) });
      await use(statePath);
    },
    { scope: "worker", timeout: 120_000 }
  ],

  storageState: async ({ authStorageStatePath }, use) => {
    await use(authStorageStatePath);
  },

  productWriteAuditEnabled: [false, { option: true }],
  productWriteAudit: [async ({ context, productWriteAuditEnabled, authSetupWrites }, use, testInfo) => {
    if (!productWriteAuditEnabled) { await use(); return; }
    const state = await context.storageState();
    const origin = state.origins.find(item => item.origin === new URL(assertValidInssaUrl()).origin);
    const profile = JSON.parse(origin?.localStorage.find(item => item.name === "userProfile")?.value ?? "null");
    const uid = profile?.state?.userProfile?.uid;
    if (typeof uid !== "string" || !uid || !hasCompleteInssaSession(origin?.localStorage ?? [])) throw new Error("Safe Suite needs a matching authenticated profile");
    const audit = await installSafeWriteAudit(context, uid);
    try { await use(); }
    finally {
      await audit.dispose();
      await testInfo.attach("safe-suite-product-writes.json", {
        body: JSON.stringify({ authSetupWrites, writes: audit.records, failures: audit.failures,
          summary: {
            allowedReadOnly: audit.records.filter(row => row.outcome === "ALLOWED_READ_ONLY").length,
            benignInitialization: audit.records.filter(row => row.outcome === "ALLOWED_BENIGN_INITIALIZATION").length,
            blockedUnexpectedWrites: audit.records.filter(row => row.outcome === "BLOCKED_UNEXPECTED_WRITE").length,
            // Unknown semantics cannot be reported as proven zero product mutations.
            productMutationStatus: "NOT_INDEPENDENTLY_VERIFIED"
          }, serviceWorkers: context.serviceWorkers().map(worker => worker.url()) }, null, 2), contentType: "application/json"
      });
    }
    expect(audit.failures, "Safe Suite must not create drafts, capsules, media or change profile content").toEqual([]);
  }, { auto: true }],

  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  }
});

export { expect } from "@playwright/test";
export type { Page };
