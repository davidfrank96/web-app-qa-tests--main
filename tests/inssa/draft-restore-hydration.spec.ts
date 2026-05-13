import { expect, type Page } from "@playwright/test";
import { DraftsPage } from "../../pages/inssa/drafts.page";
import { LandingPage } from "../../pages/inssa/landing.page";
import { TimeCapsulePage, type InssaComposeDraftStorageRecord } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { discardQaDraftsFromDraftsList } from "../../utils/inssa-cleanup";
import { assertValidInssaUrl } from "../../utils/env";
import {
  assertInssaMutationFlagEnabled,
  buildInssaQaCapsuleSeed,
  getInssaCleanupCapabilities,
  getInssaMutationReadiness,
  INSSA_MUTATION_ENV_FLAG
} from "../../utils/inssa-mutation";
import { getInssaComposeTemplateDefaults, INSSA_DEFAULT_COMPOSE_ROUTE } from "../../utils/inssa-test-data";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { test } from "./mutation-fixtures";

const MUTATION_OPT_IN_ENABLED = process.env[INSSA_MUTATION_ENV_FLAG] === "1";

type FirestoreMutationRecord = {
  channel: "listen" | "write";
  collection?: string;
  containsQaMarker: boolean;
  documentId?: string;
  draftStep?: string;
  isDraft?: boolean;
  kind: "addTarget" | "delete" | "removeTarget" | "update";
  lifecycleStatus?: string;
  status?: string;
  targetId?: number;
};

type TrafficCapture = {
  requests: Array<{
    firestoreMutations: FirestoreMutationRecord[];
    method: string;
    url: string;
  }>;
};

type ComposeValues = { message: string; subject: string };
type DraftStorageSnapshot = {
  currentPath: string;
  initialDraft: InssaComposeDraftStorageRecord;
  refresh: InssaComposeDraftStorageRecord;
};

test.describe("INSSA draft restore hydration", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!MUTATION_OPT_IN_ENABLED, `Requires ${INSSA_MUTATION_ENV_FLAG}=1 for opt-in draft hydration auditing.`);
  test.setTimeout(240_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
    assertInssaMutationFlagEnabled();
  });

  test("save and exit clears compose cache while the same persisted draft id reopens with template values from Buried drafts", async (
    { mutationCleanupTracker, mutationRunContext, page },
    testInfo
  ) => {
    test.slow();

    const landing = new LandingPage(page);
    const drafts = new DraftsPage(page);
    const compose = new TimeCapsulePage(page);
    const errorMonitor = createInssaErrorMonitor(page);
    const seed = buildInssaQaCapsuleSeed(mutationRunContext, {
      bodySuffix: "restore-audit",
      subjectSuffix: "restore-audit"
    });
    const templateDefaults = getInssaComposeTemplateDefaults();
    const composePathname = new URL(INSSA_DEFAULT_COMPOSE_ROUTE, "https://staging.inssa.us").pathname;
    const capabilities = getInssaCleanupCapabilities();
    const readiness = getInssaMutationReadiness(capabilities);

    await compose.installDraftHydrationTelemetry({
      qaMarker: mutationRunContext.marker,
      qaMessage: seed.message,
      qaSubject: seed.subject,
      templateMessage: templateDefaults.message,
      templateSubject: templateDefaults.subject
    });

    const preExistingCleanup = await discardQaDraftsFromDraftsList(page, { maxIterations: 10 });

    let initialValues: ComposeValues | null = null;
    let preExitStorage: DraftStorageSnapshot | null = null;
    let postExitStorage: DraftStorageSnapshot | null = null;
    let draftsListSubjectsAfterSave: string[] = [];
    let draftsListReopenedValues: ComposeValues | null = null;
    let draftsListReopenedStorage: DraftStorageSnapshot | null = null;
    let telemetryEvents: Awaited<ReturnType<TimeCapsulePage["readDraftHydrationTelemetry"]>> = [];
    let typingTraffic: TrafficCapture | null = null;
    let discardTraffic: TrafficCapture | null = null;
    let cleanupDeletedSubjects: string[] = [];
    let cleanupRemainingSubjects: string[] = [];
    let authoredDraftIdForCleanup = "";
    let authoredDraftDeleted = false;

    mutationCleanupTracker.markDraftOpened(seed.subject, {
      note: `run=${mutationRunContext.runId}`
    });

    try {
      await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
        await monitor.step("open authenticated landing", () => landing.goToHome(), {
          phase: "navigation",
          route: "/"
        });
        await monitor.step("assert authenticated landing", () => landing.expectAuthenticatedLandingSurface(), {
          phase: "assertion"
        });
        await monitor.step("open compose route", async () => {
          const response = await page.goto(INSSA_DEFAULT_COMPOSE_ROUTE, { waitUntil: "domcontentloaded" });
          if (response && response.status() >= 400) {
            throw new Error(`INSSA compose route returned HTTP ${response.status()}.`);
          }
        }, { phase: "navigation", route: "/timecapsule" });
        await monitor.step("assert compose surface", () => compose.expectComposeSurface(), {
          phase: "assertion",
          route: "/timecapsule"
        });

        initialValues = await monitor.step("read initial compose defaults", () => compose.readComposeValues(), {
          phase: "assertion"
        });

        typingTraffic = await monitor.step("type qa draft and observe firestore writes", async () => {
          return captureFirestoreDraftTraffic(page, async () => {
            await compose.fillComposeFields(seed);
            await expect.poll(
              async () =>
                compose.readClientDraftStorage({
                  pathname: composePathname,
                  qaMarker: mutationRunContext.marker,
                  qaMessage: seed.message,
                  qaSubject: seed.subject,
                  templateMessage: templateDefaults.message,
                  templateSubject: templateDefaults.subject
                }),
              { timeout: 15_000 }
            ).toMatchObject({
              refresh: {
                draftId: expect.any(String),
                exists: true,
                messageKind: "qa",
                subjectKind: "qa"
              }
            });
          });
        }, { phase: "interaction" });

        await monitor.step("assert compose fields show qa values", () => compose.expectComposeValues(seed), {
          phase: "assertion"
        });

        preExitStorage = await monitor.step(
          "snapshot compose storage before save exit",
          () =>
            compose.readClientDraftStorage({
              pathname: composePathname,
              qaMarker: mutationRunContext.marker,
              qaMessage: seed.message,
              qaSubject: seed.subject,
              templateMessage: templateDefaults.message,
              templateSubject: templateDefaults.subject
            }),
          { phase: "assertion" }
        );
        authoredDraftIdForCleanup = preExitStorage.refresh.draftId;

        await monitor.step("save and exit draft", () => compose.saveAndExit(), {
          phase: "interaction"
        });

        postExitStorage = await monitor.step(
          "snapshot compose storage after save exit",
          () =>
            compose.readClientDraftStorage({
              pathname: composePathname,
              qaMarker: mutationRunContext.marker,
              qaMessage: seed.message,
              qaSubject: seed.subject,
              templateMessage: templateDefaults.message,
              templateSubject: templateDefaults.subject
            }),
          { phase: "assertion" }
        );

        draftsListSubjectsAfterSave = await monitor.step("open Buried drafts and list QA subjects", async () => {
          await drafts.goToDrafts();
          return drafts.listQaDraftSubjects();
        }, { phase: "navigation", route: "/messages?tab=1&drafts=1" });

        await monitor.step("open newest template-titled draft from Buried drafts", async () => {
          await openDraftByIdFromDraftsList(page, drafts, compose, {
            composePathname,
            draftId: authoredDraftIdForCleanup,
            qaMarker: mutationRunContext.marker,
            qaMessage: seed.message,
            qaSubject: seed.subject,
            templateMessage: templateDefaults.message,
            templateSubject: templateDefaults.subject
          });
          await compose.expectComposeSurface();
        }, { phase: "interaction" });

        draftsListReopenedValues = await monitor.step(
          "read compose values from Buried drafts reopen",
          () => compose.readComposeValues(),
          {
            phase: "assertion"
          }
        );

        draftsListReopenedStorage = await monitor.step(
          "snapshot compose storage from Buried drafts reopen",
          () =>
            compose.readClientDraftStorage({
              pathname: composePathname,
              qaMarker: mutationRunContext.marker,
              qaMessage: seed.message,
              qaSubject: seed.subject,
              templateMessage: templateDefaults.message,
              templateSubject: templateDefaults.subject
            }),
          { phase: "assertion" }
        );

        discardTraffic = await monitor.step("discard saved QA draft from Buried drafts reopen", async () => {
          return captureFirestoreDraftTraffic(page, async () => {
            await compose.discardDraft();
            await page.waitForLoadState("domcontentloaded").catch(() => {});
          });
        }, { phase: "interaction" });
        authoredDraftDeleted = true;

        await monitor.step("verify qa draft is gone from Buried drafts", async () => {
          await drafts.goToDrafts();
          await drafts.expectDraftAbsent(seed.subject);
          mutationCleanupTracker.markDraftDiscarded(seed.subject, {
            note: "QA-tagged draft was reopened from Buried drafts and discarded through the official compose UI."
          });
        }, { phase: "assertion" });

        telemetryEvents = await monitor.step("read draft hydration telemetry", () => compose.readDraftHydrationTelemetry(), {
          phase: "assertion"
        });

        await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
          phase: "assertion"
        });
      });
    } finally {
      if (!authoredDraftDeleted && authoredDraftIdForCleanup) {
        authoredDraftDeleted = await bestEffortDiscardDraftByIdFromDraftsList(page, drafts, compose, {
          composePathname,
          draftId: authoredDraftIdForCleanup,
          qaMarker: mutationRunContext.marker,
          qaMessage: seed.message,
          qaSubject: seed.subject,
          templateMessage: templateDefaults.message,
          templateSubject: templateDefaults.subject
        });

        if (authoredDraftDeleted) {
          mutationCleanupTracker.markDraftDiscarded(seed.subject, {
            note: "Best-effort cleanup matched the authored draft id from Buried drafts and discarded it."
          });
        }
      }

      const cleanupResult = await discardQaDraftsFromDraftsList(page, { maxIterations: 10 });
      cleanupDeletedSubjects = cleanupResult.deletedSubjects;
      cleanupRemainingSubjects = cleanupResult.remainingSubjects;
    }

    if (!initialValues || !preExitStorage || !postExitStorage || !draftsListReopenedValues || !draftsListReopenedStorage) {
      throw new Error("INSSA draft restore audit did not collect the required hydration snapshots.");
    }

    const initialValuesSnapshot = initialValues as ComposeValues;
    const preExitStorageSnapshot = preExitStorage as DraftStorageSnapshot;
    const postExitStorageSnapshot = postExitStorage as DraftStorageSnapshot;
    const draftsListReopenedValuesSnapshot = draftsListReopenedValues as ComposeValues;
    const draftsListReopenedStorageSnapshot = draftsListReopenedStorage as DraftStorageSnapshot;
    const typedDraftIds = extractMutationDraftIds(typingTraffic);
    const discardedDraftIds = extractDeletedDraftIds(discardTraffic);
    const authoredDraftId = preExitStorageSnapshot.refresh.draftId ?? "";
    const autosavePersistenceObserved =
      typedDraftIds.includes(authoredDraftId) ||
      (preExitStorageSnapshot.refresh.exists &&
        preExitStorageSnapshot.initialDraft.draftId === authoredDraftId &&
        preExitStorageSnapshot.refresh.savedAt !== null);
    const postExitCleared = !postExitStorageSnapshot.refresh.exists && !postExitStorageSnapshot.initialDraft.exists;

    const report = {
      authoredDraftId,
      autosavePersistenceObserved,
      capabilities,
      cleanupDeletedSubjects,
      cleanupRemainingSubjects,
      directComposeReopenExecuted: false,
      directComposeReopenReason:
        "Skipped intentionally because the current shipped save-exit path clears compose cache and direct reopen can seed untagged default drafts.",
      discardTraffic,
      discardedDraftIds,
      draftsListReopenedStorage,
      draftsListReopenedValues: draftsListReopenedValuesSnapshot,
      draftsListSubjectsAfterSave,
      hydrationTelemetry: telemetryEvents,
      initialValues: initialValuesSnapshot,
      overwriteSource: "same-draftid-reopens-with-template-values",
      postExitCleared,
      postExitStorage: postExitStorageSnapshot,
      preExistingCleanup,
      preExitStorage: preExitStorageSnapshot,
      readiness,
      restorePath: {
        directCompose: "template-default-bootstrapping",
        draftsList: "same-draftid-template-overwrite"
      },
      templateDefaults,
      typingTraffic,
      typedDraftIds
    };

    console.log(`INSSA_DRAFT_RESTORE_HYDRATION ${JSON.stringify(report)}`);
    await testInfo.attach("inssa-draft-restore-hydration.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json"
    });

    expect(initialValuesSnapshot.subject, "Expected direct compose bootstrapping to start from the route-derived template subject.").toBe(
      templateDefaults.subject
    );
    expect(initialValuesSnapshot.message, "Expected direct compose bootstrapping to start from the route-derived template message.").toBe(
      templateDefaults.message
    );
    expect(preExitStorageSnapshot.refresh.exists, "Expected compose session cache to exist before Save & exit.").toBe(true);
    expect(preExitStorageSnapshot.refresh.subjectKind, "Expected compose session cache to hold the QA-authored subject before exit.").toBe(
      "qa"
    );
    expect(preExitStorageSnapshot.refresh.messageKind, "Expected compose session cache to hold the QA-authored message before exit.").toBe(
      "qa"
    );
    expect(authoredDraftId, "Expected the pre-exit compose cache to track a persisted draft id.").toBeTruthy();
    expect(
      autosavePersistenceObserved,
      "Expected autosave persistence to be observable either through Firestore write traffic or through the authored compose session cache snapshot before exit."
    ).toBe(true);
    expect(postExitCleared, "Expected Save & exit to clear the compose sessionStorage cache keys.").toBe(true);
    expect(
      draftsListSubjectsAfterSave,
      "Expected the authored QA subject to disappear from Buried drafts after Save & exit, indicating title/body overwrite."
    ).not.toContain(seed.subject);
    expect(
      draftsListReopenedValuesSnapshot.subject,
      "Expected the latest Buried draft row for this authored draft id to reopen with the template subject."
    ).toBe(templateDefaults.subject);
    expect(
      draftsListReopenedValuesSnapshot.message,
      "Expected the latest Buried draft row for this authored draft id to reopen with the template message."
    ).toBe(templateDefaults.message);
    expect(
      draftsListReopenedStorageSnapshot.refresh.draftId,
      "Expected Buried drafts reopen to hydrate the same authored draft id, even though the visible fields were reset to template defaults."
    ).toBe(
      authoredDraftId
    );
    expect(discardedDraftIds, "Expected discarding the QA draft from Buried drafts to delete the authored draft id.").toContain(
      authoredDraftId
    );
    expect(cleanupRemainingSubjects, "Expected no QA-tagged drafts to remain after cleanup.").toEqual([]);
  });
});

async function captureFirestoreDraftTraffic(page: Page, action: () => Promise<void>): Promise<TrafficCapture> {
  const requests: TrafficCapture["requests"] = [];

  const onRequest = (request: any) => {
    if (!/google\.firestore\.v1\.Firestore\/(?:Write|Listen)\/channel/i.test(request.url())) {
      return;
    }

    requests.push({
      firestoreMutations: summarizeFirestoreMutations(request.url(), request.postData() ?? null),
      method: request.method(),
      url: request.url()
    });
  };

  page.on("request", onRequest);

  try {
    await action();
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  } finally {
    page.off("request", onRequest);
  }

  return { requests };
}

function extractDeletedDraftIds(traffic: TrafficCapture | null): string[] {
  return Array.from(
    new Set(
      traffic?.requests
        .flatMap((request) => request.firestoreMutations)
        .filter((mutation) => mutation.kind === "delete" && mutation.documentId)
        .map((mutation) => mutation.documentId as string) ?? []
    )
  );
}

function extractMutationDraftIds(traffic: TrafficCapture | null): string[] {
  return Array.from(
    new Set(
      traffic?.requests
        .flatMap((request) => request.firestoreMutations)
        .filter((mutation) => mutation.kind === "update" && mutation.documentId)
        .map((mutation) => mutation.documentId as string) ?? []
    )
  );
}

async function bestEffortDiscardDraftByIdFromDraftsList(
  page: Page,
  drafts: DraftsPage,
  compose: TimeCapsulePage,
  input: {
    composePathname: string;
    draftId: string;
    qaMarker: string;
    qaMessage: string;
    qaSubject: string;
    templateMessage: string;
    templateSubject: string;
  }
): Promise<boolean> {
  try {
    await openDraftByIdFromDraftsList(page, drafts, compose, input);
    await compose.discardDraft();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function openDraftByIdFromDraftsList(
  page: Page,
  drafts: DraftsPage,
  compose: TimeCapsulePage,
  input: {
    composePathname: string;
    draftId: string;
    qaMarker: string;
    qaMessage: string;
    qaSubject: string;
    templateMessage: string;
    templateSubject: string;
  }
): Promise<void> {
  await drafts.goToDrafts();

  for (let index = 0; index < 5; index += 1) {
    await drafts.openDraftBySubject(input.templateSubject, index);
    await compose.expectComposeSurface();

    const storage = await compose.readClientDraftStorage({
      pathname: input.composePathname,
      qaMarker: input.qaMarker,
      qaMessage: input.qaMessage,
      qaSubject: input.qaSubject,
      templateMessage: input.templateMessage,
      templateSubject: input.templateSubject
    });

    if (storage.refresh.draftId === input.draftId) {
      return;
    }

    await drafts.goToDrafts();
  }

  throw new Error(`Could not locate Buried drafts entry for draft id "${input.draftId}" among the latest template-titled drafts.`);
}

function summarizeFirestoreMutations(url: string, rawBody: string | null): FirestoreMutationRecord[] {
  if (!rawBody || !/google\.firestore\.v1\.Firestore\/(?:Write|Listen)\/channel/i.test(url)) {
    return [];
  }

  const params = new URLSearchParams(rawBody);
  const channel = /\/Write\/channel/i.test(url) ? "write" : "listen";
  const mutations: FirestoreMutationRecord[] = [];

  for (const [key, value] of params.entries()) {
    if (!/^req\d+___data__$/.test(key)) {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }

    if (parsed?.addTarget) {
      mutations.push({
        channel,
        collection: extractCollectionFromTarget(parsed.addTarget),
        containsQaMarker: false,
        kind: "addTarget",
        targetId: parsed.addTarget.targetId
      });
    }

    if (parsed?.removeTarget) {
      mutations.push({
        channel,
        containsQaMarker: false,
        kind: "removeTarget",
        targetId: parsed.removeTarget
      });
    }

    for (const write of parsed?.writes ?? []) {
      const deletePath = extractDocumentPath(write?.delete);
      if (deletePath) {
        mutations.push({
          channel,
          collection: extractCollectionFromDocumentPath(deletePath),
          containsQaMarker: false,
          documentId: extractDocumentId(deletePath),
          kind: "delete"
        });
      }

      const updatePath = extractDocumentPath(write?.update?.name);
      if (updatePath) {
        const fields = write?.update?.fields ?? {};
        const messageTitle = extractFirestoreString(fields.messageTitle);
        const messageBody = extractFirestoreString(fields.messageBody);
        mutations.push({
          channel,
          collection: extractCollectionFromDocumentPath(updatePath),
          containsQaMarker: Boolean(
            [messageTitle, messageBody].filter(Boolean).some((value) => String(value).includes("QA_TEST_CAPSULE"))
          ),
          documentId: extractDocumentId(updatePath),
          draftStep: extractFirestoreString(fields.draftStep),
          isDraft: extractFirestoreBoolean(fields.isDraft),
          kind: "update",
          lifecycleStatus: extractFirestoreString(fields.lifecycleStatus),
          status: extractFirestoreString(fields.status)
        });
      }
    }
  }

  return mutations;
}

function extractCollectionFromDocumentPath(documentPath: string | undefined): string | undefined {
  if (!documentPath) {
    return undefined;
  }

  const parts = documentPath.split("/documents/")[1]?.split("/") ?? [];
  return parts.length >= 2 ? parts[0] : undefined;
}

function extractCollectionFromTarget(target: any): string | undefined {
  const queryParent = extractDocumentPath(target?.query?.parent);
  return extractCollectionFromDocumentPath(queryParent);
}

function extractDocumentId(documentPath: string | undefined): string | undefined {
  if (!documentPath) {
    return undefined;
  }

  const parts = documentPath.split("/documents/")[1]?.split("/") ?? [];
  return parts.length >= 2 ? parts[parts.length - 1] : undefined;
}

function extractDocumentPath(candidate: unknown): string | undefined {
  return typeof candidate === "string" && candidate.includes("/documents/") ? candidate : undefined;
}

function extractFirestoreBoolean(candidate: any): boolean | undefined {
  if (typeof candidate?.booleanValue === "boolean") {
    return candidate.booleanValue;
  }

  return undefined;
}

function extractFirestoreString(candidate: any): string | undefined {
  if (typeof candidate?.stringValue === "string") {
    return candidate.stringValue;
  }

  return undefined;
}
