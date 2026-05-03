import { expect, test as base } from "@playwright/test";
import { createLocalManResultCollector } from "../../utils/localman-results";

type LocalManFixtures = {
  localmanResults: ReturnType<typeof createLocalManResultCollector>;
};

export const test = base.extend<LocalManFixtures>({
  localmanResults: [
    async ({}, use, testInfo) => {
      const collector = createLocalManResultCollector(testInfo);
      await use(collector);
      await collector.finalize();
    },
    { auto: true }
  ],

  page: async ({ page, localmanResults }, use) => {
    localmanResults.trackPage(page);
    await use(page);
  }
});

export { expect };
