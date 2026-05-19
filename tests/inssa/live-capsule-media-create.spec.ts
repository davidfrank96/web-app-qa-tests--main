import { promises as fs } from "fs";
import path from "path";
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

const DEFAULT_TIMEOUT = 25_000;
const LIVE_TEST_ENABLED = process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] === "1";
const MANUAL_CLEANUP_APPROVED = process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] === "1";
const MEDIA_TEST_ENABLED = process.env[INSSA_MEDIA_CAPSULE_ENV_FLAG] === "1";
const REMOTE_IMAGE_ENABLED = process.env[INSSA_REMOTE_IMAGE_TESTS_ENV_FLAG] === "1";
const REMOTE_IMAGE_URL = process.env[INSSA_REMOTE_IMAGE_URL_ENV]?.trim() ?? "";
const SELECTED_LOCATION_KEY = process.env[INSSA_US_MARKET_LOCATION_ENV_FLAG]?.trim().toLowerCase() ?? "";
const STAGING_HOSTNAME = "staging.inssa.us";
const LIVE_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
const MAX_REMOTE_IMAGE_BYTES = 2 * 1024 * 1024;

type NetworkObservation = {
  method: string;
  phase: "bury-click" | "post-create" | "pre-create" | "reveal-continue";
  requestUrl: string;
  responseStatus?: number;
  resourceType: string;
};

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
  mediaAttachmentEvidence: InssaMediaAttachmentEvidence | null;
  cleanupInstruction: string;
  createdAt: string;
  draftIdBeforeCreate: string | null;
  environment: "staging";
  finalActionClicked: boolean;
  finalActionLabel: string | null;
  finalUrl: string;
  maskedTestEmail: string;
  mediaCapabilities: InssaMediaStepCapabilities;
  mediaMode: MediaMode;
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
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalShareLink: string | null;
  revealAudience: "personal-memory" | "shared-capsule" | null;
  revealSettingsContinueClicked: boolean;
  revealSettingsFollowupClickedLabel: string | null;
  revealSettingsOpened: boolean;
  revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[];
  revealTiming: "reveal-later" | "reveal-now" | null;
  remoteImageUrl: string | null;
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
  uploadedFileName: string | null;
  uploadedFileSize: number | null;
  url: string;
  visibleSuccessText: string | null;
  writesObserved: NetworkObservation[];
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
    const screenshotPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}.png`);
    const postContinueScreenshotPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}-post-continue.png`);
    const artifactPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}.json`);
    const writesObserved: NetworkObservation[] = [];
    const possibleDocumentIds = new Set<string>();
    const stepButtonSnapshots: InssaComposeStepSnapshot[] = [];
    const successSignals = new Set<string>();
    let phase: NetworkObservation["phase"] = "pre-create";
    let draftIdBeforeCreate: string | null = null;
    let finalActionLabel: string | null = null;
    let finalUrl = "";
    let finalShareEvidence: InssaLiveCapsuleShareEvidence | null = null;
    let finalShareLink: string | null = null;
    let possibleFinalCapsuleId: string | null = null;
    let possibleShareToken: string | null = null;
    let observedCreateSuccess = false;
    let visibleSuccessText: string | null = null;
    let finalActionClicked = false;
    let buryClicked = false;
    let revealSettingsOpened = false;
    let revealAudience: "personal-memory" | "shared-capsule" | null = null;
    let revealTiming: "reveal-later" | "reveal-now" | null = null;
    let revealSettingsContinueClicked = false;
    let revealSettingsFollowupClickedLabel: string | null = null;
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
    let postCreateVisibleControls = {
      archiveCapsule: false,
      deleteCapsule: false,
      editCapsule: false,
      hideCapsule: false
    };

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
        /firestore|timecapsule|messages|capsule|cloudfunctions|documents/i.test(url);

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
        /firestore|timecapsule|messages|capsule|cloudfunctions|documents/i.test(url);

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
          await fs.mkdir(LIVE_ARTIFACT_DIR, { recursive: true });
          await page.screenshot({ fullPage: true, path: postContinueScreenshotPath }).catch(() => {});
        }, { phase: "interaction" });

        await monitor.step("wait for final media share-link evidence", async () => {
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
            `Expected the live media capsule test to observe creation success evidence. Final URL: ${
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
        artifactStateNote = "Bury was not clicked. Only a draft-side media artifact may exist on staging.";
      } else if (buryClicked && !revealSettingsContinueClicked) {
        artifactStateNote =
          "Bury was clicked and Reveal settings opened, but finalization was not continued. A live media capsule may or may not exist on staging.";
      } else if (revealSettingsContinueClicked) {
        artifactStateNote = observedCreateSuccess
          ? "Live media capsule finalization was attempted; verify staging before rerun. Share-link evidence was observed and manual cleanup is required."
          : "Live media capsule finalization was attempted; verify staging before rerun.";
      }

      const artifact: LiveMediaCapsuleArtifact = {
        artifactStateNote,
        buryClicked,
        cleanupInstruction: "Development team should delete this QA live media capsule from staging after verification.",
        createdAt: seed.createdAtIso,
        draftIdBeforeCreate,
        environment: "staging",
        finalActionClicked,
        finalActionLabel,
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
        message: seed.message,
        observedCreateSuccess,
        possibleDocumentIds: [...possibleDocumentIds],
        possibleFinalCapsuleId,
        possibleShareToken,
        postContinueScreenshotPath: revealSettingsContinueClicked ? postContinueScreenshotPath : null,
        postCreateVisibleControls,
        finalShareEvidence,
        finalShareLink,
        revealAudience,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        remoteImageUrl: preparedMedia.remoteImageUrl,
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
        uploadedFileName: preparedMedia.fileName,
        uploadedFileSize: preparedMedia.sizeBytes,
        url: configuredUrl,
        visibleSuccessText,
        writesObserved
      };

      await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
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
