import { promises as fs } from "fs";
import path from "path";
import { expect, test } from "./fixtures";
import {
  InssaFinalLiveCreateStepError,
  type InssaComposeStepSnapshot,
  type InssaLiveCapsuleShareEvidence,
  type InssaRevealLaterScheduleEvidence,
  type InssaRevealSettingsModalSnapshot,
  TimeCapsulePage
} from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  INSSA_DEFAULT_COMPOSE_ROUTE,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN
} from "../../utils/inssa-test-data";
import {
  buildInssaQaRevealLaterCapsuleSeed,
  createInssaMutationRunContext,
  INSSA_LIVE_CAPSULE_ENV_FLAG,
  INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG,
  INSSA_REVEAL_LATER_CAPSULE_ENV_FLAG
} from "../../utils/inssa-mutation";
import { withInssaStabilityMonitor } from "../../utils/monitor";

const DEFAULT_TIMEOUT = 20_000;
const LIVE_TEST_ENABLED = process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] === "1";
const MANUAL_CLEANUP_APPROVED = process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] === "1";
const REVEAL_LATER_TEST_ENABLED = process.env[INSSA_REVEAL_LATER_CAPSULE_ENV_FLAG] === "1";
const STAGING_HOSTNAME = "staging.inssa.us";
const LIVE_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");

type NetworkObservation = {
  method: string;
  phase: "bury-click" | "post-create" | "pre-create" | "reveal-continue";
  requestUrl: string;
  responseStatus?: number;
  resourceType: string;
};

type RevealLaterCapsuleArtifact = {
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
  message: string;
  observedCreateSuccess: boolean;
  possibleDocumentIds: string[];
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  postContinueScreenshotPath: string | null;
  revealAudience: "personal-memory" | "shared-capsule" | null;
  revealLaterSchedule: InssaRevealLaterScheduleEvidence | null;
  revealSettingsContinueClicked: boolean;
  revealSettingsFollowupClickedLabel: string | null;
  revealSettingsOpened: boolean;
  revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[];
  revealTiming: "reveal-later" | "reveal-now" | null;
  runId: string;
  screenshotPath: string | null;
  stepButtonSnapshots: InssaComposeStepSnapshot[];
  subject: string;
  successSignals: string[];
  testOutputDir: string;
  url: string;
  visibleSuccessText: string | null;
  writesObserved: NetworkObservation[];
};

test.describe("INSSA live reveal-later capsule create", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!LIVE_TEST_ENABLED, `Requires ${INSSA_LIVE_CAPSULE_ENV_FLAG}=1 for staging live capsule tests.`);
  test.skip(
    !MANUAL_CLEANUP_APPROVED,
    `Requires ${INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG}=1 because staging live capsules require manual cleanup.`
  );
  test.skip(!REVEAL_LATER_TEST_ENABLED, `Requires ${INSSA_REVEAL_LATER_CAPSULE_ENV_FLAG}=1 for reveal-later capsule creation.`);
  test.setTimeout(300_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();
    getInssaTestCredentials();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA reveal-later capsule testing is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("creates one QA-tagged reveal-later live capsule on staging and emits manual cleanup evidence", async (
    { page },
    testInfo
  ) => {
    test.slow();
    testInfo.annotations.push({
      type: "warning",
      description:
        "Creates one staging reveal-later live capsule. Run with --workers=1 --retries=0 and coordinate manual cleanup."
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
    const seed = buildInssaQaRevealLaterCapsuleSeed(runContext);
    const composePathname = new URL(INSSA_DEFAULT_COMPOSE_ROUTE, configuredUrl).pathname;
    const screenshotPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}-reveal-later.png`);
    const postContinueScreenshotPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}-reveal-later-post-continue.png`);
    const artifactPath = path.join(LIVE_ARTIFACT_DIR, `${runContext.runId}-reveal-later.json`);
    const writesObserved: NetworkObservation[] = [];
    const possibleDocumentIds = new Set<string>();
    const stepButtonSnapshots: InssaComposeStepSnapshot[] = [];
    const revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[] = [];
    const successSignals = new Set<string>();
    let phase: NetworkObservation["phase"] = "pre-create";
    let artifactStateNote: string | null = null;
    let buryClicked = false;
    let draftIdBeforeCreate: string | null = null;
    let finalActionClicked = false;
    let finalActionLabel: string | null = null;
    let finalShareEvidence: InssaLiveCapsuleShareEvidence | null = null;
    let finalShareLink: string | null = null;
    let finalUrl = "";
    let observedCreateSuccess = false;
    let possibleFinalCapsuleId: string | null = null;
    let possibleShareToken: string | null = null;
    let revealAudience: "personal-memory" | "shared-capsule" | null = null;
    let revealLaterSchedule: InssaRevealLaterScheduleEvidence | null = null;
    let revealSettingsContinueClicked = false;
    let revealSettingsFollowupClickedLabel: string | null = null;
    let revealSettingsOpened = false;
    let revealTiming: "reveal-later" | "reveal-now" | null = null;
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
              message: "Expected the reveal-later capsule test to remain on the compose route before creation."
            })
            .toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);
        }, { phase: "assertion" });

        await monitor.step("fill unique QA-tagged reveal-later capsule content", async () => {
          await compose.fillComposeFields(seed);
          await compose.expectComposeValues(seed);

          const draftStorage = await compose.readClientDraftStorage({
            pathname: composePathname,
            qaMarker: seed.subject,
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

        await monitor.step("advance safely until Bury is visible on the Share step", async () => {
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

        await monitor.step("choose Shared capsule and Reveal later", async () => {
          const selection = await compose.chooseRevealSettingsForQaRevealLaterCapsule();
          revealAudience = selection.revealAudience;
          revealTiming = selection.revealTiming;
          revealLaterSchedule = selection.schedule;
          revealSettingsSnapshots.push(await compose.snapshotRevealSettingsModal());
          successSignals.add(`reveal-audience=${revealAudience}`);
          successSignals.add(`reveal-timing=${revealTiming}`);
          if (revealLaterSchedule.chosenIntervalLabel) {
            successSignals.add(`reveal-later-interval=${revealLaterSchedule.chosenIntervalLabel}`);
          }
          if (revealLaterSchedule.scheduledAtIso) {
            successSignals.add(`reveal-later-scheduled-at=${revealLaterSchedule.scheduledAtIso}`);
          }
        }, { phase: "interaction" });

        await monitor.step("click Reveal settings Continue once", async () => {
          phase = "reveal-continue";
          await compose.continueRevealSettingsOnce();
          revealSettingsContinueClicked = true;
          successSignals.add("reveal-continue-clicked");
          await fs.mkdir(LIVE_ARTIFACT_DIR, { recursive: true });
          await page.screenshot({ fullPage: true, path: postContinueScreenshotPath }).catch(() => {});
        }, { phase: "interaction" });

        await monitor.step("wait for final reveal-later share-link evidence", async () => {
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
        }, { phase: "interaction" });

        await monitor.step("assert reveal-later creation evidence", async () => {
          finalUrl = finalUrl || page.url();
          observedCreateSuccess =
            Boolean(finalShareLink) ||
            Boolean(possibleFinalCapsuleId) ||
            Boolean(possibleShareToken) ||
            Boolean(visibleSuccessText) ||
            Boolean(finalShareEvidence?.copyShareLinkVisible) ||
            Boolean(finalShareEvidence?.shareLinkButtonVisible) ||
            Boolean(finalShareEvidence?.homeVisible) ||
            [...successSignals].some((signal) =>
              /copy-share-link-visible|share-link-button-visible|home-button-visible|share-link=|visible-success=/.test(
                signal
              )
            );

          expect(
            revealTiming,
            `Expected Reveal settings to select "Reveal later". Schedule evidence: ${JSON.stringify(revealLaterSchedule)}`
          ).toBe("reveal-later");
          expect(
            observedCreateSuccess,
            `Expected the reveal-later capsule test to observe creation success evidence. Final URL: ${
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

      if (!buryClicked) {
        artifactStateNote = "Bury was not clicked. No reveal-later live capsule is likely to exist; only a draft-side artifact may exist on staging.";
      } else if (buryClicked && !revealSettingsContinueClicked) {
        artifactStateNote =
          "Bury was clicked and Reveal settings opened, but finalization was not continued. A reveal-later live capsule may or may not exist on staging.";
      } else if (revealSettingsContinueClicked) {
        artifactStateNote = observedCreateSuccess
          ? "Reveal-later capsule finalization was attempted; verify staging before rerun. Share-link evidence was observed and manual cleanup is required."
          : "Reveal-later capsule finalization was attempted; verify staging before rerun.";
      }

      const artifact: RevealLaterCapsuleArtifact = {
        artifactStateNote,
        buryClicked,
        cleanupInstruction: "Development team should delete this QA reveal-later live capsule from staging after verification.",
        createdAt: seed.createdAtIso,
        draftIdBeforeCreate,
        environment: "staging",
        finalActionClicked,
        finalActionLabel,
        finalShareEvidence,
        finalShareLink,
        finalUrl: finalUrl || page.url(),
        maskedTestEmail,
        message: seed.message,
        observedCreateSuccess,
        possibleDocumentIds: [...possibleDocumentIds],
        possibleFinalCapsuleId,
        possibleShareToken,
        postContinueScreenshotPath: revealSettingsContinueClicked ? postContinueScreenshotPath : null,
        revealAudience,
        revealLaterSchedule,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        runId: runContext.runId,
        screenshotPath,
        stepButtonSnapshots,
        subject: seed.subject,
        successSignals: [...successSignals],
        testOutputDir: testInfo.outputDir,
        url: configuredUrl,
        visibleSuccessText,
        writesObserved
      };

      await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
      await testInfo.attach("inssa-reveal-later-capsule-artifact.json", {
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
