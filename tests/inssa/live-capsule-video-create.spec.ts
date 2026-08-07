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
  buildInssaQaLiveVideoCapsuleSeed,
  createInssaMutationRunContext,
  INSSA_LIVE_CAPSULE_ENV_FLAG,
  INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG,
  INSSA_TEST_VIDEO_FIXTURE_PATH_ENV,
  INSSA_US_MARKET_LOCATION_ENV_FLAG,
  INSSA_VIDEO_CAPSULE_ENV_FLAG
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
const VIDEO_TEST_ENABLED = process.env[INSSA_VIDEO_CAPSULE_ENV_FLAG] === "1";
const SELECTED_LOCATION_KEY = process.env[INSSA_US_MARKET_LOCATION_ENV_FLAG]?.trim().toLowerCase() ?? "";
const STAGING_HOSTNAME = "staging.inssa.us";
const STATIC_VIDEO_FIXTURE_PATH = path.resolve(process.cwd(), "tests", "fixtures", "media", "sample-video.mp4");
const MAX_VIDEO_BYTES = 2 * 1024 * 1024;
const APPROVED_CONTACT_EMAIL = "test2@gmail.com";

type VideoMode = "existing-local-fixture" | "env-local-fixture";

type PreparedVideoAttachment = {
  fileName: string;
  filePath: string;
  mediaMode: VideoMode;
  sizeBytes: number;
};

type LiveVideoCapsuleArtifact = {
  artifactStateNote: string | null;
  buryClicked: boolean;
  cleanupIdentityStatus: InssaCleanupIdentityStatus;
  cleanupInvestigationRequired: boolean;
  cleanupInstruction: string;
  createdAt: string;
  draftIdBeforeCreate: string | null;
  environment: "staging";
  fatalNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[];
  finalActionClicked: boolean;
  finalActionContext: {
    campaign: "video";
    currentStep: string;
    currentUrl: string;
    fixtureType: "video";
    selectedCount: number;
    selectedRecipient: string;
  } | null;
  finalActionLabel: string | null;
  finalShareActionClicked: boolean;
  finalizationPersistenceResponseStatuses: number[];
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalShareLink: string | null;
  finalUrl: string;
  lifecycleClassification: InssaLifecyclePersistenceClassification;
  lifecycleSucceededDespiteWarnings: boolean;
  lifecycleNetworkDebugEnabled: boolean;
  lifecycleNetworkSummary: InssaLifecycleNetworkSummary;
  maskedTestEmail: string;
  mediaCapabilities: InssaMediaStepCapabilities;
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
  revealAudience: "personal-memory" | "shared-capsule" | null;
  revealSettingsContinueClicked: boolean;
  revealSettingsFollowupClickedLabel: string | null;
  revealSettingsOpened: boolean;
  revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[];
  revealTiming: "reveal-later" | "reveal-now" | null;
  requestFailureSummary: InssaLifecycleRequestFailureSummary;
  resultingObjectState: "shared-contact-finalized" | null;
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
  uploadedFileName: string;
  uploadedFileSize: number;
  url: string;
  videoAttachmentEvidence: InssaMediaAttachmentEvidence | null;
  videoMode: VideoMode | null;
  mediaType: "video";
  visibleSuccessText: string | null;
  warningNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[];
  writesObserved: InssaLifecycleNetworkObservation[];
};

test.describe("INSSA live video capsule create", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!LIVE_TEST_ENABLED, `Requires ${INSSA_LIVE_CAPSULE_ENV_FLAG}=1 for staging live capsule tests.`);
  test.skip(
    !MANUAL_CLEANUP_APPROVED,
    `Requires ${INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG}=1 because video live capsules require manual cleanup.`
  );
  test.skip(!VIDEO_TEST_ENABLED, `Requires ${INSSA_VIDEO_CAPSULE_ENV_FLAG}=1 for live video capsule creation.`);
  test.skip(
    !SELECTED_LOCATION_KEY,
    `Requires ${INSSA_US_MARKET_LOCATION_ENV_FLAG}=<nyc|los-angeles|chicago|miami|austin|seattle> for single-location live video publishing.`
  );
  test.setTimeout(360_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();
    getInssaTestCredentials();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA live video capsule testing is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("creates one QA-tagged video live capsule on staging and emits manual cleanup evidence", async (
    { page },
    testInfo
  ) => {
    test.slow();
    testInfo.annotations.push({
      type: "warning",
      description:
        "Creates one staging live video capsule. Run with --workers=1 --retries=0 and coordinate manual cleanup."
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
    const seed = buildInssaQaLiveVideoCapsuleSeed(runContext);
    const composeRoute = buildInssaComposeRouteForLocation(location);
    const composeTemplateDefaults = getInssaComposeTemplateDefaults(composeRoute);
    const screenshotFileName = `${runContext.runId}-video.png`;
    const postContinueScreenshotFileName = `${runContext.runId}-video-post-continue.png`;
    const preContactSelectionScreenshotFileName = `${runContext.runId}-video-contact-before-selection.png`;
    const selectedContactScreenshotFileName = `${runContext.runId}-video-contact-selected.png`;
    const postFinalizationScreenshotFileName = `${runContext.runId}-video-post-finalization.png`;
    const artifactFileName = `${runContext.runId}-video.json`;
    const screenshotPath = getInssaLifecycleArtifactPath(screenshotFileName);
    const postContinueScreenshotPath = getInssaLifecycleArtifactPath(postContinueScreenshotFileName);
    const preContactSelectionScreenshotPath = getInssaLifecycleArtifactPath(preContactSelectionScreenshotFileName);
    const selectedContactScreenshotPath = getInssaLifecycleArtifactPath(selectedContactScreenshotFileName);
    const postFinalizationScreenshotPath = getInssaLifecycleArtifactPath(postFinalizationScreenshotFileName);
    const possibleDocumentIds = new Set<string>();
    const stepButtonSnapshots: InssaComposeStepSnapshot[] = [];
    const revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[] = [];
    const successSignals = new Set<string>();
    let artifactStateNote: string | null = null;
    let buryClicked = false;
    let draftIdBeforeCreate: string | null = null;
    let finalActionClicked = false;
    let finalActionContext: LiveVideoCapsuleArtifact["finalActionContext"] = null;
    let finalActionLabel: string | null = null;
    let finalShareActionClicked = false;
    let finalizationPersistenceResponseStatuses: number[] = [];
    let finalShareEvidence: InssaLiveCapsuleShareEvidence | null = null;
    let finalShareLink: string | null = null;
    let finalUrl = "";
    let mediaCapabilities: InssaMediaStepCapabilities | null = null;
    let observedCreateSuccess = false;
    let phase: InssaLifecycleNetworkPhase = "pre-create";
    let possibleFinalCapsuleId: string | null = null;
    let possibleShareToken: string | null = null;
    let postCreateVisibleControls = {
      archiveCapsule: false,
      deleteCapsule: false,
      editCapsule: false,
      hideCapsule: false
    };
    const preparedVideoRef: { current: PreparedVideoAttachment | null } = { current: null };
    let revealAudience: "personal-memory" | "shared-capsule" | null = null;
    let revealSettingsContinueClicked = false;
    let revealSettingsFollowupClickedLabel: string | null = null;
    let revealSettingsOpened = false;
    let revealTiming: "reveal-later" | "reveal-now" | null = null;
    let sendToContactsClicked = false;
    let selectedContactCountAfter: number | null = null;
    let selectedContactCountBefore: number | null = null;
    let selectedContactIdentityVerified = false;
    let selectedContactSelection: InssaExactContactSelection | null = null;
    let selectedContactTarget: string | null = null;
    let shareDecisionStepReached = false;
    let skipContactsClicked = false;
    let selectedMedia: InssaMediaSelectionSnapshot = { count: 0, names: [] };
    let videoAttachmentEvidence: InssaMediaAttachmentEvidence | null = null;
    let visibleSuccessText: string | null = null;
    let fatalNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[] = [];
    let warningNetworkIssues: ClassifiedInssaLifecycleNetworkIssue[] = [];
    let requestFailureSummary: InssaLifecycleRequestFailureSummary = summarizeInssaLifecycleNetworkIssues([]);
    let lifecycleSucceededDespiteWarnings = false;
    let resultingObjectState: "shared-contact-finalized" | null = null;

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

        await monitor.step("assert compose surface before video creation", async () => {
          await compose.expectComposeSurface();
          await compose.expectRequiredFieldMetadata();
        }, { phase: "assertion" });

        await monitor.step("fill unique QA-tagged live video content", async () => {
          await compose.fillComposeFields(seed);
          await compose.expectComposeValues(seed);

          const draftStorage = await compose.readClientDraftStorage({
            pathname: new URL(page.url()).pathname,
            qaMarker: seed.subject,
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

        await monitor.step("reach Media step before video upload", async () => {
          stepButtonSnapshots.push(await compose.snapshotComposeStepState());
          await compose.advanceToMediaStep();
          await compose.expectMediaStep();
          stepButtonSnapshots.push(await compose.snapshotComposeStepState());
        }, { phase: "interaction" });

        await monitor.step("inspect media capabilities and attach one video only", async () => {
          mediaCapabilities = await compose.inspectMediaStepCapabilities();
          expect(
            mediaCapabilities.hasVideoOption,
            `Expected Media step to expose a Video option before running live video upload. Capabilities: ${JSON.stringify(
              mediaCapabilities
            )}`
          ).toBe(true);

          await compose.selectVideoMediaMode();
          preparedVideoRef.current = await prepareVideoAttachment();
          await compose.attachSingleMediaFile(preparedVideoRef.current.filePath);

          selectedMedia = await compose.readSelectedMediaFiles();
          videoAttachmentEvidence = await compose.readMediaAttachmentEvidence();
          expect(
            selectedMedia.count === 1 ||
              videoAttachmentEvidence.selectedSummaryCount === 1 ||
              videoAttachmentEvidence.selectedVideoCount === 1 ||
              videoAttachmentEvidence.videoPreviewVisible ||
              videoAttachmentEvidence.mediaPreviewVisible,
            `Expected visible Media-step evidence for exactly one attached video before publishing. inputCount=${
              selectedMedia.count
            }, selectedSummary="${videoAttachmentEvidence.selectedSummaryText ?? "none"}", selectedVideoCount=${
              videoAttachmentEvidence.selectedVideoCount ?? "unknown"
            }, videoPreviewVisible=${videoAttachmentEvidence.videoPreviewVisible}, mediaPreviewVisible=${
              videoAttachmentEvidence.mediaPreviewVisible
            }`
          ).toBeTruthy();

          if (await compose.dismissVideoRecorderModalIfVisible()) {
            successSignals.add("video-recorder-modal-dismissed");
            videoAttachmentEvidence = await compose.readMediaAttachmentEvidence();
            expect(
              videoAttachmentEvidence.selectedSummaryCount === 1 ||
                videoAttachmentEvidence.selectedVideoCount === 1 ||
                videoAttachmentEvidence.videoPreviewVisible ||
                videoAttachmentEvidence.mediaPreviewVisible,
              `Expected one attached video to remain after closing the Record Video overlay. selectedSummary="${
                videoAttachmentEvidence.selectedSummaryText ?? "none"
              }", selectedVideoCount=${
                videoAttachmentEvidence.selectedVideoCount ?? "unknown"
              }, videoPreviewVisible=${videoAttachmentEvidence.videoPreviewVisible}, mediaPreviewVisible=${
                videoAttachmentEvidence.mediaPreviewVisible
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

        await monitor.step("select the exact approved video recipient", async () => {
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

        await monitor.step("finalize video contact share exactly once and capture identity", async () => {
          const selectedSnapshot = await compose.snapshotRevealSettingsModal();
          finalActionContext = {
            campaign: "video",
            currentStep: selectedSnapshot.selectedContactsStepLabel ?? selectedSnapshot.stepLabel ?? "Step 2 of 2",
            currentUrl: page.url(),
            fixtureType: "video",
            selectedCount: selectedSnapshot.selectedContactsCount ?? -1,
            selectedRecipient: selectedContactTarget ?? maskEmail(APPROVED_CONTACT_EMAIL)
          };
          expect(finalActionContext.selectedCount, "Final video action requires exactly one selected contact.").toBe(1);

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
            "Expected the single final video contact-share action to receive a successful persistence response."
          ).toBeGreaterThan(0);
          possibleFinalCapsuleId = possibleFinalCapsuleId ?? postFinalizationNetwork.possibleCapsuleIds[0] ?? null;
          if (!possibleFinalCapsuleId) {
            throw new Error(
              "failed_cleanup_identity: video persistence/finalization succeeded but no capsule ID was captured. Cleanup Investigation Required; automatic retry is forbidden."
            );
          }
          possibleDocumentIds.add(possibleFinalCapsuleId);
          resultingObjectState = "shared-contact-finalized";
          expect(
            hasVideoUploadEvidence(videoAttachmentEvidence, preparedVideoRef.current),
            "Expected video media association evidence after finalization."
          ).toBe(true);
          expect(preparedVideoRef.current?.fileName, "Expected the approved MP4 fixture filename to remain associated with the run.").toBe(
            "sample-video.mp4"
          );
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
            `Expected the live video capsule test to observe creation success evidence. Final URL: ${
              finalUrl || page.url()
            }. Signals: ${[...successSignals].join(", ")}`
          ).toBe(true);
        }, { phase: "assertion" });

        await monitor.step("assert no unexpected INSSA errors", async () => {
          const lifecycleRequestContext = buildLifecycleRequestFailureContext({
            finalShareEvidence,
            finalShareLink,
            lifecycleStage: "video-live-create",
            observedCreateSuccess,
            possibleFinalCapsuleId,
            possibleShareToken,
            revealSettingsContinueClicked,
            uploadSucceeded: hasVideoUploadEvidence(videoAttachmentEvidence, preparedVideoRef.current)
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
        lifecycleStage: "video-live-create",
        observedCreateSuccess,
        possibleFinalCapsuleId,
        possibleShareToken,
        revealSettingsContinueClicked,
        uploadSucceeded: hasVideoUploadEvidence(videoAttachmentEvidence, preparedVideoRef.current)
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
        artifactStateNote = "Bury was not clicked. Only a draft-side video artifact may exist on staging.";
      } else if (buryClicked && !revealSettingsContinueClicked) {
        artifactStateNote =
          "Bury was clicked and Reveal settings opened, but finalization was not continued. A live video capsule may or may not exist on staging.";
      } else if (revealSettingsContinueClicked) {
        artifactStateNote = cleanupInvestigationRequired
          ? "Cleanup Investigation Required: video persistence was observed but the capsule ID was not captured. Do not retry the final action."
          : observedCreateSuccess
          ? "Live video capsule finalization was attempted; verify staging before rerun. Share-link evidence was observed and manual cleanup is required."
          : "Live video capsule finalization was attempted; verify staging before rerun.";
      }

      if (possibleFinalCapsuleId && resultingObjectState) {
        assertInssaCleanupOwnership({
          capsuleId: possibleFinalCapsuleId,
          cleanupInstruction: `Delete the QA staging video capsule ${possibleFinalCapsuleId} and associated MP4 after verification.`,
          objectType: "timeCapsule",
          owner: maskedTestEmail,
          resultingState: resultingObjectState
        });
      }

      const artifact: LiveVideoCapsuleArtifact = {
        artifactStateNote,
        buryClicked,
        cleanupIdentityStatus,
        cleanupInvestigationRequired,
        cleanupInstruction: cleanupInvestigationRequired
          ? "Cleanup Investigation Required. Identify the exact staging video capsule before another mutation run; do not retry the final action."
          : `Delete the QA staging video capsule ${possibleFinalCapsuleId ?? "identified by this run's evidence"} and associated MP4 after verification.`,
        createdAt: seed.createdAtIso,
        draftIdBeforeCreate,
        environment: "staging",
        fatalNetworkIssues,
        finalActionClicked,
        finalActionContext,
        finalActionLabel,
        finalShareActionClicked,
        finalizationPersistenceResponseStatuses,
        finalShareEvidence,
        finalShareLink,
        finalUrl: finalUrl || page.url(),
        lifecycleClassification,
        lifecycleSucceededDespiteWarnings,
        lifecycleNetworkDebugEnabled: lifecycleNetworkSummary.debugEnabled,
        lifecycleNetworkSummary,
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
        message: seed.message,
        mediaType: "video",
        observedCreateSuccess,
        possibleDocumentIds: [...possibleDocumentIds],
        possibleFinalCapsuleId,
        possibleShareToken,
        postContinueScreenshotPath: revealSettingsContinueClicked ? postContinueScreenshotPath : null,
        preContactSelectionScreenshotPath: revealSettingsContinueClicked ? preContactSelectionScreenshotPath : null,
        selectedContactScreenshotPath: selectedContactSelection ? selectedContactScreenshotPath : null,
        postFinalizationScreenshotPath: finalShareActionClicked ? postFinalizationScreenshotPath : null,
        postCreateVisibleControls,
        revealAudience,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        requestFailureSummary,
        resultingObjectState,
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
        uploadedFileName: preparedVideoRef.current?.fileName ?? "",
        uploadedFileSize: preparedVideoRef.current?.sizeBytes ?? 0,
        url: configuredUrl,
        videoAttachmentEvidence,
        videoMode: preparedVideoRef.current?.mediaMode ?? null,
        visibleSuccessText,
        warningNetworkIssues,
        writesObserved: networkMonitor.observations
      };

      await writeInssaLifecycleArtifactJson(artifactFileName, artifact);
      await testInfo.attach("inssa-live-video-capsule-artifact.json", {
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

function hasVideoUploadEvidence(
  evidence: InssaMediaAttachmentEvidence | null,
  preparedVideo: PreparedVideoAttachment | null
): boolean {
  return Boolean(
    preparedVideo?.fileName ||
      evidence?.inputFileCount ||
      evidence?.selectedSummaryCount ||
      evidence?.selectedVideoCount ||
      evidence?.videoPreviewVisible ||
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

async function prepareVideoAttachment(): Promise<PreparedVideoAttachment> {
  const envFixture = process.env[INSSA_TEST_VIDEO_FIXTURE_PATH_ENV]?.trim();
  if (envFixture) {
    return await validateVideoFixture(path.resolve(envFixture), "env-local-fixture");
  }

  if (await fileExists(STATIC_VIDEO_FIXTURE_PATH)) {
    return await validateVideoFixture(STATIC_VIDEO_FIXTURE_PATH, "existing-local-fixture");
  }

  throw new Error(
    `Missing INSSA static video fixture: "${STATIC_VIDEO_FIXTURE_PATH}". Add a tiny deterministic MP4 there or set ${INSSA_TEST_VIDEO_FIXTURE_PATH_ENV}=<small-mp4-file>.`
  );
}

async function validateVideoFixture(filePath: string, mediaMode: VideoMode): Promise<PreparedVideoAttachment> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".mp4") {
    throw new Error(`INSSA video fixture must be a static .mp4 file. Received "${filePath}".`);
  }

  const stat = await fs.stat(filePath);
  if (stat.size <= 0) {
    throw new Error(`INSSA video fixture is empty: "${filePath}".`);
  }

  if (stat.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `INSSA video fixture exceeds the ${MAX_VIDEO_BYTES} byte safety limit: "${filePath}" is ${stat.size} bytes.`
    );
  }

  return {
    fileName: path.basename(filePath),
    filePath,
    mediaMode,
    sizeBytes: stat.size
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
