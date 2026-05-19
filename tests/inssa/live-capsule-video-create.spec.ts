import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  InssaFinalLiveCreateStepError,
  type InssaComposeStepSnapshot,
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

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 25_000;
const LIVE_TEST_ENABLED = process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] === "1";
const MANUAL_CLEANUP_APPROVED = process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] === "1";
const VIDEO_TEST_ENABLED = process.env[INSSA_VIDEO_CAPSULE_ENV_FLAG] === "1";
const SELECTED_LOCATION_KEY = process.env[INSSA_US_MARKET_LOCATION_ENV_FLAG]?.trim().toLowerCase() ?? "";
const STAGING_HOSTNAME = "staging.inssa.us";
const LIVE_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;

type NetworkObservation = {
  method: string;
  phase: "bury-click" | "post-create" | "pre-create" | "reveal-continue";
  requestUrl: string;
  responseStatus?: number;
  resourceType: string;
};

type VideoMode = "existing-local-fixture" | "env-local-fixture" | "generated-playwright-ffmpeg-fixture";

type PreparedVideoAttachment = {
  fileName: string;
  filePath: string;
  mediaMode: VideoMode;
  sizeBytes: number;
};

type LiveVideoCapsuleArtifact = {
  artifactStateNote: string | null;
  buryClicked: boolean;
  cleanupInstruction: string;
  createdAt: string;
  draftIdBeforeCreate: string | null;
  environment: "staging";
  finalActionClicked: boolean;
  finalActionLabel: string | null;
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalShareLink: string | null;
  finalUrl: string;
  maskedTestEmail: string;
  mediaCapabilities: InssaMediaStepCapabilities;
  message: string;
  observedCreateSuccess: boolean;
  possibleDocumentIds: string[];
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  postContinueScreenshotPath: string | null;
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
  runId: string;
  screenshotPath: string | null;
  selectedMedia: InssaMediaSelectionSnapshot;
  selectedUsLocation: {
    address: string;
    key: string;
    label: string;
    lat: number;
    lng: number;
    marketRegion: string;
  };
  stepButtonSnapshots: InssaComposeStepSnapshot[];
  subject: string;
  successSignals: string[];
  testOutputDir: string;
  uploadedFileName: string;
  uploadedFileSize: number;
  url: string;
  videoAttachmentEvidence: InssaMediaAttachmentEvidence | null;
  videoMode: VideoMode | null;
  visibleSuccessText: string | null;
  writesObserved: NetworkObservation[];
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
    const screenshotPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}-video.png`);
    const postContinueScreenshotPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}-video-post-continue.png`);
    const artifactPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}-video.json`);
    const writesObserved: NetworkObservation[] = [];
    const possibleDocumentIds = new Set<string>();
    const stepButtonSnapshots: InssaComposeStepSnapshot[] = [];
    const revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[] = [];
    const successSignals = new Set<string>();
    let artifactStateNote: string | null = null;
    let buryClicked = false;
    let draftIdBeforeCreate: string | null = null;
    let finalActionClicked = false;
    let finalActionLabel: string | null = null;
    let finalShareEvidence: InssaLiveCapsuleShareEvidence | null = null;
    let finalShareLink: string | null = null;
    let finalUrl = "";
    let mediaCapabilities: InssaMediaStepCapabilities | null = null;
    let observedCreateSuccess = false;
    let phase: NetworkObservation["phase"] = "pre-create";
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
    let selectedMedia: InssaMediaSelectionSnapshot = { count: 0, names: [] };
    let videoAttachmentEvidence: InssaMediaAttachmentEvidence | null = null;
    let visibleSuccessText: string | null = null;

    const capturePossibleIds = (input: string | null | undefined) => {
      const text = input?.trim();
      if (!text) {
        return;
      }

      const addIfSafeId = (value: string | null | undefined) => {
        const candidate = value?.trim();
        if (!candidate) {
          return;
        }

        if (
          candidate.length > 64 ||
          candidate.includes(".") ||
          /^AIza/i.test(candidate) ||
          /^eyJ/i.test(candidate) ||
          /^AMf-/i.test(candidate)
        ) {
          return;
        }

        possibleDocumentIds.add(candidate);
      };

      const namedIdMatches = text.matchAll(/\b(?:capsuleId|draftId|id)["'=:\s]+([A-Za-z0-9_-]{8,64})/gi);
      for (const match of namedIdMatches) {
        addIfSafeId(match[1]);
      }

      const documentPathMatches = text.matchAll(/documents\/(?:[^/?#\s]+\/)*([A-Za-z0-9_-]{8,64})/gi);
      for (const match of documentPathMatches) {
        addIfSafeId(match[1]);
      }
    };

    page.on("request", (request) => {
      const url = request.url();
      const relevant =
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) ||
        /firestore|timecapsule|messages|capsule|cloudfunctions|documents|storage/i.test(url);

      if (!relevant) {
        return;
      }

      writesObserved.push({
        method: request.method(),
        phase,
        requestUrl: url,
        resourceType: request.resourceType()
      });
      capturePossibleIds(url);
      capturePossibleIds(request.postData());
    });

    page.on("response", (response) => {
      const url = response.url();
      const relevant =
        ["POST", "PUT", "PATCH", "DELETE"].includes(response.request().method()) ||
        /firestore|timecapsule|messages|capsule|cloudfunctions|documents|storage/i.test(url);

      if (!relevant) {
        return;
      }

      const existing = [...writesObserved]
        .reverse()
        .find(
          (entry) =>
            entry.requestUrl === url &&
            entry.method === response.request().method() &&
            entry.responseStatus === undefined
        );

      if (existing) {
        existing.responseStatus = response.status();
      } else {
        writesObserved.push({
          method: response.request().method(),
          phase,
          requestUrl: url,
          resourceType: response.request().resourceType(),
          responseStatus: response.status()
        });
      }

      capturePossibleIds(url);
    });

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
          preparedVideoRef.current = await prepareVideoAttachment(testInfo, runContext.runId);
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
          await fs.mkdir(LIVE_ARTIFACT_DIR, { recursive: true });
          await page.screenshot({ fullPage: true, path: postContinueScreenshotPath }).catch(() => {});
        }, { phase: "interaction" });

        await monitor.step("wait for final video share-link evidence", async () => {
          phase = "post-create";
          const outcome = await compose.waitForLiveCapsuleShareLinkEvidence();
          revealSettingsSnapshots.push(...outcome.revealSettingsSnapshots);
          revealSettingsFollowupClickedLabel = outcome.followupClickedLabel;
          finalShareEvidence = outcome.shareEvidence;
          if (revealSettingsFollowupClickedLabel) {
            successSignals.add(`reveal-followup=${revealSettingsFollowupClickedLabel}`);
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
          observedCreateSuccess =
            Boolean(finalShareLink) ||
            Boolean(possibleFinalCapsuleId) ||
            Boolean(possibleShareToken) ||
            Boolean(visibleSuccessText) ||
            outcome.shareEvidence.copyShareLinkVisible ||
            outcome.shareEvidence.shareLinkButtonVisible ||
            outcome.shareEvidence.homeVisible;
        }, { phase: "assertion" });

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

        await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
          phase: "assertion"
        });
      });
    } finally {
      await fs.mkdir(LIVE_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ fullPage: true, path: screenshotPath }).catch(() => {});
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

      if (!finalActionClicked) {
        artifactStateNote = "Bury was not clicked. Only a draft-side video artifact may exist on staging.";
      } else if (buryClicked && !revealSettingsContinueClicked) {
        artifactStateNote =
          "Bury was clicked and Reveal settings opened, but finalization was not continued. A live video capsule may or may not exist on staging.";
      } else if (revealSettingsContinueClicked) {
        artifactStateNote = observedCreateSuccess
          ? "Live video capsule finalization was attempted; verify staging before rerun. Share-link evidence was observed and manual cleanup is required."
          : "Live video capsule finalization was attempted; verify staging before rerun.";
      }

      const artifact: LiveVideoCapsuleArtifact = {
        artifactStateNote,
        buryClicked,
        cleanupInstruction: "Development team should delete this QA live video capsule from staging after verification.",
        createdAt: seed.createdAtIso,
        draftIdBeforeCreate,
        environment: "staging",
        finalActionClicked,
        finalActionLabel,
        finalShareEvidence,
        finalShareLink,
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
        message: seed.message,
        observedCreateSuccess,
        possibleDocumentIds: [...possibleDocumentIds],
        possibleFinalCapsuleId,
        possibleShareToken,
        postContinueScreenshotPath: revealSettingsContinueClicked ? postContinueScreenshotPath : null,
        postCreateVisibleControls,
        revealAudience,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        runId: runContext.runId,
        screenshotPath,
        selectedMedia,
        selectedUsLocation: {
          address: location.address,
          key: location.key,
          label: location.label,
          lat: location.lat,
          lng: location.lng,
          marketRegion: location.marketRegion
        },
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
        writesObserved
      };

      await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
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

async function prepareVideoAttachment(testInfo: TestInfo, runId: string): Promise<PreparedVideoAttachment> {
  const envFixture = process.env[INSSA_TEST_VIDEO_FIXTURE_PATH_ENV]?.trim();
  if (envFixture) {
    return await validateVideoFixture(path.resolve(envFixture), "env-local-fixture");
  }

  const existingFixture = await findExistingVideoFixture();
  if (existingFixture) {
    return await validateVideoFixture(existingFixture, "existing-local-fixture");
  }

  return await createGeneratedVideoFixture(testInfo, runId);
}

async function findExistingVideoFixture(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "tests", "fixtures", "inssa-live-video.mp4"),
    path.resolve(process.cwd(), "tests", "fixtures", "inssa-live-video.webm"),
    path.resolve(process.cwd(), "tests", "fixtures", "inssa-live-video.mov"),
    path.resolve(process.cwd(), "tests", "fixtures", "inssa-live-video.m4v")
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

async function validateVideoFixture(filePath: string, mediaMode: VideoMode): Promise<PreparedVideoAttachment> {
  const extension = path.extname(filePath).toLowerCase();
  if (![".mp4", ".webm", ".mov", ".m4v"].includes(extension)) {
    throw new Error(`INSSA video fixture must be .mp4, .webm, .mov, or .m4v. Received "${filePath}".`);
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

async function createGeneratedVideoFixture(testInfo: TestInfo, runId: string): Promise<PreparedVideoAttachment> {
  const ffmpegPath = await findPlaywrightFfmpegExecutable();
  if (!ffmpegPath) {
    throw new Error(
      `No video fixture was found and Playwright ffmpeg was not available. Provide ${INSSA_TEST_VIDEO_FIXTURE_PATH_ENV}=<small-video-file>.`
    );
  }

  const filePath = testInfo.outputPath(`inssa-live-video-${runId}.mp4`);
  const commandAttempts = [
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=15:duration=1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      filePath
    ],
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=15:duration=1",
      "-an",
      "-c:v",
      "mpeg4",
      "-t",
      "1",
      filePath
    ]
  ];
  const errors: string[] = [];

  for (const args of commandAttempts) {
    try {
      await execFileAsync(ffmpegPath, args, { timeout: 30_000 });
      return await validateVideoFixture(filePath, "generated-playwright-ffmpeg-fixture");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Unable to generate deterministic INSSA video fixture with ${ffmpegPath}: ${errors.join(" | ")}`);
}

async function findPlaywrightFfmpegExecutable(): Promise<string | null> {
  const directCandidate = process.env.PLAYWRIGHT_FFMPEG_PATH?.trim();
  if (directCandidate && (await fileExists(directCandidate))) {
    return directCandidate;
  }

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
      ? process.env.PLAYWRIGHT_BROWSERS_PATH
      : "",
    path.resolve(process.cwd(), "node_modules", "playwright-core", ".local-browsers"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : ""
  ].filter(Boolean);

  for (const root of roots) {
    const executable = await findFfmpegInRoot(root);
    if (executable) {
      return executable;
    }
  }

  return null;
}

async function findFfmpegInRoot(root: string): Promise<string | null> {
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })) as Array<{ isDirectory(): boolean; name: string }>;
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("ffmpeg-")) {
      continue;
    }

    const candidates = [
      path.join(root, entry.name, "ffmpeg-mac"),
      path.join(root, entry.name, "ffmpeg-linux"),
      path.join(root, entry.name, "ffmpeg-win64.exe"),
      path.join(root, entry.name, "ffmpeg.exe")
    ];

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
