import { expect, test } from "./fixtures";
import {
  type InssaComposeStepSnapshot,
  type InssaContactSelectionDiagnostic,
  type InssaLiveCapsuleShareEvidence,
  type InssaRevealSettingsModalSnapshot,
  TimeCapsulePage
} from "../../pages/inssa/time-capsule.page";
import { getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  captureInssaLifecycleArtifactScreenshot,
  getInssaLifecycleArtifactPath,
  writeInssaLifecycleArtifactJson
} from "../../utils/inssa-live-artifacts";
import {
  buildInssaQaLiveCapsuleSeed,
  createInssaMutationRunContext,
  INSSA_LIVE_CAPSULE_ENV_FLAG,
  INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG
} from "../../utils/inssa-mutation";
import {
  INSSA_DEFAULT_COMPOSE_ROUTE,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN
} from "../../utils/inssa-test-data";

const CONTACT_SHARE_DIAGNOSTIC_ENV_FLAG = "INSSA_ENABLE_CONTACT_SHARE_DIAGNOSTIC";
const CONTACT_SHARE_TARGET_EMAIL_ENV = "INSSA_CONTACT_SHARE_TARGET_EMAIL";
const LIVE_TEST_ENABLED = process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] === "1";
const MANUAL_CLEANUP_APPROVED = process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] === "1";
const CONTACT_SHARE_DIAGNOSTIC_ENABLED = process.env[CONTACT_SHARE_DIAGNOSTIC_ENV_FLAG] === "1";
const STAGING_HOSTNAME = "staging.inssa.us";

type ContactShareStateMachineArtifact = {
  cleanupInstruction: string;
  contactSelection: InssaContactSelectionDiagnostic | null;
  contactSelectionRequired: boolean | null;
  createdAt: string;
  environment: "staging";
  buryClicked: boolean;
  finalBuryThenChooseClicked: boolean;
  finalBuryThenChooseLabel: string | null;
  finalShareLink: string | null;
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalUrl: string;
  message: string;
  observedCreateSuccess: boolean;
  osShareSheetObserved: boolean | null;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  postContactSelectionScreenshotPath: string | null;
  postFinalClickScreenshotPath: string | null;
  preContactSelectionScreenshotPath: string | null;
  revealAudience: "personal-memory" | "shared-capsule" | null;
  revealSettingsContinueClicked: boolean;
  revealSettingsOpened: boolean;
  revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[];
  revealTiming: "reveal-later" | "reveal-now" | null;
  runId: string;
  selectedContactLabel: string | null;
  selectedContactTarget: string | null;
  shareLinkGeneratedAfterContactSelection: boolean;
  successSignals: string[];
  stateMachineClassification: string;
  stepButtonSnapshots: InssaComposeStepSnapshot[];
  subject: string;
  testOutputDir: string;
};

test.describe("INSSA contact-share state machine diagnostic", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!LIVE_TEST_ENABLED, `Requires ${INSSA_LIVE_CAPSULE_ENV_FLAG}=1.`);
  test.skip(
    !MANUAL_CLEANUP_APPROVED,
    `Requires ${INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG}=1 because staging capsules require manual cleanup.`
  );
  test.skip(!CONTACT_SHARE_DIAGNOSTIC_ENABLED, `Requires ${CONTACT_SHARE_DIAGNOSTIC_ENV_FLAG}=1.`);
  test.setTimeout(240_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();
    getInssaTestCredentials();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA contact-share diagnostics are hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("maps one-contact share workflow after Reveal settings Step 2", async ({ page }, testInfo) => {
    test.slow();
    testInfo.annotations.push({
      type: "warning",
      description:
        "Creates one staging capsule diagnostic, selects exactly one visible contact, and clicks the current contact-share action once."
    });

    const configuredUrl = assertValidInssaUrl();
    const compose = new TimeCapsulePage(page);
    const runContext = createInssaMutationRunContext({
      file: testInfo.file,
      projectName: testInfo.project.name,
      retry: testInfo.retry,
      title: testInfo.title
    });
    const seed = buildInssaQaLiveCapsuleSeed(runContext);
    const targetContactEmail = process.env[CONTACT_SHARE_TARGET_EMAIL_ENV]?.trim() || process.env.INSSA_SECONDARY_TEST_EMAIL?.trim() || "";
    const targetContactPattern = targetContactEmail ? new RegExp(escapeRegExp(targetContactEmail), "i") : undefined;
    const artifactFileName = `${runContext.runId}-contact-share-state-machine.json`;
    const preContactSelectionScreenshotFileName = `${runContext.runId}-contact-step-before-selection.png`;
    const postContactSelectionScreenshotFileName = `${runContext.runId}-contact-step-after-selection.png`;
    const postFinalClickScreenshotFileName = `${runContext.runId}-contact-step-after-final-click.png`;
    const preContactSelectionScreenshotPath = getInssaLifecycleArtifactPath(preContactSelectionScreenshotFileName);
    const postContactSelectionScreenshotPath = getInssaLifecycleArtifactPath(postContactSelectionScreenshotFileName);
    const postFinalClickScreenshotPath = getInssaLifecycleArtifactPath(postFinalClickScreenshotFileName);

    const stepButtonSnapshots: InssaComposeStepSnapshot[] = [];
    const revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[] = [];
    let contactSelection: InssaContactSelectionDiagnostic | null = null;
    let finalBuryThenChooseClicked = false;
    let finalBuryThenChooseLabel: string | null = null;
    let finalShareEvidence: InssaLiveCapsuleShareEvidence | null = null;
    let finalUrl = "";
    let possibleFinalCapsuleId: string | null = null;
    let possibleShareToken: string | null = null;
    let revealAudience: "personal-memory" | "shared-capsule" | null = null;
    let revealSettingsContinueClicked = false;
    let revealSettingsOpened = false;
    let revealTiming: "reveal-later" | "reveal-now" | null = null;
    const successSignals = new Set<string>();
    let stateMachineClassification = "not-reached";

    try {
      await compose.goToComposeRoute();
      await compose.expectComposeSurface();
      await expect
        .poll(() => page.url(), {
          timeout: 20_000,
          message: "Expected contact-share diagnostic to remain on /timecapsule before finalization."
        })
        .toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);

      await compose.fillComposeFields(seed);
      await compose.expectComposeValues(seed);

      const shareStep = await compose.waitForShareStepReady({ maxAdvanceClicks: 4 });
      stepButtonSnapshots.push(...shareStep.snapshots);

      await compose.clickBuryOnceToOpenRevealSettings();
      revealSettingsOpened = true;
      revealSettingsSnapshots.push(await compose.snapshotRevealSettingsModal());

      const revealSelection = await compose.chooseRevealSettingsForQaLiveCapsule();
      revealAudience = revealSelection.revealAudience;
      revealTiming = revealSelection.revealTiming;
      revealSettingsSnapshots.push(await compose.snapshotRevealSettingsModal());

      await compose.continueRevealSettingsOnce();
      revealSettingsContinueClicked = true;
      const contactStepSnapshot = await compose.waitForContactShareDecisionStep();
      revealSettingsSnapshots.push(contactStepSnapshot);
      await captureInssaLifecycleArtifactScreenshot(page, preContactSelectionScreenshotFileName);

      contactSelection = await compose.selectFirstVisibleContactForDiagnostic({
        targetLabelPattern: targetContactPattern
      });
      revealSettingsSnapshots.push(contactSelection.afterSnapshot);
      await captureInssaLifecycleArtifactScreenshot(page, postContactSelectionScreenshotFileName);

      finalBuryThenChooseLabel = await compose.clickBuryThenChooseWhoToShareWithOnce();
      finalBuryThenChooseClicked = true;
      await expect
        .poll(
          async () => {
            finalShareEvidence = await compose.readLiveCapsuleShareEvidence();
            finalUrl = page.url();
            finalShareEvidence.successSignals.forEach((signal) => successSignals.add(signal));
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
            timeout: 20_000,
            message: "Polling for post-contact finalization/share-link evidence."
          }
        )
        .toBeTruthy()
        .catch(() => {});

      finalShareEvidence = finalShareEvidence ?? (await compose.readLiveCapsuleShareEvidence().catch(() => null));
      finalShareEvidence?.successSignals.forEach((signal) => successSignals.add(signal));
      finalUrl = page.url();
      possibleFinalCapsuleId = finalShareEvidence?.possibleFinalCapsuleId ?? null;
      possibleShareToken = finalShareEvidence?.possibleShareToken ?? null;
      await captureInssaLifecycleArtifactScreenshot(page, postFinalClickScreenshotFileName);
      stateMachineClassification = classifyContactShareStateMachine({
        contactSelection,
        finalBuryThenChooseClicked,
        finalShareEvidence,
        finalUrl
      });
    } finally {
      finalUrl = finalUrl || page.url();
      finalShareEvidence = finalShareEvidence ?? (await compose.readLiveCapsuleShareEvidence().catch(() => null));
      finalShareEvidence?.successSignals.forEach((signal) => successSignals.add(signal));
      possibleFinalCapsuleId = possibleFinalCapsuleId ?? finalShareEvidence?.possibleFinalCapsuleId ?? null;
      possibleShareToken = possibleShareToken ?? finalShareEvidence?.possibleShareToken ?? null;

      const shareLinkGeneratedAfterContactSelection = Boolean(
        finalShareEvidence?.finalShareLink ||
          finalShareEvidence?.copyShareLinkVisible ||
          finalShareEvidence?.shareLinkButtonVisible ||
          finalShareEvidence?.homeVisible ||
          possibleFinalCapsuleId ||
          possibleShareToken ||
          /\/capsule\//i.test(finalUrl)
      );
      const observedCreateSuccess = shareLinkGeneratedAfterContactSelection || successSignals.size > 0;
      const contactSelectionRequired =
        contactSelection === null
          ? null
          : !contactSelection.beforeSnapshot.skipContactsShareLinkVisible &&
            contactSelection.beforeSnapshot.selectedContactsCount === 0 &&
            contactSelection.beforeSnapshot.visibleButtons.some((label) => /^bury,\s*then choose who to share with$/i.test(label));
      const artifact: ContactShareStateMachineArtifact = {
        cleanupInstruction: "Development team should delete this QA contact-share diagnostic capsule from staging after verification.",
        contactSelection,
        contactSelectionRequired,
        createdAt: seed.createdAtIso,
        environment: "staging",
        buryClicked: true,
        finalBuryThenChooseClicked,
        finalBuryThenChooseLabel,
        finalShareLink: finalShareEvidence?.finalShareLink ?? null,
        finalShareEvidence,
        finalUrl,
        message: seed.message,
        observedCreateSuccess,
        osShareSheetObserved: null,
        possibleFinalCapsuleId,
        possibleShareToken,
        postContactSelectionScreenshotPath: contactSelection ? postContactSelectionScreenshotPath : null,
        postFinalClickScreenshotPath: finalBuryThenChooseClicked ? postFinalClickScreenshotPath : null,
        preContactSelectionScreenshotPath: revealSettingsContinueClicked ? preContactSelectionScreenshotPath : null,
        revealAudience,
        revealSettingsContinueClicked,
        revealSettingsOpened,
        revealSettingsSnapshots,
        revealTiming,
        runId: runContext.runId,
        selectedContactLabel: contactSelection?.selectedContactLabel ?? null,
        selectedContactTarget: targetContactEmail ? maskEmail(targetContactEmail) : null,
        shareLinkGeneratedAfterContactSelection,
        stateMachineClassification:
          stateMachineClassification === "not-reached" && finalBuryThenChooseClicked
            ? classifyContactShareStateMachine({
                contactSelection,
                finalBuryThenChooseClicked,
                finalShareEvidence,
                finalUrl
              })
            : stateMachineClassification,
        stepButtonSnapshots,
        subject: seed.subject,
        successSignals: [...successSignals],
        testOutputDir: testInfo.outputDir
      };

      await writeInssaLifecycleArtifactJson(artifactFileName, artifact);
      await testInfo.attach("inssa-contact-share-state-machine.json", {
        body: JSON.stringify(artifact, null, 2),
        contentType: "application/json"
      });
    }
  });
});

function classifyContactShareStateMachine(input: {
  contactSelection: InssaContactSelectionDiagnostic | null;
  finalBuryThenChooseClicked: boolean;
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalUrl: string;
}): string {
  if (!input.contactSelection) {
    return "contact-step-reached-but-contact-not-selected";
  }

  if (!input.finalBuryThenChooseClicked) {
    return input.contactSelection.selectedCountChanged
      ? "contact-selection-changed-before-finalization"
      : "contact-selection-unchanged-before-finalization";
  }

  const shareLinkEvidence = Boolean(
    input.finalShareEvidence?.finalShareLink ||
      input.finalShareEvidence?.copyShareLinkVisible ||
      input.finalShareEvidence?.shareLinkButtonVisible ||
      input.finalShareEvidence?.homeVisible ||
      input.finalShareEvidence?.possibleFinalCapsuleId ||
      input.finalShareEvidence?.possibleShareToken ||
      /\/capsule\//i.test(input.finalUrl)
  );

  if (shareLinkEvidence) {
    return "contact-selected-finalized-and-share-evidence-visible";
  }

  return "contact-selected-finalized-without-visible-share-evidence";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskEmail(email: string): string {
  const [localPart, domain = ""] = email.split("@");
  if (!localPart) {
    return `***@${domain}`;
  }

  return `${localPart[0]}***@${domain}`;
}
