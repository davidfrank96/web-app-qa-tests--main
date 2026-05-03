import { test as base, type Page } from "@playwright/test";
import { AuthPage } from "../../pages/inssa/auth-page";
import { ensureInssaAuthStorageState } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";

type InssaFixtures = {
  authPage: AuthPage;
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

  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  }
});

export { expect } from "@playwright/test";
export type { Page };
