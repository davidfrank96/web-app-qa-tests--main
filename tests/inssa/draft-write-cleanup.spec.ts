import { expect, test } from "./mutation-fixtures";
import { TimeCapsulePage, type InssaComposeDraftStorageRecord } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { discardDraftByIdFromDraftsList, discardQaDraftsFromDraftsList } from "../../utils/inssa-cleanup";
import { assertValidInssaUrl } from "../../utils/env";
import {
  assertInssaMutationFlagEnabled,
  buildInssaQaCapsuleSeed,
  INSSA_MUTATION_ENV_FLAG
} from "../../utils/inssa-mutation";
import { getInssaComposeTemplateDefaults, INSSA_DEFAULT_COMPOSE_ROUTE } from "../../utils/inssa-test-data";
import { withInssaStabilityMonitor } from "../../utils/monitor";

const MUTATION_OPT_IN_ENABLED = process.env[INSSA_MUTATION_ENV_FLAG] === "1";

type DraftStorageSnapshot = {
  currentPath: string;
  initialDraft: InssaComposeDraftStorageRecord;
  refresh: InssaComposeDraftStorageRecord;
};

test.describe("INSSA draft write cleanup", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!MUTATION_OPT_IN_ENABLED, `Requires ${INSSA_MUTATION_ENV_FLAG}=1 for opt-in draft-write auditing.`);
  test.setTimeout(180_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
    assertInssaMutationFlagEnabled();
  });

  test("qa-tagged draft can be entered, observed, and discarded through Buried drafts without publishing", async (
    { mutationCleanupTracker, mutationRunContext, page },
    testInfo
  ) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);
    const compose = new TimeCapsulePage(page);
    const seed = buildInssaQaCapsuleSeed(mutationRunContext, {
      bodySuffix: "draft-write",
      subjectSuffix: "draft-write"
    });
    const templateDefaults = getInssaComposeTemplateDefaults();
    const composePathname = new URL(INSSA_DEFAULT_COMPOSE_ROUTE, "https://staging.inssa.us").pathname;

    const preCleanup = await discardQaDraftsFromDraftsList(page, {
      maxIterations: 1,
      subject: seed.subject
    });

    let qaStorage: DraftStorageSnapshot | null = null;
    let authoredDraftId = "";
    let cleanupViaDraftId = false;
    let cleanupViaSubject = false;

    mutationCleanupTracker.markDraftOpened(seed.subject, {
      note: `run=${mutationRunContext.runId}`
    });

    try {
      await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
        await monitor.step("open authenticated compose route directly", () => compose.goToComposeRoute(), {
          phase: "navigation",
          route: "/timecapsule"
        });
        await monitor.step("assert compose surface and metadata", async () => {
          await compose.expectComposeSurface();
          await compose.expectRequiredFieldMetadata();
        }, { phase: "assertion" });

        qaStorage = await monitor.step("type qa-tagged draft data and observe draft storage evidence", async () => {
          await compose.fillComposeFields(seed);
          await compose.expectComposeValues(seed);
          return waitForQaDraftStorage(compose, {
            pathname: composePathname,
            qaMarker: mutationRunContext.marker,
            qaMessage: seed.message,
            qaSubject: seed.subject,
            templateMessage: templateDefaults.message,
            templateSubject: templateDefaults.subject
          });
        }, { phase: "interaction" });

        authoredDraftId = qaStorage.refresh.draftId;
        expect(authoredDraftId, "Expected draft typing to produce a persisted draft id in compose storage.").toBeTruthy();

        await monitor.step("save and exit the qa draft without publishing", () => compose.saveAndExit(), {
          phase: "interaction"
        });

        cleanupViaDraftId = await monitor.step("discard the saved qa draft from Buried drafts by exact draft id", () =>
          discardDraftByIdFromDraftsList(page, {
            composePathname,
            draftId: authoredDraftId,
            qaMarker: mutationRunContext.marker,
            qaMessage: seed.message,
            qaSubject: seed.subject,
            templateMessage: templateDefaults.message,
            templateSubject: templateDefaults.subject
          }), {
          phase: "interaction",
          route: "/messages?tab=1&drafts=1"
        });

        if (!cleanupViaDraftId) {
          const fallbackCleanup = await monitor.step("fallback cleanup by exact qa subject", () =>
            discardQaDraftsFromDraftsList(page, {
              maxIterations: 1,
              subject: seed.subject
            }), {
            phase: "interaction",
            route: "/messages?tab=1&drafts=1"
          });
          cleanupViaSubject = fallbackCleanup.deletedSubjects.includes(seed.subject);
        }

        expect(
          cleanupViaDraftId || cleanupViaSubject,
          `Expected to discard the QA draft "${seed.subject}" through the official Buried drafts cleanup path.`
        ).toBe(true);

        mutationCleanupTracker.markDraftDiscarded(seed.subject, {
          note: cleanupViaDraftId
            ? `Discarded through Buried drafts by exact draft id ${authoredDraftId}.`
            : "Discarded through Buried drafts by exact QA subject fallback."
        });

        await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
          phase: "assertion"
        });
      });
    } finally {
      if (!cleanupViaDraftId && !cleanupViaSubject) {
        const fallbackCleanup = await discardQaDraftsFromDraftsList(page, {
          maxIterations: 1,
          subject: seed.subject
        });

        cleanupViaSubject = fallbackCleanup.deletedSubjects.includes(seed.subject);

        if (cleanupViaSubject) {
          mutationCleanupTracker.markDraftDiscarded(seed.subject, {
            note: "Best-effort fallback cleanup removed the QA draft by exact subject."
          });
        } else {
          mutationCleanupTracker.markCleanupSkipped(seed.subject, {
            kind: "draft",
            note: `Cleanup risk: could not confirm deletion of QA draft id "${authoredDraftId || "unknown"}".`
          });
        }
      }
    }

    await testInfo.attach("inssa-draft-write-cleanup.json", {
      body: JSON.stringify(
        {
          authoredDraftId,
          cleanupMode: cleanupViaDraftId ? "draft-id" : cleanupViaSubject ? "subject-fallback" : "not-cleaned",
          composePathname,
          preCleanup,
          qaStorage,
          seed
        },
        null,
        2
      ),
      contentType: "application/json"
    });
  });
});

async function waitForQaDraftStorage(
  compose: TimeCapsulePage,
  input: {
    pathname: string;
    qaMarker: string;
    qaMessage: string;
    qaSubject: string;
    templateMessage: string;
    templateSubject: string;
  }
): Promise<DraftStorageSnapshot> {
  let latestSnapshot = await compose.readClientDraftStorage({
    pathname: input.pathname,
    qaMarker: input.qaMarker,
    qaMessage: input.qaMessage,
    qaSubject: input.qaSubject,
    templateMessage: input.templateMessage,
    templateSubject: input.templateSubject
  });

  await expect
    .poll(
      async () => {
        latestSnapshot = await compose.readClientDraftStorage({
          pathname: input.pathname,
          qaMarker: input.qaMarker,
          qaMessage: input.qaMessage,
          qaSubject: input.qaSubject,
          templateMessage: input.templateMessage,
          templateSubject: input.templateSubject
        });

        return {
          draftIdPresent: Boolean(latestSnapshot.refresh.draftId),
          exists: latestSnapshot.refresh.exists,
          messageKind: latestSnapshot.refresh.messageKind,
          subjectKind: latestSnapshot.refresh.subjectKind
        };
      },
      {
        message: "Expected typed QA draft content to appear in compose draft storage.",
        timeout: 15_000
      }
    )
    .toEqual({
      draftIdPresent: true,
      exists: true,
      messageKind: "qa",
      subjectKind: "qa"
    });

  return latestSnapshot;
}
