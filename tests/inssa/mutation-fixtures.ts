import { test as base } from "./fixtures";
import { attachInssaCleanupReport, createInssaCleanupTracker } from "../../utils/inssa-cleanup";
import { createInssaMutationRunContext } from "../../utils/inssa-mutation";

type InssaMutationFixtures = {
  mutationCleanupTracker: ReturnType<typeof createInssaCleanupTracker>;
  mutationRunContext: ReturnType<typeof createInssaMutationRunContext>;
};

export const test = base.extend<InssaMutationFixtures>({
  mutationRunContext: async ({}, use, testInfo) => {
    const runContext = createInssaMutationRunContext({
      file: testInfo.file,
      projectName: testInfo.project.name,
      retry: testInfo.retry,
      title: testInfo.title
    });

    await use(runContext);
  },

  mutationCleanupTracker: async ({ mutationRunContext }, use, testInfo) => {
    const tracker = createInssaCleanupTracker(mutationRunContext);

    try {
      await use(tracker);
    } finally {
      await attachInssaCleanupReport(testInfo, tracker.summarize());
    }
  }
});

export { expect } from "./fixtures";
