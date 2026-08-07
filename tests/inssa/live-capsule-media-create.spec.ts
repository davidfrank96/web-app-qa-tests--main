import { promises as fs } from "fs";
import path from "path";
import { expect, test } from "./fixtures";
import {
  InssaFinalLiveCreateStepError,
  type InssaComposeStepSnapshot,
  type InssaExactContactSelection,
  type InssaLiveCapsuleShareEvidence,
  type InssaMediaAttachmentEvidence,
  type InssaMediaSelectionSnapshot,
  type InssaMediaStepCapabilities,
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
  buildInssaComposeRouteForLocation,
  getInssaComposeTemplateDefaults,
  getInssaUsMarketLocation
} from "../../utils/inssa-test-data";
import {
  buildInssaQaLiveMediaCapsuleSeed,
  createInssaMutationRunContext,
  INSSA_LIVE_CAPSULE_ENV_FLAG,
  INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG,
  INSSA_MEDIA_CAPSULE_ENV_FLAG,
  INSSA_REMOTE_IMAGE_TESTS_ENV_FLAG,
  INSSA_REMOTE_IMAGE_URL_ENV,
  INSSA_US_MARKET_LOCATION_ENV_FLAG
} from "../../utils/inssa-mutation";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import {
  assertInssaContactSelectionTransition,
  assertInssaCleanupOwnership,
  classifyInssaCleanupIdentity,
  type InssaCleanupIdentityStatus
} from "../../utils/inssa-text-lifecycle-state";

const DEFAULT_TIMEOUT = 25_000;
const LIVE_TEST_ENABLED = process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] === "1";
const MANUAL_CLEANUP_APPROVED = process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] === "1";
const MEDIA_TEST_ENABLED = process.env[INSSA_MEDIA_CAPSULE_ENV_FLAG] === "1";
const REMOTE_IMAGE_ENABLED = process.env[INSSA_REMOTE_IMAGE_TESTS_ENV_FLAG] === "1";
const REMOTE_IMAGE_URL = process.env[INSSA_REMOTE_IMAGE_URL_ENV]?.trim() ?? "";
const SELECTED_LOCATION_KEY = process.env[INSSA_US_MARKET_LOCATION_ENV_FLAG]?.trim().toLowerCase() ?? "";
const STAGING_HOSTNAME = "staging.inssa.us";
const MAX_REMOTE_IMAGE_BYTES = 2 * 1024 * 1024;
const APPROVED_CONTACT_EMAIL = "test2@gmail.com";

type MediaMode = "downloaded-remote-image" | "existing-local-fixture" | "generated-local-fixture" | "remote-url-input";

type PreparedMediaAttachment = {
  fileName: string | null;
  filePath: string | null;
  mediaMode: MediaMode;
  remoteImageUrl: string | null;
  sizeBytes: number | null;
};

type LiveMediaCapsuleArtifact = {
  artifactStateNote: string | null;
  buryClicked: boolean;
  cleanupIdentityStatus: InssaCleanupIdentityStatus;
  cleanupInvestigationRequired: boolean;
  mediaAttachmentEvidence: InssaMediaAttachmentEvidence | null;
  cleanupInstruction: string;
  createdAt: string;
  draftIdBeforeCreate: string | null;
  environment: "staging";
  fatalNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[];
  finalActionClicked: boolean;
  finalActionContext: {
    campaign: "media";
    currentStep: string;
    currentUrl: string;
    fixtureType: "image";
    selectedCount: number;
    selectedRecipient: string;
  } | null;
  finalActionLabel: string | null;
  finalShareActionClicked: boolean;
  finalizationPersistenceResponseStatuses: number[];
  finalUrl: string;
  maskedTestEmail: string;
  mediaCapabilities: InssaMediaStepCapabilities;
  mediaMode: MediaMode;
  mediaType: "image";
  message: string;
  observedCreateSuccess: boolean;
  possibleDocumentIds: string[];
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  postContinueScreenshotPath: string | null;
  preContactSelectionScreenshotPath: string | null;
  selectedContactScreenshotPath: string | null;
  postFinalizationScreenshotPath: string | null;
  postCreateVisibleControls: {
    archiveCapsule: boolean;
    deleteCapsule: boolean;
    editCapsule: boolean;
    hideCapsule: boolean;
  };
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
  resultingObjectState: "shared-contact-finalized" | null;
  remoteImageUrl: string | null;
  runId: string;
  screenshotPath: string | null;
  sendToContactsClicked: boolean;
  selectedContactCountAfter: number | null;
  selectedContactCountBefore: number | null;
  selectedContactIdentityVerified: boolean;
  selectedContactSelection: InssaExactContactSelection | null;
  selectedContactTarget: string | null;
  selectedMedia: InssaMediaSelectionSnapshot;
  selectedUsLocation: {
    address: string;
    key: string;
    label: string;
    lat: number;
    lng: number;
    marketRegion: string;
  };
  shareDecisionStepReached: boolean;
  skipContactsClicked: boolean;
  stepButtonSnapshots: InssaComposeStepSnapshot[];
  subject: string;
  successSignals: string[];
  testOutputDir: string;
  uploadedFileName: string | null;
  uploadedFileSize: number | null;
  url: string;
  visibleSuccessText: string | null;
  warningNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[];
  writesObserved: InssaLifecycleNetworkObservation[];
};

test.describe("INSSA live media capsule create", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!LIVE_TEST_ENABLED, `Requires ${INSSA_LIVE_CAPSULE_ENV_FLAG}=1 for staging live capsule tests.`);
  test.skip(
    !MANUAL_CLEANUP_APPROVED,
    `Requires ${INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG}=1 because media live capsules require manual cleanup.`
  );
  test.skip(!MEDIA_TEST_ENABLED, `Requires ${INSSA_MEDIA_CAPSULE_ENV_FLAG}=1 for live media capsule creation.`);
  test.skip(
    !SELECTED_LOCATION_KEY,
    `Requires ${INSSA_US_MARKET_LOCATION_ENV_FLAG}=<nyc|los-angeles|chicago|miami|austin|seattle> for single-location live media publishing.`
  );
  test.setTimeout(300_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();
    getInssaTestCredentials();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA live media capsule testing is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("creates one QA-tagged media live capsule on staging and emits manual cleanup evidence", async (
    { page },
    testInfo
  ) => {
    test.slow();
    testInfo.annotations.push({
      type: "warning",
      description:
        "Creates one staging live media capsule. Run with --workers=1 --retries=0 and coordinate manual cleanup."
    });

    const configuredUrl = assertValidInssaUrl();
    const { email } = getInssaTestCredentials();
    const maskedTestEmail = maskEmail(email);
    const location = getInssaUsMarketLocation(SELECTED_LOCATION_KEY);
    if (!location) {
      throw new Error(
        `Unsupported ${INSSA_US_MARKET_LOCATION_ENV_FLAG}="${SELECTED_LOCATION_KEY}". Expected one of nyc, los-angeles, chicago, miami, austin, seattle.`
      );
    }

    const errorMonitor = createInssaErrorMonitor(page);
    const compose = new TimeCapsulePage(page);
    const runContext = createInssaMutationRunContext({
      file: testInfo.file,
      projectName: testInfo.project.name,
      retry: testInfo.retry,
      title: testInfo.title
    });
    const seed = buildInssaQaLiveMediaCapsuleSeed(runContext);
    const composeRoute = buildInssaComposeRouteForLocation(location);
    const composeTemplateDefaults = getInssaComposeTemplateDefaults(composeRoute);
    const screenshotFileName = `${runContext.runId}.png`;
    const postContinueScreenshotFileName = `${runContext.runId}-post-continue.png`;
    const preContactSelectionScreenshotFileName = `${runContext.runId}-contact-before-selection.png`;
    const selectedContactScreenshotFileName = `${runContext.runId}-contact-selected.png`;
    const postFinalizationScreenshotFileName = `${runContext.runId}-post-finalization.png`;
    const artifactFileName = `${runContext.runId}.json`;
    const screenshotPath = getInssaLifecycleArtifactPath(screenshotFileName);
    const postContinueScreenshotPath = getInssaLifecycleArtifactPath(postContinueScreenshotFileName);
    const preContactSelectionScreenshotPath = getInssaLifecycleArtifactPath(preContactSelectionScreenshotFileName);
    const selectedContactScreenshotPath = getInssaLifecycleArtifactPath(selectedContactScreenshotFileName);
    const postFinalizationScreenshotPath = getInssaLifecycleArtifactPath(postFinalizationScreenshotFileName);
    const possibleDocumentIds = new Set<string>();
    const stepButtonSnapshots: InssaComposeStepSnapshot[] = [];
    const successSignals = new Set<string>();
    let phase: InssaLifecycleNetworkPhase = "pre-create";
    let draftIdBeforeCreate: string | null = null;
    let finalActionLabel: string | null = null;
    let finalActionContext: LiveMediaCapsuleArtifact["finalActionContext"] = null;
    let finalUrl = "";
    let finalShareEvidence: InssaLiveCapsuleShareEvidence | null = null;
    let finalShareLink: string | null = null;
    let possibleFinalCapsuleId: string | null = null;
    let possibleShareToken: string | null = null;
    let observedCreateSuccess = false;
    let visibleSuccessText: string | null = null;
    let finalActionClicked = false;
    let finalShareActionClicked = false;
    let finalizationPersistenceResponseStatuses: number[] = [];
    let buryClicked = false;
    let revealSettingsOpened = false;
    let revealAudience: "personal-memory" | "shared-capsule" | null = null;
    let revealTiming: "reveal-later" | "reveal-now" | null = null;
    let revealSettingsContinueClicked = false;
    let revealSettingsFollowupClickedLabel: string | null = null;
    let sendToContactsClicked = false;
    let selectedContactCountAfter: number | null = null;
    let selectedContactCountBefore: number | null = null;
    let selectedContactIdentityVerified = false;
    let selectedContactSelection: InssaExactContactSelection | null = null;
    let selectedContactTarget: string | null = null;
    let shareDecisionStepReached = false;
    let skipContactsClicked = false;
    const revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[] = [];
    let artifactStateNote: string | null = null;
    let mediaCapabilities: InssaMediaStepCapabilities | null = null;
    let preparedMedia: PreparedMediaAttachment = {
      fileName: null,
      filePath: null,
      mediaMode: "generated-local-fixture",
      remoteImageUrl: null,
      sizeBytes: null
    };
    let selectedMedia: InssaMediaSelectionSnapshot = { count: 0, names: [] };
    let mediaAttachmentEvidence: InssaMediaAttachmentEvidence | null = null;
    let fatalNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[] = [];
    let warningNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[] = [];
    let requestFailureSummary: InssaLifecycleRequestFailureSummary = summarizeInssaLifecycleNetworkIssues([]);
    let lifecycleSucceededDespiteWarnings = false;
    let resultingObjectState: "shared-contact-finalized" | null = null;
    let postCreateVisibleControls = {
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
        await monitor.step("open authenticated compose route for selected USA market", () => compose.goToComposeRoute(composeRoute), {
          phase: "navigation",
          route: "/timecapsule"
        });

        await monitor.step("assert compose surface before media creation", async () => {
          await compose.expectComposeSurface();
          await compose.expectRequiredFieldMetadata();
        }, { phase: "assertion" });

        await monitor.step("fill unique QA-tagged live media content", async () => {
          await compose.fillComposeFields(seed);
          await compose.expectComposeValues(seed);

          const draftStorage = await compose.readClientDraftStorage({
            pathname: new URL(page.url()).pathname,
            qaMarker: runContext.marker,
            qaMessage: seed.message,
            qaSubject: seed.subject,
            templateMessage: composeTemplateDefaults.message,
            templateSubject: composeTemplateDefaults.subject
          });

          draftIdBeforeCreate = draftStorage.refresh.draftId || null;
          if (draftIdBeforeCreate) {
            possibleDocumentIds.add(draftIdBeforeCreate);
          }
        }, { phase: "interaction" });

        await monitor.step("reach Media step before upload", async () => {
          stepButtonSnapshots.push(await compose.snapshotComposeStepState());
          await compose.advanceToMediaStep();
          await compose.expectMediaStep();
          stepButtonSnapshots.push(await compose.snapshotComposeStepState());
        }, { phase: "interaction" });

        await monitor.step("inspect media capabilities and attach one image only", async () => {
          mediaCapabilities = await compose.inspectMediaStepCapabilities();
          preparedMedia = await prepareMediaAttachment(testInfo, runContext.runId, mediaCapabilities);

          if (preparedMedia.mediaMode === "remote-url-input") {
            await compose.fillRemoteImageUrl(preparedMedia.remoteImageUrl ?? "");
          } else {
            if (!preparedMedia.filePath) {
              throw new Error("Expected a local media attachment path before uploading the live media capsule image.");
            }
            await compose.attachSingleMediaFile(preparedMedia.filePath);
          }

          selectedMedia = await compose.readSelectedMediaFiles();
          mediaAttachmentEvidence = await compose.readMediaAttachmentEvidence();
          if (preparedMedia.mediaMode !== "remote-url-input") {
            expect(
              selectedMedia.count === 1 ||
                mediaAttachmentEvidence.selectedSummaryCount === 1 ||
                mediaAttachmentEvidence.previewVisible,
              `Expected visible Media-step evidence for exactly one attached file before publishing. inputCount=${
                selectedMedia.count
              }, selectedSummary="${mediaAttachmentEvidence.selectedSummaryText ?? "none"}", previewVisible=${
                mediaAttachmentEvidence.previewVisible
              }`
            ).toBeTruthy();
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

        await monitor.step("click Bury once to open Reveal settings", async () => {
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

        await monitor.step("click Reveal settings Continue once", async () => {
          phase = "reveal-continue";
          await compose.continueRevealSettingsOnce();
          revealSettingsContinueClicked = true;
          successSignals.add("reveal-continue-clicked");
          await captureInssaLifecycleArtifactScreenshot(page, postContinueScreenshotFileName).catch(() => {});
        }, { phase: "interaction" });

        await monitor.step("select the exact approved media recipient", async () => {
          const contactStep = await compose.waitForContactShareDecisionStep();
          revealSettingsSnapshots.push(contactStep);
          expect(contactStep.stepTitle, "Expected current Step 2 title to be Send or save.").toMatch(/send or save/i);
          expect(contactStep.selectedContactsCount, "Expected contact selection to start at 0 selected.").toBe(0);
          shareDecisionStepReached = true;
          await captureInssaLifecycleArtifactScreenshot(page, preContactSelectionScreenshotFileName).catch(() => {});

          selectedContactSelection = await compose.selectExactContactForLifecycle(APPROVED_CONTACT_EMAIL);
          revealSettingsSnapshots.push(selectedContactSelection.beforeSnapshot, selectedContactSelection.afterSnapshot);
          selectedContactCountBefore = selectedContactSelection.beforeSnapshot.selectedContactsCount;
          selectedContactCountAfter = selectedContactSelection.afterSnapshot.selectedContactsCount;
          selectedContactIdentityVerified = selectedContactSelection.targetIdentityVerified;
          selectedContactTarget = selectedContactSelection.selectedContactLabel;
          assertInssaContactSelectionTransition({
            afterCount: selectedContactCountAfter,
            beforeCount: selectedContactCountBefore,
            targetIdentityVerified: selectedContactIdentityVerified
          });
          expect(selectedContactSelection.selectedRowCount, "Expected no other contact to be selected.").toBe(1);
          await captureInssaLifecycleArtifactScreenshot(page, selectedContactScreenshotFileName).catch(() => {});
        }, { phase: "interaction" });

        await monitor.step("finalize media contact share exactly once and capture identity", async () => {
          const selectedSnapshot = await compose.snapshotRevealSettingsModal();
          finalActionContext = {
            campaign: "media",
            currentStep: selectedSnapshot.selectedContactsStepLabel ?? selectedSnapshot.stepLabel ?? "Step 2 of 2",
            currentUrl: page.url(),
            fixtureType: "image",
            selectedCount: selectedSnapshot.selectedContactsCount ?? -1,
            selectedRecipient: selectedContactTarget ?? maskEmail(APPROVED_CONTACT_EMAIL)
          };
          expect(finalActionContext.selectedCount, "Final media action requires exactly one selected contact.").toBe(1);

          phase = "post-create";
          revealSettingsFollowupClickedLabel = await compose.clickBuryThenChooseWhoToShareWithOnce();
          finalShareActionClicked = true;
          finalActionClicked = true;
          finalActionLabel = revealSettingsFollowupClickedLabel;
          sendToContactsClicked = true;
          successSignals.add(`reveal-followup=${revealSettingsFollowupClickedLabel}`);
          successSignals.add("share-decision-step-reached");
          successSignals.add("send-to-contacts-clicked");
          successSignals.add(`selected-contact=${selectedContactTarget}`);
          successSignals.add(`selected-count=${selectedContactCountAfter}`);

          finalShareEvidence = await compose.waitForPostContactFinalizationEvidence();
          finalUrl = page.url();
          finalShareLink = finalShareEvidence.finalShareLink;
          possibleFinalCapsuleId = finalShareEvidence.possibleFinalCapsuleId;
          possibleShareToken = finalShareEvidence.possibleShareToken;
          visibleSuccessText = finalShareEvidence.visibleSuccessText;
          finalShareEvidence.successSignals.forEach((signal) => successSignals.add(signal));
          await captureInssaLifecycleArtifactScreenshot(page, postFinalizationScreenshotFileName).catch(() => {});

          await networkMonitor.flush();
          const postFinalizationNetwork = networkMonitor.summarize();
          finalizationPersistenceResponseStatuses = networkMonitor.observations
            .filter(
              (observation) =>
                observation.event === "response" &&
                observation.phase === "post-create" &&
                /^(POST|PUT|PATCH|DELETE)$/i.test(observation.method) &&
                typeof observation.responseStatus === "number" &&
                observation.responseStatus < 400
            )
            .map((observation) => observation.responseStatus as number);
          expect(
            finalizationPersistenceResponseStatuses.length,
            "Expected the single final media contact-share action to receive a successful persistence response."
          ).toBeGreaterThan(0);
          possibleFinalCapsuleId = possibleFinalCapsuleId ?? postFinalizationNetwork.possibleCapsuleIds[0] ?? null;
          if (!possibleFinalCapsuleId) {
            throw new Error(
              "failed_cleanup_identity: media persistence/finalization succeeded but no capsule ID was captured. Cleanup Investigation Required; automatic retry is forbidden."
            );
          }
          possibleDocumentIds.add(possibleFinalCapsuleId);
          resultingObjectState = "shared-contact-finalized";
          expect(hasMediaUploadEvidence(mediaAttachmentEvidence), "Expected image media association evidence after finalization.").toBe(true);
          expect(preparedMedia.fileName, "Expected the approved image fixture filename to remain associated with the run.").toBeTruthy();
        }, { phase: "interaction" });

        await monitor.step("capture post-create control snapshot", async () => {
          finalUrl = finalUrl || page.url();
          postCreateVisibleControls = {
            archiveCapsule: await compose.archiveCapsuleButton().isVisible().catch(() => false),
            deleteCapsule: await compose.deleteCapsuleButton().isVisible().catch(() => false),
            editCapsule: await compose.editCapsuleButton().isVisible().catch(() => false),
            hideCapsule: await compose.hideCapsuleButton().isVisible().catch(() => false)
          };

          observedCreateSuccess =
            observedCreateSuccess ||
            Object.values(postCreateVisibleControls).some(Boolean) ||
            [...successSignals].some((signal) =>
              /copy-share-link-visible|share-link-button-visible|home-button-visible|share-link=|visible-success=/.test(
                signal
              )
            );

          expect(
            observedCreateSuccess,
            `Expected the live media capsule test to observe creation success evidence. Final URL: ${
              finalUrl || page.url()
            }. Signals: ${[...successSignals].join(", ")}`
          ).toBe(true);
        }, { phase: "assertion" });

        await monitor.step("assert no unexpected INSSA errors", async () => {
          const lifecycleRequestContext = buildLifecycleRequestFailureContext({
            finalShareEvidence,
            finalShareLink,
            lifecycleStage: "media-live-create",
            observedCreateSuccess,
            possibleFinalCapsuleId,
            possibleShareToken,
            revealSettingsContinueClicked,
            uploadSucceeded: hasMediaUploadEvidence(mediaAttachmentEvidence)
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
      if (finalShareActionClicked) {
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
      const cleanupIdentityStatus = classifyInssaCleanupIdentity({
        capsuleId: possibleFinalCapsuleId,
        finalShareActionClicked,
        persistenceSucceeded: observedCreateSuccess || lifecycleNetworkSummary.successfulPostContinueWriteCount > 0
      });
      const cleanupInvestigationRequired = cleanupIdentityStatus === "failed_cleanup_identity";
      const lifecycleRequestContext = buildLifecycleRequestFailureContext({
        finalShareEvidence,
        finalShareLink,
        lifecycleStage: "media-live-create",
        observedCreateSuccess,
        possibleFinalCapsuleId,
        possibleShareToken,
        revealSettingsContinueClicked,
        uploadSucceeded: hasMediaUploadEvidence(mediaAttachmentEvidence)
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

      if (!finalActionClicked) {
        artifactStateNote = "Bury was not clicked. Only a draft-side media artifact may exist on staging.";
      } else if (buryClicked && !revealSettingsContinueClicked) {
        artifactStateNote =
          "Bury was clicked and Reveal settings opened, but finalization was not continued. A live media capsule may or may not exist on staging.";
      } else if (revealSettingsContinueClicked) {
        artifactStateNote = cleanupInvestigationRequired
          ? "Cleanup Investigation Required: media persistence was observed but the capsule ID was not captured. Do not retry the final action."
          : observedCreateSuccess
          ? "Live media capsule finalization was attempted; verify staging before rerun. Share-link evidence was observed and manual cleanup is required."
          : "Live media capsule finalization was attempted; verify staging before rerun.";
      }

      if (possibleFinalCapsuleId && resultingObjectState) {
        assertInssaCleanupOwnership({
          capsuleId: possibleFinalCapsuleId,
          cleanupInstruction: `Delete the QA staging media capsule ${possibleFinalCapsuleId} and associated image after verification.`,
          objectType: "timeCapsule",
          owner: maskedTestEmail,
          resultingState: resultingObjectState
        });
      }

      const artifact: LiveMediaCapsuleArtifact = {
        artifactStateNote,
        buryClicked,
        cleanupIdentityStatus,
        cleanupInvestigationRequired,
        cleanupInstruction: cleanupInvestigationRequired
          ? "Cleanup Investigation Required. Identify the exact staging media capsule before another mutation run; do not retry the final action."
          : `Delete the QA staging media capsule ${possibleFinalCapsuleId ?? "identified by this run's evidence"} and associated image after verification.`,
        createdAt: seed.createdAtIso,
        draftIdBeforeCreate,
        environment: "staging",
        fatalNetworkIssues,
        finalActionClicked,
        finalActionContext,
        finalActionLabel,
        finalShareActionClicked,
        finalizationPersistenceResponseStatuses,
        finalUrl: finalUrl || page.url(),
        maskedTestEmail,
        mediaCapabilities: mediaCapabilities ?? {
          acceptedFileTypes: [],
          fileInputs: [],
          hasFileInput: false,
          hasGalleryOption: false,
          hasPhotoOption: false,
          hasRemoteImageUrlInput: false,
          hasVideoOption: false,
          remoteImageInputDescriptors: [],
          visibleButtons: []
        },
        mediaAttachmentEvidence,
        mediaMode: preparedMedia.mediaMode,
        mediaType: "image",
        message: seed.message,
        observedCreateSuccess,
        possibleDocumentIds: [...possibleDocumentIds],
        possibleFinalCapsuleId,
        possibleShareToken,
        postContinueScreenshotPath: revealSettingsContinueClicked ? postContinueScreenshotPath : null,
        preContactSelectionScreenshotPath: revealSettingsContinueClicked ? preContactSelectionScreenshotPath : null,
        selectedContactScreenshotPath: selectedContactSelection ? selectedContactScreenshotPath : null,
        postFinalizationScreenshotPath: finalShareActionClicked ? postFinalizationScreenshotPath : null,
        postCreateVisibleControls,
        finalShareEvidence,
        finalShareLink,
        lifecycleClassification,
        lifecycleSucceededDespiteWarnings,
        lifecycleNetworkDebugEnabled: lifecycleNetworkSummary.debugEnabled,
        lifecycleNetworkSummary,
        revealAudience,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        requestFailureSummary,
        resultingObjectState,
        remoteImageUrl: preparedMedia.remoteImageUrl,
        runId: runContext.runId,
        screenshotPath,
        sendToContactsClicked,
        selectedContactCountAfter,
        selectedContactCountBefore,
        selectedContactIdentityVerified,
        selectedContactSelection,
        selectedContactTarget,
        selectedMedia,
        selectedUsLocation: {
          address: location.address,
          key: location.key,
          label: location.label,
          lat: location.lat,
          lng: location.lng,
          marketRegion: location.marketRegion
        },
        shareDecisionStepReached,
        skipContactsClicked,
        stepButtonSnapshots,
        subject: seed.subject,
        successSignals: [...successSignals],
        testOutputDir: testInfo.outputDir,
        uploadedFileName: preparedMedia.fileName,
        uploadedFileSize: preparedMedia.sizeBytes,
        url: configuredUrl,
        visibleSuccessText,
        warningNetworkIssues,
        writesObserved: networkMonitor.observations
      };

      await writeInssaLifecycleArtifactJson(artifactFileName, artifact);
      await testInfo.attach("inssa-live-media-capsule-artifact.json", {
        body: JSON.stringify(artifact, null, 2),
        contentType: "application/json"
      });
    }
  });
});

function maskEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  if (!local || !domain) {
    return email;
  }

  const safeLocal = local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function hasMediaUploadEvidence(evidence: InssaMediaAttachmentEvidence | null): boolean {
  return Boolean(
    evidence?.inputFileCount ||
      evidence?.selectedSummaryCount ||
      evidence?.previewVisible ||
      evidence?.imagePreviewVisible ||
      evidence?.mediaPreviewVisible
  );
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

async function prepareMediaAttachment(
  testInfo: Parameters<typeof test>[0] extends never ? never : any,
  runId: string,
  mediaCapabilities: InssaMediaStepCapabilities
): Promise<PreparedMediaAttachment> {
  if (REMOTE_IMAGE_ENABLED) {
    if (!REMOTE_IMAGE_URL) {
      throw new Error(`Expected ${INSSA_REMOTE_IMAGE_URL_ENV} to be set when ${INSSA_REMOTE_IMAGE_TESTS_ENV_FLAG}=1.`);
    }

    if (mediaCapabilities.hasRemoteImageUrlInput) {
      await validateRemoteImageUrl(REMOTE_IMAGE_URL);
      return {
        fileName: null,
        filePath: null,
        mediaMode: "remote-url-input",
        remoteImageUrl: REMOTE_IMAGE_URL,
        sizeBytes: null
      };
    }

    return await downloadRemoteImageToFixture(testInfo, runId, REMOTE_IMAGE_URL);
  }

  const existingFixture = await findExistingImageFixture();
  if (existingFixture) {
    const stat = await fs.stat(existingFixture);
    return {
      fileName: path.basename(existingFixture),
      filePath: existingFixture,
      mediaMode: "existing-local-fixture",
      remoteImageUrl: null,
      sizeBytes: stat.size
    };
  }

  return await createGeneratedPngFixture(testInfo, runId);
}

async function findExistingImageFixture(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "tests", "fixtures", "inssa-live-media.png"),
    path.resolve(process.cwd(), "tests", "fixtures", "inssa-live-media.jpg"),
    path.resolve(process.cwd(), "tests", "fixtures", "inssa-live-media.jpeg")
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function createGeneratedPngFixture(testInfo: any, runId: string): Promise<PreparedMediaAttachment> {
  const filePath = testInfo.outputPath(`inssa-live-media-${runId}.png`);
  const buffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sM+y3QAAAAASUVORK5CYII=",
    "base64"
  );
  await fs.writeFile(filePath, buffer);

  return {
    fileName: path.basename(filePath),
    filePath,
    mediaMode: "generated-local-fixture",
    remoteImageUrl: null,
    sizeBytes: buffer.byteLength
  };
}

async function downloadRemoteImageToFixture(testInfo: any, runId: string, remoteUrl: string): Promise<PreparedMediaAttachment> {
  await validateRemoteImageUrl(remoteUrl);
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Remote image fetch failed for ${remoteUrl} with HTTP ${response.status}.`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!/^image\/(?:png|jpeg)$/.test(contentType)) {
    throw new Error(`Remote image content-type must be image/png or image/jpeg. Received "${contentType || "unknown"}".`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error(
      `Remote image exceeds the ${MAX_REMOTE_IMAGE_BYTES} byte safety limit: received ${buffer.byteLength} bytes.`
    );
  }

  const extension = contentType === "image/png" ? ".png" : ".jpg";
  const filePath = testInfo.outputPath(`inssa-live-media-${runId}${extension}`);
  await fs.writeFile(filePath, buffer);

  return {
    fileName: path.basename(filePath),
    filePath,
    mediaMode: "downloaded-remote-image",
    remoteImageUrl: remoteUrl,
    sizeBytes: buffer.byteLength
  };
}

async function validateRemoteImageUrl(remoteUrl: string): Promise<void> {
  const parsed = new URL(remoteUrl);
  if (parsed.protocol !== "https:") {
    throw new Error(`Remote image URL must use HTTPS. Received "${parsed.protocol}".`);
  }
}
