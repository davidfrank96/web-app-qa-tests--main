import { expect, test } from "./fixtures";
import {
  InssaFinalLiveCreateStepError,
  type InssaComposeStepSnapshot,
  type InssaLiveCapsuleShareEvidence,
  type InssaRevealSettingsModalSnapshot,
  TimeCapsulePage
} from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  captureInssaLifecycleArtifactScreenshot,
  getInssaLifecycleArtifactPath,
  writeInssaLifecycleArtifactJson
} from "../../utils/inssa-live-artifacts";
import {
  classifyInssaLifecyclePersistence,
  createInssaLifecycleNetworkMonitor,
  type InssaLifecycleNetworkObservation,
  type InssaLifecycleNetworkPhase,
  type InssaLifecycleNetworkSummary,
  type InssaLifecyclePersistenceClassification
} from "../../utils/inssa-lifecycle-network";
import {
  summarizeInssaLifecycleNetworkIssues,
  type ClassifiedInssaLifecycleNetworkIssue,
  type InssaLifecycleRequestFailureContext,
  type InssaLifecycleRequestFailureSummary
} from "../../utils/inssa-noise";
import {
  INSSA_DEFAULT_COMPOSE_ROUTE,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN
} from "../../utils/inssa-test-data";
import {
  buildInssaQaLiveCapsuleSeed,
  createInssaMutationRunContext,
  INSSA_LIVE_CAPSULE_ENV_FLAG,
  INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG
} from "../../utils/inssa-mutation";
import { withInssaStabilityMonitor } from "../../utils/monitor";

const DEFAULT_TIMEOUT = 20_000;
const LIVE_TEST_ENABLED = process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] === "1";
const MANUAL_CLEANUP_APPROVED = process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] === "1";
const STAGING_HOSTNAME = "staging.inssa.us";

type LiveCapsuleArtifact = {
  artifactStateNote: string | null;
  buryClicked: boolean;
  cleanupInstruction: string;
  createdAt: string;
  draftIdBeforeCreate: string | null;
  environment: "staging";
  finalActionClicked: boolean;
  finalActionLabel: string | null;
  fatalNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[];
  finalUrl: string;
  maskedTestEmail: string;
  message: string;
  observedCreateSuccess: boolean;
  observedDeleteArchiveControls: {
    archiveCapsule: boolean;
    deleteCapsule: boolean;
    editCapsule: boolean;
    hideCapsule: boolean;
  };
  possibleDocumentIds: string[];
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  postContinueScreenshotPath: string | null;
  postFinalizationScreenshotPath: string | null;
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalShareLink: string | null;
  lifecycleClassification: InssaLifecyclePersistenceClassification;
  lifecycleSucceededDespiteWarnings: boolean;
  lifecycleNetworkDebugEnabled: boolean;
  lifecycleNetworkSummary: InssaLifecycleNetworkSummary;
  revealAudience: "personal-memory" | "shared-capsule" | null;
  revealSettingsContinueClicked: boolean;
  revealSettingsFollowupClickedLabel: string | null;
  revealSettingsOpened: boolean;
  revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[];
  revealTiming: "reveal-later" | "reveal-now" | null;
  requestFailureSummary: InssaLifecycleRequestFailureSummary;
  runId: string;
  screenshotPath: string | null;
  sendToContactsClicked: boolean;
  shareDecisionStepReached: boolean;
  skipContactsClicked: boolean;
  stepButtonSnapshots: InssaComposeStepSnapshot[];
  subject: string;
  successSignals: string[];
  testOutputDir: string;
  url: string;
  visibleSuccessText: string | null;
  warningNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[];
  writesObserved: InssaLifecycleNetworkObservation[];
};

test.describe("INSSA live capsule create", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!LIVE_TEST_ENABLED, `Requires ${INSSA_LIVE_CAPSULE_ENV_FLAG}=1 to create a staging live capsule.`);
  test.skip(
    !MANUAL_CLEANUP_APPROVED,
    `Requires ${INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG}=1 because staging live capsules require manual cleanup.`
  );
  test.setTimeout(240_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();
    getInssaTestCredentials();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA live capsule testing is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("creates one QA-tagged text-only live capsule on staging and emits manual cleanup evidence", async (
    { page },
    testInfo
  ) => {
    test.slow();
    testInfo.annotations.push({
      type: "warning",
      description: "Creates one staging live capsule. Run with --workers=1 --retries=0 and coordinate manual cleanup."
    });

    const configuredUrl = assertValidInssaUrl();
    const { email } = getInssaTestCredentials();
    const maskedTestEmail = maskEmail(email);
    const errorMonitor = createInssaErrorMonitor(page);
    const compose = new TimeCapsulePage(page);
    const runContext = createInssaMutationRunContext({
      file: testInfo.file,
      projectName: testInfo.project.name,
      retry: testInfo.retry,
      title: testInfo.title
    });
    const seed = buildInssaQaLiveCapsuleSeed(runContext);
    const composePathname = new URL(INSSA_DEFAULT_COMPOSE_ROUTE, configuredUrl).pathname;
    const screenshotFileName = `${runContext.runId}.png`;
    const postContinueScreenshotFileName = `${runContext.runId}-post-continue.png`;
    const postFinalizationScreenshotFileName = `${runContext.runId}-post-finalization.png`;
    const artifactFileName = `${runContext.runId}.json`;
    const screenshotPath = getInssaLifecycleArtifactPath(screenshotFileName);
    const postContinueScreenshotPath = getInssaLifecycleArtifactPath(postContinueScreenshotFileName);
    const postFinalizationScreenshotPath = getInssaLifecycleArtifactPath(postFinalizationScreenshotFileName);
    const possibleDocumentIds = new Set<string>();
    const stepButtonSnapshots: InssaComposeStepSnapshot[] = [];
    const revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[] = [];
    const successSignals = new Set<string>();
    let phase: InssaLifecycleNetworkPhase = "pre-create";
    let finalActionLabel: string | null = null;
    let draftIdBeforeCreate: string | null = null;
    let visibleSuccessText: string | null = null;
    let observedCreateSuccess = false;
    let finalUrl = "";
    let finalShareEvidence: InssaLiveCapsuleShareEvidence | null = null;
    let finalShareLink: string | null = null;
    let possibleFinalCapsuleId: string | null = null;
    let possibleShareToken: string | null = null;
    let finalActionClicked = false;
    let buryClicked = false;
    let artifactStateNote: string | null = null;
    let revealSettingsOpened = false;
    let revealAudience: "personal-memory" | "shared-capsule" | null = null;
    let revealTiming: "reveal-later" | "reveal-now" | null = null;
    let revealSettingsContinueClicked = false;
    let revealSettingsFollowupClickedLabel: string | null = null;
    let sendToContactsClicked = false;
    let shareDecisionStepReached = false;
    let skipContactsClicked = false;
    let fatalNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[] = [];
    let warningNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[] = [];
    let requestFailureSummary: InssaLifecycleRequestFailureSummary = summarizeInssaLifecycleNetworkIssues([]);
    let lifecycleSucceededDespiteWarnings = false;
    let observedDeleteArchiveControls = {
      archiveCapsule: false,
      deleteCapsule: false,
      editCapsule: false,
      hideCapsule: false
    };
    const networkMonitor = createInssaLifecycleNetworkMonitor({
      getPhase: () => phase,
      onPossibleDocumentId: (id) => possibleDocumentIds.add(id)
    });
    networkMonitor.attach(page);

    try {
      await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
        await monitor.step("open authenticated compose route directly", () => compose.goToComposeRoute(), {
          phase: "navigation",
          route: "/timecapsule"
        });
        await monitor.step("assert compose surface and metadata", async () => {
          await compose.expectComposeSurface();
          await compose.expectRequiredFieldMetadata();
          await expect
            .poll(() => page.url(), {
              timeout: DEFAULT_TIMEOUT,
              message: "Expected the live capsule smoke test to remain on the compose route before creation."
            })
            .toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);
        }, { phase: "assertion" });

        await monitor.step("fill unique QA-tagged text-only live capsule content", async () => {
          await compose.fillComposeFields(seed);
          await compose.expectComposeValues(seed);

          const draftStorage = await compose.readClientDraftStorage({
            pathname: composePathname,
            qaMarker: runContext.marker,
            qaMessage: seed.message,
            qaSubject: seed.subject,
            templateMessage: "",
            templateSubject: ""
          });

          draftIdBeforeCreate = draftStorage.refresh.draftId || null;
          if (draftIdBeforeCreate) {
            possibleDocumentIds.add(draftIdBeforeCreate);
          }
        }, { phase: "interaction" });

        await monitor.step("advance safely until Bury is visible on the final Share step", async () => {
          try {
            const resolution = await compose.waitForShareStepReady({ maxAdvanceClicks: 4 });
            stepButtonSnapshots.push(...resolution.snapshots);
            finalActionLabel = resolution.finalActionLabel;
            successSignals.add(`final-action=${finalActionLabel}`);
          } catch (error) {
            if (error instanceof InssaFinalLiveCreateStepError) {
              stepButtonSnapshots.push(...error.snapshots);
            }

            throw error;
          }
        }, { phase: "interaction" });

        await monitor.step('click Bury once to open Reveal settings', async () => {
          phase = "bury-click";
          await compose.clickBuryOnceToOpenRevealSettings();
          finalActionClicked = true;
          buryClicked = true;
          revealSettingsOpened = true;
          revealSettingsSnapshots.push(await compose.snapshotRevealSettingsModal());
          successSignals.add("reveal-settings-opened");
        }, { phase: "interaction" });

        await monitor.step("choose Shared capsule and Reveal now", async () => {
          const selection = await compose.chooseRevealSettingsForQaLiveCapsule();
          revealAudience = selection.revealAudience;
          revealTiming = selection.revealTiming;
          revealSettingsSnapshots.push(await compose.snapshotRevealSettingsModal());
          successSignals.add(`reveal-audience=${revealAudience}`);
          successSignals.add(`reveal-timing=${revealTiming}`);
        }, { phase: "interaction" });

        await monitor.step('click Reveal settings Continue once', async () => {
          phase = "reveal-continue";
          await compose.continueRevealSettingsOnce();
          revealSettingsContinueClicked = true;
          successSignals.add("reveal-continue-clicked");
          await captureInssaLifecycleArtifactScreenshot(page, postContinueScreenshotFileName).catch(() => {});
        }, { phase: "interaction" });

        await monitor.step("wait for final share-link evidence", async () => {
          phase = "post-create";
          const outcome = await compose.waitForLiveCapsuleShareLinkEvidence();
          revealSettingsSnapshots.push(...outcome.revealSettingsSnapshots);
          revealSettingsFollowupClickedLabel = outcome.followupClickedLabel;
          sendToContactsClicked = outcome.sendToContactsClicked;
          shareDecisionStepReached = outcome.shareDecisionStepReached;
          skipContactsClicked = outcome.skipContactsClicked;
          finalShareEvidence = outcome.shareEvidence;
          if (revealSettingsFollowupClickedLabel) {
            successSignals.add(`reveal-followup=${revealSettingsFollowupClickedLabel}`);
          }
          if (shareDecisionStepReached) {
            successSignals.add("share-decision-step-reached");
          }
          if (skipContactsClicked) {
            successSignals.add("skip-contacts-share-link-clicked");
          }
          if (sendToContactsClicked) {
            successSignals.add("send-to-contacts-clicked");
          }

          finalUrl = page.url();
          finalShareLink = outcome.shareEvidence.finalShareLink;
          possibleFinalCapsuleId = outcome.shareEvidence.possibleFinalCapsuleId;
          possibleShareToken = outcome.shareEvidence.possibleShareToken;
          visibleSuccessText = outcome.shareEvidence.visibleSuccessText;
          outcome.shareEvidence.successSignals.forEach((signal) => successSignals.add(signal));
          if (possibleFinalCapsuleId) {
            possibleDocumentIds.add(possibleFinalCapsuleId);
          }
          if (possibleShareToken) {
            successSignals.add(`share-token=${possibleShareToken}`);
          }
          await captureInssaLifecycleArtifactScreenshot(page, postFinalizationScreenshotFileName).catch(() => {});
        }, { phase: "interaction" });

        await monitor.step("capture post-create evidence", async () => {
          finalUrl = finalUrl || page.url();

          observedDeleteArchiveControls = {
            archiveCapsule: await compose.archiveCapsuleButton().isVisible().catch(() => false),
            deleteCapsule: await compose.deleteCapsuleButton().isVisible().catch(() => false),
            editCapsule: await compose.editCapsuleButton().isVisible().catch(() => false),
            hideCapsule: await compose.hideCapsuleButton().isVisible().catch(() => false)
          };

          if (possibleFinalCapsuleId) {
            successSignals.add(`capsule-id=${possibleFinalCapsuleId}`);
          }
          if (finalShareLink) {
            successSignals.add(`final-share-link=${finalShareLink}`);
          }

          observedCreateSuccess =
            Boolean(finalShareLink) ||
            Boolean(possibleFinalCapsuleId) ||
            Boolean(possibleShareToken) ||
            Boolean(visibleSuccessText) ||
            Object.values(observedDeleteArchiveControls).some(Boolean) ||
            [...successSignals].some((signal) =>
              /copy-share-link-visible|share-link-button-visible|home-button-visible|share-link=|final-share-link=|visible-success=/.test(
                signal
              )
            );

          expect(
            observedCreateSuccess,
            `Expected the live capsule smoke test to observe a creation success signal. Final URL: ${finalUrl || page.url()}. Signals: ${[...successSignals].join(", ")}`
          ).toBe(true);
        }, { phase: "assertion" });

        await monitor.step("assert no unexpected INSSA errors", async () => {
          const lifecycleRequestContext = buildLifecycleRequestFailureContext({
            finalShareEvidence,
            finalShareLink,
            lifecycleStage: "text-live-create",
            observedCreateSuccess,
            possibleFinalCapsuleId,
            possibleShareToken,
            revealSettingsContinueClicked,
            uploadSucceeded: true
          });
          const classifiedNetworkIssues = errorMonitor.classifyLifecycleRequestFailures(lifecycleRequestContext);
          fatalNetworkIssues = classifiedNetworkIssues.filter((issue) => issue.impact === "fatal");
          warningNetworkIssues = classifiedNetworkIssues.filter((issue) => issue.impact === "warning");
          requestFailureSummary = summarizeInssaLifecycleNetworkIssues(classifiedNetworkIssues);
          lifecycleSucceededDespiteWarnings =
            lifecycleRequestContext.lifecycleSucceeded &&
            lifecycleRequestContext.retrievalSucceeded &&
            warningNetworkIssues.length > 0 &&
            fatalNetworkIssues.length === 0;

          await errorMonitor.expectNoUnexpectedErrors(
            buildPostSuccessLifecycleIgnorePatterns(lifecycleRequestContext),
            { lifecycleRequestContext }
          );
        }, {
          phase: "assertion"
        });
      });
    } finally {
      await networkMonitor.flush();
      const lifecycleNetworkSummary = networkMonitor.summarize();
      lifecycleNetworkSummary.possibleDocumentIds.forEach((id) => possibleDocumentIds.add(id));
      possibleFinalCapsuleId = possibleFinalCapsuleId ?? lifecycleNetworkSummary.possibleCapsuleIds[0] ?? null;
      possibleShareToken = possibleShareToken ?? lifecycleNetworkSummary.possibleShareTokens[0] ?? null;
      await captureInssaLifecycleArtifactScreenshot(page, screenshotFileName).catch(() => {});
      if (skipContactsClicked) {
        await captureInssaLifecycleArtifactScreenshot(page, postFinalizationScreenshotFileName).catch(() => {});
      }
      if (revealSettingsContinueClicked && !finalShareEvidence) {
        finalShareEvidence = await compose.readLiveCapsuleShareEvidence().catch(() => null);
        if (finalShareEvidence) {
          finalUrl = finalUrl || page.url();
          finalShareLink = finalShareLink ?? finalShareEvidence.finalShareLink;
          possibleFinalCapsuleId = possibleFinalCapsuleId ?? finalShareEvidence.possibleFinalCapsuleId;
          possibleShareToken = possibleShareToken ?? finalShareEvidence.possibleShareToken;
          visibleSuccessText = visibleSuccessText ?? finalShareEvidence.visibleSuccessText;
          finalShareEvidence.successSignals.forEach((signal) => successSignals.add(signal));
        }
      }

      finalUrl = finalUrl || page.url();
      observedCreateSuccess =
        observedCreateSuccess ||
        Boolean(finalShareLink) ||
        Boolean(possibleFinalCapsuleId) ||
        Boolean(possibleShareToken) ||
        Boolean(visibleSuccessText) ||
        Boolean(finalShareEvidence?.copyShareLinkVisible) ||
        Boolean(finalShareEvidence?.shareLinkButtonVisible) ||
        Boolean(finalShareEvidence?.homeVisible);
      const lifecycleClassification = classifyInssaLifecyclePersistence({
        finalShareEvidence,
        finalShareLink,
        finalUrl,
        networkSummary: lifecycleNetworkSummary,
        observedCreateSuccess,
        possibleFinalCapsuleId,
        possibleShareToken,
        revealAudience,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealTiming
      });
      const lifecycleRequestContext = buildLifecycleRequestFailureContext({
        finalShareEvidence,
        finalShareLink,
        lifecycleStage: "text-live-create",
        observedCreateSuccess,
        possibleFinalCapsuleId,
        possibleShareToken,
        revealSettingsContinueClicked,
        uploadSucceeded: true
      });
      const classifiedNetworkIssues = errorMonitor.classifyLifecycleRequestFailures(lifecycleRequestContext);
      fatalNetworkIssues = classifiedNetworkIssues.filter((issue) => issue.impact === "fatal");
      warningNetworkIssues = classifiedNetworkIssues.filter((issue) => issue.impact === "warning");
      requestFailureSummary = summarizeInssaLifecycleNetworkIssues(classifiedNetworkIssues);
      lifecycleSucceededDespiteWarnings =
        lifecycleRequestContext.lifecycleSucceeded &&
        lifecycleRequestContext.retrievalSucceeded &&
        warningNetworkIssues.length > 0 &&
        fatalNetworkIssues.length === 0;
      successSignals.add(`lifecycle-classification=${lifecycleClassification}`);
      if (!buryClicked) {
        artifactStateNote = "Bury was not clicked. No live capsule is likely to exist; only a draft-side artifact may exist on staging.";
      } else if (buryClicked && !revealSettingsContinueClicked) {
        artifactStateNote =
          "Bury was clicked and Reveal settings opened, but finalization was not continued. A live capsule may or may not exist on staging.";
      } else if (revealSettingsContinueClicked) {
        artifactStateNote = observedCreateSuccess
          ? "Live capsule finalization was attempted; verify staging before rerun. Share-link evidence was observed and manual cleanup is required."
          : "Live capsule finalization was attempted; verify staging before rerun.";
      }
      const artifact: LiveCapsuleArtifact = {
        artifactStateNote,
        buryClicked,
        cleanupInstruction: "Development team should delete this QA live capsule from staging after verification.",
        createdAt: seed.createdAtIso,
        draftIdBeforeCreate,
        environment: "staging",
        finalActionClicked,
        finalActionLabel,
        fatalNetworkIssues,
        finalUrl,
        maskedTestEmail,
        message: seed.message,
        observedCreateSuccess,
        observedDeleteArchiveControls,
        finalShareLink,
        lifecycleClassification,
        lifecycleSucceededDespiteWarnings,
        lifecycleNetworkDebugEnabled: lifecycleNetworkSummary.debugEnabled,
        lifecycleNetworkSummary,
        possibleDocumentIds: [...possibleDocumentIds],
        possibleFinalCapsuleId,
        possibleShareToken,
        postContinueScreenshotPath: revealSettingsContinueClicked ? postContinueScreenshotPath : null,
        postFinalizationScreenshotPath: skipContactsClicked ? postFinalizationScreenshotPath : null,
        finalShareEvidence,
        revealAudience,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        requestFailureSummary,
        runId: runContext.runId,
        screenshotPath,
        sendToContactsClicked,
        shareDecisionStepReached,
        skipContactsClicked,
        stepButtonSnapshots,
        subject: seed.subject,
        successSignals: [...successSignals],
        testOutputDir: testInfo.outputDir,
        url: configuredUrl,
        visibleSuccessText,
        warningNetworkIssues,
        writesObserved: networkMonitor.observations
      };

      await writeInssaLifecycleArtifactJson(artifactFileName, artifact);
      await testInfo.attach("inssa-live-capsule-artifact.json", {
        body: JSON.stringify(artifact, null, 2),
        contentType: "application/json"
      });
    }
  });
});

function maskEmail(email: string): string {
  const [localPart, domain = ""] = email.split("@");
  if (!localPart) {
    return `***@${domain}`;
  }

  return `${localPart[0]}***@${domain}`;
}

function buildLifecycleRequestFailureContext(input: {
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalShareLink: string | null;
  lifecycleStage: string;
  observedCreateSuccess: boolean;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  revealSettingsContinueClicked: boolean;
  uploadSucceeded: boolean;
}): InssaLifecycleRequestFailureContext {
  const retrievalSucceeded = Boolean(
    input.finalShareLink ||
      input.possibleFinalCapsuleId ||
      input.possibleShareToken ||
      input.finalShareEvidence?.finalShareLink ||
      input.finalShareEvidence?.possibleFinalCapsuleId ||
      input.finalShareEvidence?.possibleShareToken ||
      input.finalShareEvidence?.copyShareLinkVisible ||
      input.finalShareEvidence?.shareLinkButtonVisible ||
      input.finalShareEvidence?.homeVisible
  );

  return {
    finalizationAttempted: input.revealSettingsContinueClicked,
    lifecycleStage: input.lifecycleStage,
    lifecycleSucceeded: input.observedCreateSuccess,
    retrievalSucceeded,
    shareLinkCaptured: retrievalSucceeded,
    uploadSucceeded: input.uploadSucceeded
  };
}

function buildPostSuccessLifecycleIgnorePatterns(
  lifecycleRequestContext: InssaLifecycleRequestFailureContext
): RegExp[] {
  if (!lifecycleRequestContext.lifecycleSucceeded || !lifecycleRequestContext.retrievalSucceeded) {
    return [];
  }

  return [/Error saving time capsule: FirebaseError: Document already exists:/i];
}
