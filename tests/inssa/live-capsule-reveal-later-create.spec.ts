import { expect, test } from "./fixtures";
import {
  InssaFinalLiveCreateStepError,
  type InssaComposeStepSnapshot,
  type InssaContactSelectionDiagnostic,
  type InssaLiveCapsuleShareEvidence,
  type InssaRevealLaterFlowClassification,
  type InssaRevealLaterScheduleEvidence,
  type InssaRevealSettingsModalSnapshot,
  type InssaRevealTimestampEvidence,
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
import { hasPersistedRevealSchedule } from "../../utils/inssa-reveal-schedule";
import { withInssaStabilityMonitor } from "../../utils/monitor";

const DEFAULT_TIMEOUT = 20_000;
const LIVE_TEST_ENABLED = process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] === "1";
const MANUAL_CLEANUP_APPROVED = process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] === "1";
const REVEAL_LATER_TEST_ENABLED = process.env[INSSA_REVEAL_LATER_CAPSULE_ENV_FLAG] === "1";
const STAGING_HOSTNAME = "staging.inssa.us";

type NetworkObservation = {
  method: string;
  phase: "bury-click" | "post-create" | "pre-create" | "reveal-continue";
  requestPostData?: string | null;
  requestUrl: string;
  responseBodySnippet?: string | null;
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
  revealLaterFlowClassification: InssaRevealLaterFlowClassification | null;
  revealLaterSchedule: InssaRevealLaterScheduleEvidence | null;
  revealLaterStep1Snapshot: InssaRevealSettingsModalSnapshot | null;
  revealLaterStep2Snapshot: InssaRevealSettingsModalSnapshot | null;
  revealTimestampEvidence: InssaRevealTimestampEvidence | null;
  revealSettingsContinueClicked: boolean;
  revealSettingsFollowupClickedLabel: string | null;
  revealSettingsOpened: boolean;
  revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[];
  revealTiming: "reveal-later" | "reveal-now" | null;
  runId: string;
  selectedContactLabel: string | null;
  selectedContactTarget: string | null;
  selectedContactsCountAfter: number | null;
  selectedContactsCountBefore: number | null;
  screenshotPath: string | null;
  stepButtonSnapshots: InssaComposeStepSnapshot[];
  subject: string;
  successSignals: string[];
  testOutputDir: string;
  url: string;
  visibleButtons: string[];
  visibleContactControls: string[];
  visibleDateFields: string[];
  visibleSchedulingControls: string[];
  visibleSuccessText: string | null;
  visibleTimeFields: string[];
  visibleValidationMessages: string[];
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
    const screenshotFileName = `${runContext.runId}-reveal-later.png`;
    const postContinueScreenshotFileName = `${runContext.runId}-reveal-later-post-continue.png`;
    const artifactFileName = `${runContext.runId}-reveal-later.json`;
    const screenshotPath = getInssaLifecycleArtifactPath(screenshotFileName);
    const postContinueScreenshotPath = getInssaLifecycleArtifactPath(postContinueScreenshotFileName);
    const writesObserved: NetworkObservation[] = [];
    const revealTimestampNetworkPayloads: string[] = [];
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
    let revealLaterFlowClassification: InssaRevealLaterFlowClassification | null = null;
    let revealLaterSchedule: InssaRevealLaterScheduleEvidence | null = null;
    let revealLaterStep1Snapshot: InssaRevealSettingsModalSnapshot | null = null;
    let revealLaterStep2Snapshot: InssaRevealSettingsModalSnapshot | null = null;
    let revealTimestampEvidence: InssaRevealTimestampEvidence | null = null;
    let revealSettingsContinueClicked = false;
    let revealSettingsFollowupClickedLabel: string | null = null;
    let revealSettingsOpened = false;
    let revealTiming: "reveal-later" | "reveal-now" | null = null;
    let contactSelection: InssaContactSelectionDiagnostic | null = null;
    const targetContactEmail = process.env.INSSA_SECONDARY_TEST_EMAIL?.trim() || "";
    const targetContactPattern = targetContactEmail ? new RegExp(escapeRegExp(targetContactEmail), "i") : undefined;
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
    const captureRevealTimestampPayload = (input: string | null | undefined) => {
      const text = expandPayloadForDiagnostics(input).trim();
      if (!text || !/reveal|schedule|scheduled|date|time|timestamp|deliver|available/i.test(text)) {
        return;
      }

      revealTimestampNetworkPayloads.push(redactPayload(text).slice(0, 8_000));
    };

    page.on("request", (request) => {
      const url = request.url();
      const postData = request.postData();
      const relevant =
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) ||
        /firestore|timecapsule|messages|capsule|cloudfunctions|documents|reveal|schedule/i.test(url);

      if (!relevant) {
        return;
      }

      writesObserved.push({
        method: request.method(),
        phase,
        requestPostData: postData ? redactPayload(expandPayloadForDiagnostics(postData)).slice(0, 2_000) : null,
        requestUrl: url,
        resourceType: request.resourceType()
      });
      capturePossibleIds(url);
      capturePossibleIds(postData);
      captureRevealTimestampPayload(url);
      captureRevealTimestampPayload(postData);
    });

    page.on("response", (response) => {
      const url = response.url();
      const relevant =
        ["POST", "PUT", "PATCH", "DELETE"].includes(response.request().method()) ||
        /firestore|timecapsule|messages|capsule|cloudfunctions|documents|reveal|schedule/i.test(url);

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
      captureRevealTimestampPayload(url);
      void response
        .text()
        .then((body) => {
          const redactedBody = redactPayload(expandPayloadForDiagnostics(body)).slice(0, 4_000);
          capturePossibleIds(redactedBody);
          captureRevealTimestampPayload(redactedBody);
          if (existing) {
            existing.responseBodySnippet = redactedBody;
          }
        })
        .catch(() => {});
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

        await monitor.step("choose Reveal later and inspect Step 2", async () => {
          phase = "reveal-continue";
          try {
            const selection = await compose.chooseRevealSettingsForQaRevealLaterCapsule();
            revealAudience = selection.revealAudience;
            revealLaterFlowClassification = selection.flowClassification;
            revealTiming = selection.revealTiming;
            revealLaterSchedule = selection.schedule;
            revealTimestampEvidence = selection.timestampEvidence;
            if (revealTimestampEvidence.scheduledAtIso) {
              revealLaterSchedule = {
                ...revealLaterSchedule,
                scheduledAtIso: revealLaterSchedule.scheduledAtIso ?? revealTimestampEvidence.scheduledAtIso
              };
            }
            revealLaterStep1Snapshot = selection.step1Snapshot;
            revealLaterStep2Snapshot = selection.stepTwoSnapshot;
            revealSettingsContinueClicked = selection.continueClicked;
            revealSettingsSnapshots.push(selection.step1Snapshot, selection.stepTwoSnapshot);
            if (revealAudience) {
              successSignals.add(`reveal-audience=${revealAudience}`);
            } else {
              successSignals.add("reveal-audience-not-present-on-step-1");
            }
            successSignals.add(`reveal-timing=${revealTiming}`);
            successSignals.add(`reveal-later-flow=${revealLaterFlowClassification}`);
            successSignals.add("reveal-continue-clicked");
            successSignals.add("reveal-step-2-inspected");
            if (revealLaterSchedule.chosenIntervalLabel) {
              successSignals.add(`reveal-later-interval=${revealLaterSchedule.chosenIntervalLabel}`);
            }
            if (revealLaterSchedule.scheduledAtIso) {
              successSignals.add(`reveal-later-scheduled-at=${revealLaterSchedule.scheduledAtIso}`);
            }
            if (revealTimestampEvidence.source) {
              successSignals.add(`reveal-timestamp-source=${revealTimestampEvidence.source}`);
            }
            await captureInssaLifecycleArtifactScreenshot(page, postContinueScreenshotFileName).catch(() => {});
          } catch (error) {
            const failureSnapshot = await compose.snapshotRevealSettingsModal().catch(() => null);
            if (failureSnapshot) {
              revealSettingsSnapshots.push(failureSnapshot);
              if (/step\s*2\s*of\s*2/i.test([failureSnapshot.stepLabel, failureSnapshot.selectedContactsStepLabel, failureSnapshot.visibleText].filter(Boolean).join("\n"))) {
                revealSettingsContinueClicked = true;
                revealLaterStep2Snapshot = revealLaterStep2Snapshot ?? failureSnapshot;
              } else {
                revealLaterStep1Snapshot = revealLaterStep1Snapshot ?? failureSnapshot;
              }
            }
            await captureInssaLifecycleArtifactScreenshot(page, postContinueScreenshotFileName).catch(() => {});
            throw error;
          }
        }, { phase: "interaction" });

        await monitor.step("select target contact and finalize reveal-later contact-share flow", async () => {
          phase = "post-create";
          const beforeContactSnapshot = await compose.snapshotRevealSettingsModal();
          if (!beforeContactSnapshot.contactShareDecisionVisible) {
            await compose.continueRevealSettingsOnce();
          }
          contactSelection = await compose.selectFirstVisibleContactForDiagnostic({
            targetLabelPattern: targetContactPattern
          });
          revealSettingsSnapshots.push(contactSelection.beforeSnapshot, contactSelection.afterSnapshot);
          revealSettingsFollowupClickedLabel = await compose.clickBuryThenChooseWhoToShareWithOnce();
          successSignals.add(`reveal-followup=${revealSettingsFollowupClickedLabel}`);
          successSignals.add(`selected-contact=${contactSelection.selectedContactLabel}`);
          successSignals.add(`selected-count=${contactSelection.afterSnapshot.selectedContactsCount ?? "unknown"}`);

          await expect
            .poll(
              async () => {
                finalShareEvidence = await compose.readLiveCapsuleShareEvidence();
                finalUrl = page.url();
                return (
                  finalShareEvidence.copyShareLinkVisible ||
                  finalShareEvidence.shareLinkButtonVisible ||
                  finalShareEvidence.homeVisible ||
                  Boolean(finalShareEvidence.finalShareLink) ||
                  /\/capsule\//i.test(finalUrl)
                );
              },
              {
                intervals: [500, 1000, 2000],
                timeout: DEFAULT_TIMEOUT,
                message: "Expected reveal-later finalization to expose success/share evidence after contact-share action."
              }
            )
            .toBeTruthy();

          finalUrl = page.url();
          finalShareEvidence = finalShareEvidence ?? (await compose.readLiveCapsuleShareEvidence());
          finalShareLink = finalShareEvidence.finalShareLink;
          possibleFinalCapsuleId = finalShareEvidence.possibleFinalCapsuleId;
          possibleShareToken = finalShareEvidence.possibleShareToken;
          visibleSuccessText = finalShareEvidence.visibleSuccessText;
          finalShareEvidence.successSignals.forEach((signal) => successSignals.add(signal));
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
      await captureInssaLifecycleArtifactScreenshot(page, screenshotFileName).catch(() => {});
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
      const postFlowTimestampEvidence = await compose
        .readRevealTimestampEvidence({
          networkPayloads: revealTimestampNetworkPayloads
        })
        .catch(() => null);
      const preFlowTimestampEvidence = revealTimestampEvidence as InssaRevealTimestampEvidence | null;
      if (preFlowTimestampEvidence && postFlowTimestampEvidence) {
        revealTimestampEvidence = {
          ...preFlowTimestampEvidence,
          candidateTimestamps: [
            ...preFlowTimestampEvidence.candidateTimestamps,
            ...postFlowTimestampEvidence.candidateTimestamps
          ],
          networkCandidates: postFlowTimestampEvidence.networkCandidates,
          localStorageCandidates: postFlowTimestampEvidence.localStorageCandidates,
          sessionStorageCandidates: postFlowTimestampEvidence.sessionStorageCandidates
        };
      } else {
        revealTimestampEvidence = preFlowTimestampEvidence ?? postFlowTimestampEvidence;
      }
      const timestampEvidenceForArtifact = revealTimestampEvidence as InssaRevealTimestampEvidence | null;
      const revealLaterScheduleSnapshot = revealLaterSchedule as InssaRevealLaterScheduleEvidence | null;
      const revealLaterScheduleForArtifact: InssaRevealLaterScheduleEvidence | null =
        revealLaterScheduleSnapshot && timestampEvidenceForArtifact?.scheduledAtIso && !revealLaterScheduleSnapshot.scheduledAtIso
          ? {
              ...revealLaterScheduleSnapshot,
              scheduledAtIso: timestampEvidenceForArtifact.scheduledAtIso
            }
          : revealLaterScheduleSnapshot;
      revealLaterSchedule = revealLaterScheduleForArtifact;
      const contactSelectionForArtifact = contactSelection as InssaContactSelectionDiagnostic | null;
      if (timestampEvidenceForArtifact?.source) {
        successSignals.add(`reveal-timestamp-source=${timestampEvidenceForArtifact.source}`);
      }

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

      const revealLaterDiagnosticSnapshots: InssaRevealSettingsModalSnapshot[] = [];
      if (revealLaterStep1Snapshot) {
        revealLaterDiagnosticSnapshots.push(revealLaterStep1Snapshot);
      }
      if (revealLaterStep2Snapshot) {
        revealLaterDiagnosticSnapshots.push(revealLaterStep2Snapshot);
      }
      const visibleButtons = Array.from(new Set(revealLaterDiagnosticSnapshots.flatMap((snapshot) => snapshot.visibleButtons)));
      const visibleContactControls = Array.from(new Set(revealLaterDiagnosticSnapshots.flatMap((snapshot) => snapshot.contactControls)));
      const visibleDateFields = Array.from(new Set(revealLaterDiagnosticSnapshots.flatMap((snapshot) => snapshot.visibleDateFields)));
      const visibleSchedulingControls = Array.from(new Set(revealLaterDiagnosticSnapshots.flatMap((snapshot) => snapshot.schedulingControls)));
      const visibleTimeFields = Array.from(new Set(revealLaterDiagnosticSnapshots.flatMap((snapshot) => snapshot.visibleTimeFields)));
      const visibleValidationMessages = Array.from(
        new Set(revealLaterDiagnosticSnapshots.flatMap((snapshot) => snapshot.validationMessages))
      );

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
        revealLaterFlowClassification,
        revealLaterSchedule,
        revealLaterStep1Snapshot,
        revealLaterStep2Snapshot,
        revealTimestampEvidence: timestampEvidenceForArtifact,
        revealSettingsContinueClicked,
        revealSettingsFollowupClickedLabel,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        runId: runContext.runId,
        selectedContactLabel: contactSelectionForArtifact?.selectedContactLabel ?? null,
        selectedContactTarget: targetContactEmail ? maskEmail(targetContactEmail) : null,
        selectedContactsCountAfter: contactSelectionForArtifact?.afterSnapshot.selectedContactsCount ?? null,
        selectedContactsCountBefore: contactSelectionForArtifact?.beforeSnapshot.selectedContactsCount ?? null,
        screenshotPath,
        stepButtonSnapshots,
        subject: seed.subject,
        successSignals: [...successSignals],
        testOutputDir: testInfo.outputDir,
        url: configuredUrl,
        visibleButtons,
        visibleContactControls,
        visibleDateFields,
        visibleSchedulingControls,
        visibleSuccessText,
        visibleTimeFields,
        visibleValidationMessages,
        writesObserved
      };

      await writeInssaLifecycleArtifactJson(artifactFileName, artifact);
      await testInfo.attach("inssa-reveal-later-capsule-artifact.json", {
        body: JSON.stringify(artifact, null, 2),
        contentType: "application/json"
      });

      if (finalActionClicked && observedCreateSuccess) {
        expect(
          hasPersistedRevealSchedule(timestampEvidenceForArtifact),
          `Reveal-later finalization succeeded without durable schedule evidence. Source: ${
            timestampEvidenceForArtifact?.source ?? "none"
          }; scheduledAtIso: ${timestampEvidenceForArtifact?.scheduledAtIso ?? "none"}.`
        ).toBe(true);
      }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactPayload(value: string): string {
  return String(value ?? "")
    .replace(/([?&](?:token|access_token|id_token|refresh_token|auth|code)=)[^&#\s"']+/gi, "$1[redacted]")
    .replace(/("(?:token|accessToken|idToken|refreshToken|authorization|auth|code)"\s*:\s*")[^"]+(")/gi, "$1[redacted]$2")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/g, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, maskEmail);
}

function expandPayloadForDiagnostics(value: string | null | undefined): string {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }

  const decodedParts = new Set<string>([text]);
  try {
    const params = new URLSearchParams(text);
    for (const [key, payload] of params.entries()) {
      if (key.includes("__data__") || /data|payload|body/i.test(key)) {
        decodedParts.add(payload);
      }
    }
  } catch {
    // Leave opaque payloads as-is; diagnostics should never block lifecycle execution.
  }

  return [...decodedParts].join("\n");
}
