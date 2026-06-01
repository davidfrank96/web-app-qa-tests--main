import { expect, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { assertValidInssaUrl } from "../../utils/env";
import {
  buildInssaComposeRouteForLocation,
  type InssaComposeRouteLocation,
  INSSA_ARCHIVE_CAPSULE_PATTERN,
  INSSA_BACK_STEP_PATTERN,
  INSSA_COMPOSE_STEP_PATTERN,
  INSSA_COMPOSE_STEP_HEADING_PATTERN,
  INSSA_COMPOSE_STEP_MEDIA_PATTERN,
  INSSA_COMPOSE_STEP_SHARE_PATTERN,
  INSSA_COMPOSE_INITIAL_DRAFT_KEY_PREFIX,
  INSSA_COMPOSE_REFRESH_CACHE_KEY_PREFIX,
  INSSA_DEFAULT_COMPOSE_ROUTE,
  INSSA_DELETE_CAPSULE_PATTERN,
  INSSA_DISCARD_DRAFT_PATTERN,
  INSSA_EDIT_CAPSULE_PATTERN,
  INSSA_CONTACT_SELECTION_PATTERN,
  INSSA_COPY_SHARE_LINK_PATTERN,
  INSSA_LIVE_CREATE_ACTION_PATTERN,
  INSSA_GENERIC_JS_SHELL_PATTERN,
  INSSA_HOME_BUTTON_PATTERN,
  INSSA_HIDE_CAPSULE_PATTERN,
  INSSA_CAPSULE_SHARE_LINK_PATTERN,
  INSSA_MESSAGE_COUNTER_PATTERN,
  INSSA_MESSAGE_LABEL_PATTERN,
  INSSA_NEXT_STEP_PATTERN,
  INSSA_PERSONAL_MEMORY_PATTERN,
  INSSA_PUBLISH_CAPSULE_PATTERN,
  INSSA_REVEAL_CANCEL_PATTERN,
  INSSA_REVEAL_CONTINUE_PATTERN,
  INSSA_REVEAL_LATER_PATTERN,
  INSSA_REVEAL_NOW_PATTERN,
  INSSA_REVEAL_SETTINGS_STEP_PATTERN,
  INSSA_REVEAL_SETTINGS_TITLE_PATTERN,
  INSSA_REMOTE_IMAGE_INPUT_PATTERN,
  INSSA_SAFE_REVEAL_FOLLOWUP_PATTERN,
  INSSA_SAVE_EXIT_PATTERN,
  INSSA_SHARE_LINK_BUTTON_PATTERN,
  INSSA_SHARED_CAPSULE_PATTERN,
  INSSA_SUBJECT_COUNTER_PATTERN,
  INSSA_SUBJECT_LABEL_PATTERN,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN,
  INSSA_UNPUBLISH_CAPSULE_PATTERN
} from "../../utils/inssa-test-data";

const DEFAULT_TIMEOUT = 15_000;
const POST_CONTINUE_SUCCESS_TIMEOUT = 45_000;
const INSSA_BROWSER_SESSION_WARNING_PATTERN = /heads up about this browser session/i;
const INSSA_BROWSER_SESSION_WARNING_DISMISS_PATTERN = /^got it$/i;
const INSSA_CONTACT_SHARE_DECISION_TITLE_PATTERN = /send to my contacts/i;
const INSSA_CONTACT_SHARE_DECISION_STEP_PATTERN = /\b\d+\s+selected\s*[·•-]?\s*step\s*2\s*of\s*2|step\s*2\s*of\s*2/i;
const INSSA_SEND_SELECTED_CONTACTS_PATTERN = /^send to selected contacts\s*&\s*bury$/i;
const INSSA_SKIP_CONTACTS_SHARE_LINK_PATTERN = /^skip contacts\s*&\s*share link with others$/i;
const INSSA_SHARE_LINK_WITH_OTHERS_PATTERN =
  /^(?:skip contacts\s*&\s*share link with others|bury\s*&\s*share link with others)$/i;

export type InssaDraftValueKind = "empty" | "other" | "qa" | "template";

export type InssaComposeDraftStorageRecord = {
  activeStep: number | null;
  draftId: string;
  exists: boolean;
  key: string;
  messageKind: InssaDraftValueKind;
  savedAt: number | null;
  subjectKind: InssaDraftValueKind;
};

export type InssaDraftHydrationTelemetryEvent = {
  action: "pushState" | "remove" | "replaceState" | "set";
  draftId?: string;
  forceFreshSession?: boolean;
  hasCapsuleState?: boolean;
  key?: string;
  kind: "history" | "session-storage";
  messageKind?: InssaDraftValueKind;
  path?: string;
  savedAt?: number | null;
  showDraftSaved?: boolean;
  subjectKind?: InssaDraftValueKind;
  timestampMs: number;
};

export type InssaLifecycleControlSnapshot = {
  archiveCapsule: boolean;
  deleteCapsule: boolean;
  discardDraft: boolean;
  editCapsule: boolean;
  hideCapsule: boolean;
  publishCapsule: boolean;
  saveAndExit: boolean;
  unpublishCapsule: boolean;
};

export type InssaLiveCreateActionInspection = {
  candidateLabels: string[];
  chosenLabel: string | null;
  visibleButtons: string[];
};

export type InssaComposeStepSnapshot = {
  candidateFinalActionLabels: string[];
  currentUrl: string;
  finalActionLabel: string | null;
  mediaSelectedSummaryText: string | null;
  messageVisible: boolean;
  nextStepVisible: boolean;
  step: string | null;
  subjectVisible: boolean;
  visibleButtons: string[];
};

export type InssaFinalLiveCreateStepResolution = {
  finalActionLabel: string;
  snapshots: InssaComposeStepSnapshot[];
};

export class InssaFinalLiveCreateStepError extends Error {
  constructor(
    message: string,
    readonly snapshots: InssaComposeStepSnapshot[]
  ) {
    super(message);
    this.name = "InssaFinalLiveCreateStepError";
  }
}

export type InssaMediaFileInputSnapshot = {
  accept: string;
  id: string;
  multiple: boolean;
  name: string;
};

export type InssaMediaStepCapabilities = {
  acceptedFileTypes: string[];
  fileInputs: InssaMediaFileInputSnapshot[];
  hasFileInput: boolean;
  hasGalleryOption: boolean;
  hasPhotoOption: boolean;
  hasRemoteImageUrlInput: boolean;
  hasVideoOption: boolean;
  remoteImageInputDescriptors: string[];
  visibleButtons: string[];
};

export type InssaMediaSelectionSnapshot = {
  count: number;
  names: string[];
};

export type InssaMediaAttachmentEvidence = {
  imagePreviewVisible: boolean;
  inputFileCount: number;
  inputFileNames: string[];
  mediaPreviewVisible: boolean;
  previewVisible: boolean;
  selectedSummaryCount: number | null;
  selectedSummaryText: string | null;
  selectedVideoCount: number | null;
  videoPreviewVisible: boolean;
};

export type InssaRevealSettingsModalSnapshot = {
  browserSessionWarningDismissed: boolean;
  cancelVisible: boolean;
  contactShareDecisionVisible: boolean;
  contactSelectionVisible: boolean;
  continueVisible: boolean;
  contactControls: string[];
  currentUrl: string;
  dialogVisible: boolean;
  finalShareLinkCandidate: string | null;
  homeVisible: boolean;
  personalMemoryVisible: boolean;
  revealLaterVisible: boolean;
  revealNowVisible: boolean;
  safeFollowupLabels: string[];
  schedulingControls: string[];
  selectedContactsStepLabel: string | null;
  sendToContactsVisible: boolean;
  shareLinkButtonVisible: boolean;
  sharedCapsuleVisible: boolean;
  skipContactsShareLinkVisible: boolean;
  stepLabel: string | null;
  titleText: string | null;
  titleVisible: boolean;
  visibleButtons: string[];
  visibleDateFields: string[];
  visibleInputs: string[];
  visibleTimeFields: string[];
  visibleText: string;
  validationMessages: string[];
};

export type InssaRevealSettingsSelection = {
  revealAudience: "personal-memory" | "shared-capsule" | null;
  revealTiming: "reveal-later" | "reveal-now" | null;
};

export type InssaRevealSettingsProgress = {
  continueClicked: boolean;
  followupClickedLabel: string | null;
  selected: InssaRevealSettingsSelection;
  snapshots: InssaRevealSettingsModalSnapshot[];
};

export type InssaRevealLaterScheduleEvidence = {
  chosenIntervalLabel: string | null;
  dateInputFilled: boolean;
  dateTimeInputFilled: boolean;
  scheduledAtIso: string | null;
  scheduledAtText: string | null;
  timeInputFilled: boolean;
  visibleDateTimeControls: string[];
  visibleScheduleButtons: string[];
};

export type InssaRevealLaterFlowClassification =
  | "contact-share-step"
  | "scheduling-and-contact-step"
  | "scheduling-step"
  | "unknown";

export type InssaRevealLaterSettingsSelection = InssaRevealSettingsSelection & {
  continueClicked: boolean;
  flowClassification: InssaRevealLaterFlowClassification;
  schedule: InssaRevealLaterScheduleEvidence;
  step1Snapshot: InssaRevealSettingsModalSnapshot;
  stepTwoSnapshot: InssaRevealSettingsModalSnapshot;
};

export type InssaLiveCapsuleShareEvidence = {
  copyShareLinkVisible: boolean;
  finalShareLink: string | null;
  homeVisible: boolean;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  shareLinkButtonVisible: boolean;
  successSignals: string[];
  visibleButtons: string[];
  visibleSuccessText: string | null;
};

export class TimeCapsulePage {
  constructor(private readonly page: Page) {}

  async goToComposeRoute(path: string = INSSA_DEFAULT_COMPOSE_ROUTE): Promise<void> {
    assertValidInssaUrl();
    const response = await this.page.goto(path, { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400) {
      throw new Error(`INSSA compose route returned HTTP ${response.status()}.`);
    }
  }

  async goToComposeLocation(location: InssaComposeRouteLocation): Promise<void> {
    await this.goToComposeRoute(buildInssaComposeRouteForLocation(location));
  }

  async installDraftHydrationTelemetry(input: {
    qaMarker: string;
    qaMessage: string;
    qaSubject: string;
    templateMessage: string;
    templateSubject: string;
  }): Promise<void> {
    await this.page.addInitScript(
      ({
        initialDraftKeyPrefix,
        qaMarker,
        qaMessage,
        qaSubject,
        refreshKeyPrefix,
        templateMessage,
        templateSubject
      }) => {
        const globalKey = "__INSSA_DRAFT_HYDRATION__";
        const store = ((window as any)[globalKey] ??= { events: [] as any[] });
        const startedAt = performance.now();

        const classifyValue = (value: unknown) => {
          const text = typeof value === "string" ? value.trim() : "";

          if (!text) {
            return "empty";
          }

          if (text === qaSubject || text === qaMessage || text.includes(qaMarker)) {
            return "qa";
          }

          if (text === templateSubject || text === templateMessage) {
            return "template";
          }

          return "other";
        };

        const summarizeSessionValue = (key: string, value: string | null) => {
          if (!value) {
            return {
              draftId: "",
              messageKind: "empty",
              savedAt: null,
              subjectKind: "empty"
            };
          }

          if (key.startsWith(refreshKeyPrefix)) {
            try {
              const parsed = JSON.parse(value);
              const wizardData = parsed?.wizardData ?? {};
              return {
                draftId: String(wizardData?.draftId ?? "").trim(),
                messageKind: classifyValue(wizardData?.message),
                savedAt: Number(parsed?.savedAt ?? 0) || null,
                subjectKind: classifyValue(wizardData?.subject)
              };
            } catch {
              return {
                draftId: "",
                messageKind: "other",
                savedAt: null,
                subjectKind: "other"
              };
            }
          }

          if (key.startsWith(initialDraftKeyPrefix)) {
            return {
              draftId: String(value).trim(),
              messageKind: "empty",
              savedAt: null,
              subjectKind: "empty"
            };
          }

          return {
            draftId: "",
            messageKind: "other",
            savedAt: null,
            subjectKind: "other"
          };
        };

        const pushEvent = (event: Record<string, unknown>) => {
          store.events.push({
            ...event,
            timestampMs: Math.round((performance.now() - startedAt) * 100) / 100
          });
        };

        const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
        window.sessionStorage.setItem = (key: string, value: string) => {
          if (key.startsWith(refreshKeyPrefix) || key.startsWith(initialDraftKeyPrefix)) {
            pushEvent({
              action: "set",
              key,
              kind: "session-storage",
              ...summarizeSessionValue(key, value)
            });
          }

          return originalSetItem(key, value);
        };

        const originalRemoveItem = window.sessionStorage.removeItem.bind(window.sessionStorage);
        window.sessionStorage.removeItem = (key: string) => {
          if (key.startsWith(refreshKeyPrefix) || key.startsWith(initialDraftKeyPrefix)) {
            pushEvent({
              action: "remove",
              key,
              kind: "session-storage"
            });
          }

          return originalRemoveItem(key);
        };

        const wrapHistoryMethod = (name: "pushState" | "replaceState") => {
          const original = window.history[name].bind(window.history);
          window.history[name] = (state: any, unused: string, url?: string | URL | null) => {
            pushEvent({
              action: name,
              forceFreshSession: Boolean(state?.forceFreshSession),
              hasCapsuleState: Boolean(state?.capsule),
              kind: "history",
              path: typeof url === "string" ? url : url?.toString?.() ?? window.location.pathname,
              showDraftSaved: Boolean(state?.showDraftSaved)
            });
            return original(state, unused, url as any);
          };
        };

        wrapHistoryMethod("pushState");
        wrapHistoryMethod("replaceState");
      },
      {
        initialDraftKeyPrefix: INSSA_COMPOSE_INITIAL_DRAFT_KEY_PREFIX,
        qaMarker: input.qaMarker,
        qaMessage: input.qaMessage,
        qaSubject: input.qaSubject,
        refreshKeyPrefix: INSSA_COMPOSE_REFRESH_CACHE_KEY_PREFIX,
        templateMessage: input.templateMessage,
        templateSubject: input.templateSubject
      }
    );
  }

  async expectComposeSurface(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(this.page.locator("body")).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);
    await expect
      .poll(() => this.page.url(), {
        timeout: DEFAULT_TIMEOUT,
        message: "Expected the Bury action to land on the time capsule compose route."
      })
      .toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);

    await expect(this.subjectField(), "Expected the compose surface to show the Subject field.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.messageField(), "Expected the compose surface to show the message field.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.discardDraftButton(), "Expected the compose surface to expose Discard draft.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(this.saveAndExitButton(), "Expected the compose surface to expose Save & exit.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(
      this.page.getByText(INSSA_COMPOSE_STEP_PATTERN).first(),
      "Expected the compose flow to expose step labels."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async expectRequiredFieldMetadata(): Promise<void> {
    await expect(
      this.page.getByText(INSSA_SUBJECT_LABEL_PATTERN).first(),
      "Expected Subject to be marked as required."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(
      this.page.getByText(INSSA_MESSAGE_LABEL_PATTERN).first(),
      "Expected Your Message to be marked as required."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(
      this.page.getByText(INSSA_SUBJECT_COUNTER_PATTERN).first(),
      "Expected the compose surface to expose the Subject character limit."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(
      this.page.getByText(INSSA_MESSAGE_COUNTER_PATTERN).first(),
      "Expected the compose surface to expose the message character limit."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async currentStepHeadingText(): Promise<string> {
    await expect(
      this.page.getByText(INSSA_COMPOSE_STEP_HEADING_PATTERN).first(),
      "Expected the compose surface to expose the active step heading."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    return (await this.page.getByText(INSSA_COMPOSE_STEP_HEADING_PATTERN).first().innerText()).trim();
  }

  async listVisibleButtonLabels(): Promise<string[]> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.page.locator("button:visible").evaluateAll((elements) =>
          elements
            .map((element) => {
              const text = ((element instanceof HTMLElement ? element.innerText : element.textContent) || "").trim();
              const aria = element.getAttribute("aria-label")?.trim() ?? "";
              const title = element.getAttribute("title")?.trim() ?? "";
              return [aria, text, title].find(Boolean) ?? "";
            })
            .filter(Boolean)
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 0 && /Execution context was destroyed|Target closed|most likely because of a navigation/i.test(message)) {
          await this.page.waitForLoadState("domcontentloaded").catch(() => {});
          continue;
        }

        throw error;
      }
    }

    return [];
  }

  async snapshotLifecycleControls(): Promise<InssaLifecycleControlSnapshot> {
    await this.expectComposeSurface();

    return {
      archiveCapsule: await this.archiveCapsuleButton().isVisible().catch(() => false),
      deleteCapsule: await this.deleteCapsuleButton().isVisible().catch(() => false),
      discardDraft: await this.discardDraftButton().isVisible().catch(() => false),
      editCapsule: await this.editCapsuleButton().isVisible().catch(() => false),
      hideCapsule: await this.hideCapsuleButton().isVisible().catch(() => false),
      publishCapsule: await this.publishCapsuleButton().isVisible().catch(() => false),
      saveAndExit: await this.saveAndExitButton().isVisible().catch(() => false),
      unpublishCapsule: await this.unpublishCapsuleButton().isVisible().catch(() => false)
    };
  }

  async fillComposeFields(input: { message: string; subject: string }): Promise<void> {
    await this.subjectField().fill(input.subject);
    await this.messageField().fill(input.message);
  }

  async readComposeValues(): Promise<{ message: string; subject: string }> {
    return {
      message: await this.messageField().inputValue(),
      subject: await this.subjectField().inputValue()
    };
  }

  async readClientDraftStorage(input: {
    pathname?: string;
    qaMarker: string;
    qaMessage: string;
    qaSubject: string;
    templateMessage: string;
    templateSubject: string;
  }): Promise<{
    currentPath: string;
    initialDraft: InssaComposeDraftStorageRecord;
    refresh: InssaComposeDraftStorageRecord;
  }> {
    return this.page.evaluate(
      ({
        initialDraftKeyPrefix,
        pathnameOverride,
        qaMarker,
        qaMessage,
        qaSubject,
        refreshKeyPrefix,
        templateMessage,
        templateSubject
      }) => {
        const classifyValue = (value: unknown): InssaDraftValueKind => {
          const text = typeof value === "string" ? value.trim() : "";

          if (!text) {
            return "empty";
          }

          if (text === qaSubject || text === qaMessage || text.includes(qaMarker)) {
            return "qa";
          }

          if (text === templateSubject || text === templateMessage) {
            return "template";
          }

          return "other";
        };

        const pathname = pathnameOverride || window.location.pathname;
        const refreshKey = `${refreshKeyPrefix}${pathname}`;
        const initialDraftKey = `${initialDraftKeyPrefix}${pathname}`;
        const refreshRaw = window.sessionStorage.getItem(refreshKey);
        const initialDraftRaw = window.sessionStorage.getItem(initialDraftKey);

        const parseRefreshRecord = (): InssaComposeDraftStorageRecord => {
          if (!refreshRaw) {
            return {
              activeStep: null,
              draftId: "",
              exists: false,
              key: refreshKey,
              messageKind: "empty",
              savedAt: null,
              subjectKind: "empty"
            };
          }

          try {
            const parsed = JSON.parse(refreshRaw);
            const wizardData = parsed?.wizardData ?? {};

            return {
              activeStep: Number.isInteger(parsed?.activeStep) ? parsed.activeStep : null,
              draftId: String(wizardData?.draftId ?? "").trim(),
              exists: true,
              key: refreshKey,
              messageKind: classifyValue(wizardData?.message),
              savedAt: Number(parsed?.savedAt ?? 0) || null,
              subjectKind: classifyValue(wizardData?.subject)
            };
          } catch {
            return {
              activeStep: null,
              draftId: "",
              exists: true,
              key: refreshKey,
              messageKind: "other",
              savedAt: null,
              subjectKind: "other"
            };
          }
        };

        const parseInitialDraftRecord = (): InssaComposeDraftStorageRecord => {
          if (!initialDraftRaw) {
            return {
              activeStep: null,
              draftId: "",
              exists: false,
              key: initialDraftKey,
              messageKind: "empty",
              savedAt: null,
              subjectKind: "empty"
            };
          }

          return {
            activeStep: null,
            draftId: String(initialDraftRaw).trim(),
            exists: true,
            key: initialDraftKey,
            messageKind: "empty",
            savedAt: null,
            subjectKind: "empty"
          };
        };

        return {
          currentPath: pathname,
          initialDraft: parseInitialDraftRecord(),
          refresh: parseRefreshRecord()
        };
      },
      {
        initialDraftKeyPrefix: INSSA_COMPOSE_INITIAL_DRAFT_KEY_PREFIX,
        pathnameOverride: input.pathname,
        qaMarker: input.qaMarker,
        qaMessage: input.qaMessage,
        qaSubject: input.qaSubject,
        refreshKeyPrefix: INSSA_COMPOSE_REFRESH_CACHE_KEY_PREFIX,
        templateMessage: input.templateMessage,
        templateSubject: input.templateSubject
      }
    );
  }

  async readDraftHydrationTelemetry(): Promise<InssaDraftHydrationTelemetryEvent[]> {
    return this.page.evaluate(() => {
      const entries = (window as any).__INSSA_DRAFT_HYDRATION__?.events;
      return Array.isArray(entries) ? entries.slice() : [];
    });
  }

  async expectComposeValues(input: { message: string; subject: string }): Promise<void> {
    await expect(this.subjectField(), "Expected the compose subject to retain the QA draft value.").toHaveValue(
      input.subject,
      {
        timeout: DEFAULT_TIMEOUT
      }
    );
    await expect(this.messageField(), "Expected the compose message to retain the QA draft value.").toHaveValue(
      input.message,
      {
        timeout: DEFAULT_TIMEOUT
      }
    );
  }

  async expectComposeValuesCleared(input: { message: string; subject: string }): Promise<void> {
    await expect(this.subjectField(), "Expected the QA draft subject to be removed from compose.").not.toHaveValue(
      input.subject,
      {
        timeout: DEFAULT_TIMEOUT
      }
    );
    await expect(this.messageField(), "Expected the QA draft message to be removed from compose.").not.toHaveValue(
      input.message,
      {
        timeout: DEFAULT_TIMEOUT
      }
    );
  }

  async saveAndExit(): Promise<void> {
    await expect(this.saveAndExitButton(), "Expected Save & exit to be visible before saving a draft.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await this.saveAndExitButton().click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async advanceToMediaStep(): Promise<void> {
    await expect(this.nextStepButton(), "Expected Next step to be visible on the Compose step.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await this.nextStepButton().click();
    await this.waitForMediaStepReady();
  }

  async waitForMediaStepReady(): Promise<void> {
    await expect(
      this.page.getByText(INSSA_COMPOSE_STEP_MEDIA_PATTERN).first(),
      "Expected the compose flow to expose Step 2: Media."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect
      .poll(
        async () => {
          const snapshot = await this.snapshotComposeStepState();
          return this.isMediaStepContentReady(snapshot);
        },
        {
          timeout: DEFAULT_TIMEOUT,
          message: "Expected the Media step to render real media controls before advancing."
        }
      )
      .toBe(true);
  }

  async expectMediaStep(): Promise<void> {
    await expect(
      this.page.getByText(INSSA_COMPOSE_STEP_MEDIA_PATTERN).first(),
      "Expected the compose flow to expose Step 2: Media."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async advanceToShareStep(): Promise<void> {
    await expect(this.nextStepButton(), "Expected Next step to be visible on the Media step.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await this.nextStepButton().click();
    await expect(
      this.page.getByText(INSSA_COMPOSE_STEP_SHARE_PATTERN).first(),
      "Expected the compose flow to advance to Step 3: Share."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async expectShareStep(): Promise<void> {
    await expect(
      this.page.getByText(INSSA_COMPOSE_STEP_SHARE_PATTERN).first(),
      "Expected the compose flow to expose Step 3: Share."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async inspectMediaStepCapabilities(): Promise<InssaMediaStepCapabilities> {
    await this.expectMediaStep();

    const visibleButtons = await this.listVisibleButtonLabels();
    const fileInputs = await this.page.locator("input[type='file']").evaluateAll((elements) =>
      elements.map((element) => ({
        accept: element.getAttribute("accept")?.trim() ?? "",
        id: element.getAttribute("id")?.trim() ?? "",
        multiple: element.hasAttribute("multiple"),
        name: element.getAttribute("name")?.trim() ?? ""
      }))
    );
    const remoteImageInputDescriptors = await this.page.locator("input, textarea").evaluateAll((elements) =>
      elements
        .map((element) => {
          const descriptor = [
            element.getAttribute("aria-label"),
            element.getAttribute("placeholder"),
            element.getAttribute("name"),
            element.getAttribute("type")
          ]
            .filter(Boolean)
            .join(" | ")
            .trim();

          return descriptor;
        })
        .filter((descriptor) => descriptor && /url|link|image/i.test(descriptor))
    );

    return {
      acceptedFileTypes: Array.from(
        new Set(
          fileInputs
            .flatMap((input) => input.accept.split(","))
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ),
      fileInputs,
      hasFileInput: fileInputs.length > 0,
      hasGalleryOption: visibleButtons.some((label) => /^gallery$/i.test(label)),
      hasPhotoOption: visibleButtons.some((label) => /^photo$/i.test(label)),
      hasRemoteImageUrlInput: remoteImageInputDescriptors.some((descriptor) =>
        INSSA_REMOTE_IMAGE_INPUT_PATTERN.test(descriptor)
      ),
      hasVideoOption: visibleButtons.some((label) => /^video$/i.test(label)),
      remoteImageInputDescriptors,
      visibleButtons
    };
  }

  async attachSingleMediaFile(filePath: string): Promise<InssaMediaFileInputSnapshot> {
    await this.expectMediaStep();
    const input = this.page.locator("input[type='file']").first();
    await expect(input, "Expected the Media step to expose a file input before uploading media.").toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT
    });
    await input.setInputFiles(filePath);

    return await input.evaluate((element) => ({
      accept: element.getAttribute("accept")?.trim() ?? "",
      id: element.getAttribute("id")?.trim() ?? "",
      multiple: element.hasAttribute("multiple"),
      name: element.getAttribute("name")?.trim() ?? ""
    }));
  }

  async selectVideoMediaMode(): Promise<void> {
    await this.expectMediaStep();
    const videoButton = this.page.getByRole("button", { name: /^video$/i }).first();
    await expect(videoButton, "Expected the Media step to expose a Video mode before uploading a video.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await videoButton.click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async dismissVideoRecorderModalIfVisible(): Promise<boolean> {
    const recordHeading = this.page.getByRole("heading", { name: /^Record Video$/i }).first();
    if (!(await recordHeading.isVisible().catch(() => false))) {
      return false;
    }

    const cancelButton = this.page.getByRole("button", { name: /^Cancel$/i }).last();
    await expect(cancelButton, "Expected the Record Video overlay to expose a Cancel button.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await cancelButton.click();
    await expect(recordHeading, "Expected the Record Video overlay to close before advancing to Share.").toBeHidden({
      timeout: DEFAULT_TIMEOUT
    });

    return true;
  }

  async fillRemoteImageUrl(url: string): Promise<void> {
    await this.expectMediaStep();
    await expect(
      this.remoteImageUrlField(),
      "Expected the Media step to expose a remote image URL field before using the remote-image path."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await this.remoteImageUrlField().fill(url);
  }

  async readSelectedMediaFiles(): Promise<InssaMediaSelectionSnapshot> {
    const input = this.page.locator("input[type='file']").first();
    if ((await input.count()) === 0) {
      return { count: 0, names: [] };
    }

    return await input.evaluate((element) => {
      const fileInput = element as HTMLInputElement;
      return {
        count: fileInput.files?.length ?? 0,
        names: Array.from(fileInput.files ?? []).map((file: File) => file.name)
      };
    });
  }

  async readMediaAttachmentEvidence(): Promise<InssaMediaAttachmentEvidence> {
    const selectedFromInput = await this.readSelectedMediaFiles();
    const selectedSummary = await this.page
      .locator("text=/Selected\\s+\\d+\\/12\\s+files/i")
      .first()
      .textContent()
      .catch(() => null);
    const selectedSummaryCount = selectedSummary ? Number(selectedSummary.match(/Selected\s+(\d+)\/12\s+files/i)?.[1] ?? "") : null;
    const selectedVideoCount = selectedSummary ? Number(selectedSummary.match(/(?:·|\s)\s*(\d+)\/2\s+videos?/i)?.[1] ?? "") : null;
    const imagePreviewVisible = await this.page.locator("img[alt='preview']").first().isVisible().catch(() => false);
    const videoPreviewVisible = await this.page.locator("video").first().isVisible().catch(() => false);
    const mediaPreviewVisible = imagePreviewVisible || videoPreviewVisible;

    return {
      imagePreviewVisible,
      inputFileCount: selectedFromInput.count,
      inputFileNames: selectedFromInput.names,
      mediaPreviewVisible,
      previewVisible: mediaPreviewVisible,
      selectedSummaryCount: Number.isFinite(selectedSummaryCount) ? selectedSummaryCount : null,
      selectedSummaryText: selectedSummary?.trim() ?? null,
      selectedVideoCount: Number.isFinite(selectedVideoCount) ? selectedVideoCount : null,
      videoPreviewVisible
    };
  }

  async inspectLiveCreateAction(): Promise<InssaLiveCreateActionInspection> {
    const visibleButtons = await this.listVisibleButtonLabels();
    const candidateLabels = visibleButtons.filter(
      (label) =>
        INSSA_LIVE_CREATE_ACTION_PATTERN.test(label) &&
        !INSSA_DISCARD_DRAFT_PATTERN.test(label) &&
        !INSSA_SAVE_EXIT_PATTERN.test(label) &&
        !INSSA_NEXT_STEP_PATTERN.test(label) &&
        !INSSA_BACK_STEP_PATTERN.test(label)
    );

    return {
      candidateLabels,
      chosenLabel: candidateLabels.length === 1 ? candidateLabels[0] : null,
      visibleButtons
    };
  }

  async snapshotComposeStepState(): Promise<InssaComposeStepSnapshot> {
    const visibleButtons = await this.listVisibleButtonLabels();
    const candidateFinalActionLabels = visibleButtons.filter(
      (label) =>
        INSSA_LIVE_CREATE_ACTION_PATTERN.test(label) &&
        !INSSA_DISCARD_DRAFT_PATTERN.test(label) &&
        !INSSA_SAVE_EXIT_PATTERN.test(label) &&
        !INSSA_NEXT_STEP_PATTERN.test(label) &&
        !INSSA_BACK_STEP_PATTERN.test(label)
    );
    const finalActionLabel =
      candidateFinalActionLabels.length === 1
        ? candidateFinalActionLabels.find((label) => /^bury$/i.test(label)) ?? candidateFinalActionLabels[0]
        : null;

    return {
      candidateFinalActionLabels,
      currentUrl: this.page.url(),
      finalActionLabel,
      mediaSelectedSummaryText:
        (await this.page.locator("text=/Selected\\s+\\d+\\/12\\s+files/i").first().textContent().catch(() => null))?.trim() ??
        null,
      messageVisible: await this.messageField().isVisible().catch(() => false),
      nextStepVisible: await this.nextStepButton().isVisible().catch(() => false),
      step: await this.page.getByText(INSSA_COMPOSE_STEP_HEADING_PATTERN).first().textContent().catch(() => null),
      subjectVisible: await this.subjectField().isVisible().catch(() => false),
      visibleButtons
    };
  }

  private composeStepSnapshotFingerprint(snapshot: InssaComposeStepSnapshot): string {
    return JSON.stringify({
      buttons: snapshot.visibleButtons,
      currentUrl: snapshot.currentUrl,
      finalActionLabel: snapshot.finalActionLabel,
      mediaSelectedSummaryText: snapshot.mediaSelectedSummaryText,
      messageVisible: snapshot.messageVisible,
      nextStepVisible: snapshot.nextStepVisible,
      step: snapshot.step,
      subjectVisible: snapshot.subjectVisible
    });
  }

  private pushSnapshotIfChanged(
    snapshots: InssaComposeStepSnapshot[],
    snapshot: InssaComposeStepSnapshot
  ): void {
    const lastSnapshot = snapshots[snapshots.length - 1];
    if (!lastSnapshot || this.composeStepSnapshotFingerprint(lastSnapshot) !== this.composeStepSnapshotFingerprint(snapshot)) {
      snapshots.push(snapshot);
    }
  }

  private isComposeStep(snapshot: InssaComposeStepSnapshot): boolean {
    return /step\s*1\s*:\s*compose/i.test(snapshot.step ?? "");
  }

  private isMediaStep(snapshot: InssaComposeStepSnapshot): boolean {
    return INSSA_COMPOSE_STEP_MEDIA_PATTERN.test(snapshot.step ?? "");
  }

  private isShareStep(snapshot: InssaComposeStepSnapshot): boolean {
    return INSSA_COMPOSE_STEP_SHARE_PATTERN.test(snapshot.step ?? "");
  }

  private isMediaStepContentReady(snapshot: InssaComposeStepSnapshot): boolean {
    return (
      this.isMediaStep(snapshot) &&
      (Boolean(snapshot.mediaSelectedSummaryText) ||
        snapshot.visibleButtons.some((label) => /^photo$|^video$|^gallery$/i.test(label)))
    );
  }

  private assertNoAmbiguousFinalActions(snapshot: InssaComposeStepSnapshot, snapshots: InssaComposeStepSnapshot[]): void {
    if (snapshot.candidateFinalActionLabels.length > 1) {
      throw new InssaFinalLiveCreateStepError(
        `Multiple ambiguous final live create actions are visible: ${snapshot.candidateFinalActionLabels.join(
          ", "
        )}. Step="${snapshot.step ?? "unknown"}". Visible buttons: ${snapshot.visibleButtons.join(", ")}`,
        snapshots
      );
    }

    const finalActionLabel = snapshot.finalActionLabel?.trim() ?? "";
    if (finalActionLabel && !/^bury$/i.test(finalActionLabel)) {
      throw new InssaFinalLiveCreateStepError(
        `Expected the final Share-step action to be "Bury", but found "${finalActionLabel}". Step="${
          snapshot.step ?? "unknown"
        }". Visible buttons: ${snapshot.visibleButtons.join(", ")}`,
        snapshots
      );
    }
  }

  private async clickNextStepAndWaitForChange(before: InssaComposeStepSnapshot): Promise<void> {
    const beforeFingerprint = this.composeStepSnapshotFingerprint(before);

    await expect(this.nextStepButton(), "Expected Next step to be visible before advancing compose.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await this.nextStepButton().click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});

    await expect
      .poll(
        async () => {
          const nextSnapshot = await this.snapshotComposeStepState();
          return this.composeStepSnapshotFingerprint(nextSnapshot);
        },
        {
          timeout: DEFAULT_TIMEOUT,
          message: "Expected the compose flow to advance after clicking Next step."
        }
      )
      .not.toBe(beforeFingerprint);
  }

  private async waitForMediaStepSnapshotReady(snapshots: InssaComposeStepSnapshot[]): Promise<InssaComposeStepSnapshot> {
    const deadline = Date.now() + DEFAULT_TIMEOUT;

    while (Date.now() < deadline) {
      const snapshot = await this.snapshotComposeStepState();
      this.pushSnapshotIfChanged(snapshots, snapshot);
      this.assertNoAmbiguousFinalActions(snapshot, snapshots);

      if (this.isMediaStepContentReady(snapshot)) {
        return snapshot;
      }

      await this.page.waitForTimeout(250);
    }

    const failedSnapshot = snapshots[snapshots.length - 1];
    throw new InssaFinalLiveCreateStepError(
      `Expected Step 2: Media to render media controls before advancing. Last step="${
        failedSnapshot?.step ?? "unknown"
      }". Visible buttons: ${failedSnapshot?.visibleButtons.join(", ") ?? ""}`,
      snapshots
    );
  }

  private async waitForBuryOnShareStep(snapshots: InssaComposeStepSnapshot[]): Promise<InssaComposeStepSnapshot> {
    const deadline = Date.now() + DEFAULT_TIMEOUT;

    while (Date.now() < deadline) {
      const snapshot = await this.snapshotComposeStepState();
      this.pushSnapshotIfChanged(snapshots, snapshot);
      this.assertNoAmbiguousFinalActions(snapshot, snapshots);

      if (/^bury$/i.test(snapshot.finalActionLabel ?? "")) {
        return snapshot;
      }

      await this.page.waitForTimeout(250);
    }

    const failedSnapshot = snapshots[snapshots.length - 1];
    throw new InssaFinalLiveCreateStepError(
      `Expected Step 3: Share to render exactly one Bury button. Last step="${
        failedSnapshot?.step ?? "unknown"
      }". Visible buttons: ${failedSnapshot?.visibleButtons.join(", ") ?? ""}`,
      snapshots
    );
  }

  async waitForShareStepReady(input: { maxAdvanceClicks?: number } = {}): Promise<InssaFinalLiveCreateStepResolution> {
    const maxAdvanceClicks = input.maxAdvanceClicks ?? 2;
    const snapshots: InssaComposeStepSnapshot[] = [];
    let advanceClicks = 0;
    let snapshot = await this.snapshotComposeStepState();
    this.pushSnapshotIfChanged(snapshots, snapshot);
    this.assertNoAmbiguousFinalActions(snapshot, snapshots);

    if (/^bury$/i.test(snapshot.finalActionLabel ?? "")) {
      return { finalActionLabel: "Bury", snapshots };
    }

    if (!this.isMediaStepContentReady(snapshot) && !this.isShareStep(snapshot)) {
      if (!this.isComposeStep(snapshot) || !snapshot.nextStepVisible) {
        throw new InssaFinalLiveCreateStepError(
          `Expected to start live creation from Compose, Media, or Share before finding Bury. Step="${
            snapshot.step ?? "unknown"
          }". Visible buttons: ${snapshot.visibleButtons.join(", ")}`,
          snapshots
        );
      }

      if (advanceClicks >= maxAdvanceClicks) {
        throw new InssaFinalLiveCreateStepError(
          `Refused to advance past max step count before Media. Step="${snapshot.step ?? "unknown"}".`,
          snapshots
        );
      }

      await this.clickNextStepAndWaitForChange(snapshot);
      advanceClicks += 1;
      snapshot = await this.waitForMediaStepSnapshotReady(snapshots);
    }

    if (/^bury$/i.test(snapshot.finalActionLabel ?? "")) {
      return { finalActionLabel: "Bury", snapshots };
    }

    if (!this.isShareStep(snapshot)) {
      if (!snapshot.nextStepVisible) {
        throw new InssaFinalLiveCreateStepError(
          `Expected Next step to be available on Media before advancing to Share. Step="${
            snapshot.step ?? "unknown"
          }". Visible buttons: ${snapshot.visibleButtons.join(", ")}`,
          snapshots
        );
      }

      if (advanceClicks >= maxAdvanceClicks) {
        throw new InssaFinalLiveCreateStepError(
          `Refused to advance past max step count before Share. Step="${snapshot.step ?? "unknown"}".`,
          snapshots
        );
      }

      await this.clickNextStepAndWaitForChange(snapshot);
      advanceClicks += 1;
    }

    const shareSnapshot = await this.waitForBuryOnShareStep(snapshots);
    if (!/^bury$/i.test(shareSnapshot.finalActionLabel ?? "")) {
      throw new InssaFinalLiveCreateStepError(
        `Expected the final Share-step action to be "Bury", but found "${shareSnapshot.finalActionLabel}".`,
        snapshots
      );
    }

    return { finalActionLabel: "Bury", snapshots };
  }

  async advanceToFinalLiveCreateStep(input: { maxAdvanceClicks?: number } = {}): Promise<InssaFinalLiveCreateStepResolution> {
    return await this.waitForShareStepReady(input);
  }

  async findBuryActionOnShareStep(): Promise<string | null> {
    const inspection = await this.inspectLiveCreateAction();
    return inspection.candidateLabels.find((label) => /^bury$/i.test(label)) ?? null;
  }

  async dismissBrowserSessionWarningIfPresent(): Promise<boolean> {
    const warning = this.page.getByText(INSSA_BROWSER_SESSION_WARNING_PATTERN).first();
    if (!(await warning.isVisible().catch(() => false))) {
      return false;
    }

    await warning.waitFor({ state: "hidden", timeout: 1_000 }).catch(() => undefined);
    if (!(await warning.isVisible().catch(() => false))) {
      return false;
    }

    const scopedDismissButton = this.page
      .locator("[role='status'], [role='alert'], [aria-live]")
      .filter({ hasText: INSSA_BROWSER_SESSION_WARNING_PATTERN })
      .getByRole("button", { name: INSSA_BROWSER_SESSION_WARNING_DISMISS_PATTERN });
    const dismissButton = await this.firstVisibleLocator([
      scopedDismissButton,
      this.page.getByRole("button", { name: INSSA_BROWSER_SESSION_WARNING_DISMISS_PATTERN })
    ]);

    if (!dismissButton) {
      console.warn('INSSA browser session warning is visible, but its "Got it" dismiss action was not found.');
      return false;
    }

    await dismissButton.click();
    await expect(warning, "Expected the browser session warning to dismiss before inspecting Reveal settings.").not.toBeVisible({
      timeout: 3_000
    });

    return true;
  }

  private async firstVisibleLocator(locators: Locator[]): Promise<Locator | null> {
    for (const locator of locators) {
      if ((await locator.count().catch(() => 0)) > 0 && (await locator.first().isVisible().catch(() => false))) {
        return locator.first();
      }
    }

    return null;
  }

  private async resolveRevealOptionLocator(pattern: RegExp): Promise<Locator | null> {
    return await this.firstVisibleLocator([
      this.page.getByRole("radio", { name: pattern }),
      this.page.getByRole("button", { name: pattern }),
      this.page.getByRole("checkbox", { name: pattern }),
      this.page.locator("[role='radio'], [role='checkbox'], button, label").filter({ hasText: pattern }),
      this.page.getByText(pattern)
    ]);
  }

  private async locatorLooksSelected(locator: Locator): Promise<boolean> {
    return await locator.evaluate((element) => {
      const hasSelectedState = (candidate: Element | null) => {
        if (!candidate) {
          return false;
        }

        const value = (name: string) => candidate.getAttribute(name)?.toLowerCase().trim() ?? "";
        if (value("aria-checked") === "true" || value("aria-pressed") === "true" || value("data-selected") === "true") {
          return true;
        }

        const dataState = value("data-state");
        if (["active", "checked", "on", "open", "selected"].includes(dataState)) {
          return true;
        }

        if (candidate instanceof HTMLElement) {
          const classNames = candidate.className.toLowerCase();
          if (/(^|\s)(selected|active|checked)(\s|$)/.test(classNames)) {
            return true;
          }
        }

        return false;
      };

      if (hasSelectedState(element)) {
        return true;
      }

      const closestControl = element.closest("[role='radio'], [role='checkbox'], button, label, [aria-checked], [aria-pressed]");
      if (hasSelectedState(closestControl)) {
        return true;
      }

      const nestedInput = element.querySelector?.("input[type='radio'], input[type='checkbox']") as HTMLInputElement | null;
      if (nestedInput?.checked) {
        return true;
      }

      const enclosingLabel = element.closest("label");
      const labelledInput = enclosingLabel?.querySelector("input[type='radio'], input[type='checkbox']") as HTMLInputElement | null;
      return Boolean(labelledInput?.checked);
    });
  }

  private async ensureRevealOptionSelected(
    pattern: RegExp,
    selectedValue: InssaRevealSettingsSelection["revealAudience"] | InssaRevealSettingsSelection["revealTiming"]
  ): Promise<InssaRevealSettingsSelection["revealAudience"] | InssaRevealSettingsSelection["revealTiming"]> {
    const locator = await this.resolveRevealOptionLocator(pattern);
    if (!locator) {
      throw new Error(`Expected reveal settings to expose an option matching ${pattern}.`);
    }

    const alreadySelected = await this.locatorLooksSelected(locator).catch(() => false);
    if (!alreadySelected) {
      await locator.click();
    }

    return selectedValue;
  }

  async clickBuryOnceToOpenRevealSettings(): Promise<void> {
    const buryLabel = await this.findBuryActionOnShareStep();
    if (!buryLabel) {
      const inspection = await this.inspectLiveCreateAction();
      throw new Error(
        `Expected the Share step to expose a Bury action before opening reveal settings. Visible buttons: ${inspection.visibleButtons.join(", ")}`
      );
    }

    await this.clickLiveCreateActionOnce(buryLabel);
    await expect(
      this.page.getByText(INSSA_REVEAL_SETTINGS_TITLE_PATTERN).first(),
      'Expected clicking "Bury" to open the Reveal settings modal.'
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await this.dismissBrowserSessionWarningIfPresent();
    await expect(this.page.getByRole("button", { name: INSSA_REVEAL_CONTINUE_PATTERN }).first()).toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
  }

  async snapshotRevealSettingsModal(): Promise<InssaRevealSettingsModalSnapshot> {
    const browserSessionWarningDismissed = await this.dismissBrowserSessionWarningIfPresent();
    const visibleButtons = await this.listVisibleButtonLabels();
    const visibleInputs = await this.listVisibleInputDescriptors();
    const visibleDateFields = visibleInputs.filter((descriptor) => /\bdate\b|datetime|calendar/i.test(descriptor));
    const visibleTimeFields = visibleInputs.filter((descriptor) => /\btime\b|datetime|hh:mm|hour|minute/i.test(descriptor));
    const bodyText = await this.page.locator("body").innerText().catch(() => "");
    const titleVisible = await this.page.getByText(INSSA_REVEAL_SETTINGS_TITLE_PATTERN).first().isVisible().catch(() => false);
    const titleText = titleVisible
      ? (await this.page.getByRole("heading", { name: INSSA_REVEAL_SETTINGS_TITLE_PATTERN }).first().innerText().catch(() => null))?.trim() ??
        (await this.page.getByText(INSSA_REVEAL_SETTINGS_TITLE_PATTERN).first().innerText().catch(() => null))?.trim() ??
        null
      : null;
    const stepLabel = (await this.page.getByText(INSSA_REVEAL_SETTINGS_STEP_PATTERN).first().textContent().catch(() => null))?.trim() ?? null;
    const selectedContactsStepLabel =
      bodyText
        .split(/\n+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .find((line) => INSSA_CONTACT_SHARE_DECISION_STEP_PATTERN.test(line)) ?? null;
    const contactShareDecisionVisible =
      (await this.page.getByText(INSSA_CONTACT_SHARE_DECISION_TITLE_PATTERN).first().isVisible().catch(() => false)) ||
      (Boolean(selectedContactsStepLabel) &&
        visibleButtons.some((label) => INSSA_SHARE_LINK_WITH_OTHERS_PATTERN.test(label)));
    const copyShareLinkVisible = await this.isCopyShareLinkVisible();
    const shareLinkButtonVisible = await this.isShareLinkButtonVisible();
    const homeVisible = await this.isHomeVisible();
    const schedulingControls = [
      ...(await this.listVisibleTemporalControls()),
      ...visibleButtons.filter((label) => /later|minute|min|hour|tomorrow|date|time|schedule|reveal/i.test(label))
    ];
    const contactControls = [
      ...visibleButtons.filter((label) => /contacts?|selected|select all|people|friends|shared capsule|personal memory|share link/i.test(label)),
      ...visibleInputs.filter((descriptor) => /contacts?|people|friends|recipient|search/i.test(descriptor))
    ];

    return {
      browserSessionWarningDismissed,
      cancelVisible: await this.page.getByRole("button", { name: INSSA_REVEAL_CANCEL_PATTERN }).first().isVisible().catch(() => false),
      contactShareDecisionVisible,
      contactSelectionVisible: await this.page.getByText(INSSA_CONTACT_SELECTION_PATTERN).first().isVisible().catch(() => false),
      continueVisible: await this.page.getByRole("button", { name: INSSA_REVEAL_CONTINUE_PATTERN }).first().isVisible().catch(() => false),
      contactControls: Array.from(new Set(contactControls)),
      currentUrl: this.page.url(),
      dialogVisible:
        contactShareDecisionVisible ||
        titleVisible ||
        (await this.page.locator("[role='dialog'], [aria-modal='true']").filter({ hasText: INSSA_REVEAL_SETTINGS_TITLE_PATTERN }).first().isVisible().catch(() => false)),
      finalShareLinkCandidate: extractVisibleShareLink(bodyText),
      homeVisible,
      personalMemoryVisible: await this.page.getByText(INSSA_PERSONAL_MEMORY_PATTERN).first().isVisible().catch(() => false),
      revealLaterVisible: await this.page.getByText(INSSA_REVEAL_LATER_PATTERN).first().isVisible().catch(() => false),
      revealNowVisible: await this.page.getByText(INSSA_REVEAL_NOW_PATTERN).first().isVisible().catch(() => false),
      safeFollowupLabels: visibleButtons.filter((label) => this.isSafeRevealFollowupLabel(label)),
      schedulingControls: Array.from(new Set(schedulingControls)),
      selectedContactsStepLabel,
      sendToContactsVisible: visibleButtons.some((label) => INSSA_SEND_SELECTED_CONTACTS_PATTERN.test(label)),
      shareLinkButtonVisible: copyShareLinkVisible || shareLinkButtonVisible,
      sharedCapsuleVisible: await this.page.getByText(INSSA_SHARED_CAPSULE_PATTERN).first().isVisible().catch(() => false),
      skipContactsShareLinkVisible: visibleButtons.some((label) => INSSA_SHARE_LINK_WITH_OTHERS_PATTERN.test(label)),
      stepLabel,
      titleText,
      titleVisible,
      visibleButtons,
      visibleDateFields,
      visibleInputs,
      visibleTimeFields,
      visibleText: bodyText,
      validationMessages: extractValidationMessages(bodyText)
    };
  }

  async chooseRevealSettingsForQaLiveCapsule(): Promise<InssaRevealSettingsSelection> {
    await this.dismissBrowserSessionWarningIfPresent();
    await expect(
      this.page.getByText(INSSA_REVEAL_SETTINGS_TITLE_PATTERN).first(),
      "Expected the Reveal settings modal before selecting QA live capsule options."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    const step1Snapshot = await this.snapshotRevealSettingsModal();
    if (step1Snapshot.sharedCapsuleVisible !== step1Snapshot.personalMemoryVisible) {
      throw new Error(
        `QA live capsule reveal-now flow exposed a partial audience selection state. ` +
          `Observed sharedCapsuleVisible=${step1Snapshot.sharedCapsuleVisible}, ` +
          `personalMemoryVisible=${step1Snapshot.personalMemoryVisible}, visibleButtons=${step1Snapshot.visibleButtons.join(", ")}.`
      );
    }

    const revealAudience = step1Snapshot.sharedCapsuleVisible
      ? ((await this.ensureRevealOptionSelected(
          INSSA_SHARED_CAPSULE_PATTERN,
          "shared-capsule"
        )) as InssaRevealSettingsSelection["revealAudience"])
      : null;
    const revealTiming = (await this.ensureRevealOptionSelected(
      INSSA_REVEAL_NOW_PATTERN,
      "reveal-now"
    )) as InssaRevealSettingsSelection["revealTiming"];

    return {
      revealAudience,
      revealTiming
    };
  }

  async chooseRevealSettingsForQaRevealLaterCapsule(input: {
    futureOffsetMinutes?: number;
  } = {}): Promise<InssaRevealLaterSettingsSelection> {
    void input;
    await this.dismissBrowserSessionWarningIfPresent();
    await expect(
      this.page.getByText(INSSA_REVEAL_SETTINGS_TITLE_PATTERN).first(),
      "Expected the Reveal settings modal before selecting QA reveal-later capsule options."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await expect(
      this.page.getByText(INSSA_REVEAL_LATER_PATTERN).first(),
      'Expected Reveal settings Step 1 to expose "Reveal later".'
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const revealTiming = (await this.ensureRevealOptionSelected(
      INSSA_REVEAL_LATER_PATTERN,
      "reveal-later"
    )) as InssaRevealSettingsSelection["revealTiming"];
    const step1Snapshot = await this.snapshotRevealSettingsModal();

    if (step1Snapshot.sharedCapsuleVisible || step1Snapshot.personalMemoryVisible) {
      throw new Error(
        `Expected the current reveal-later Step 1 flow to be timing-first without audience selection. ` +
          `Observed Step 1 snapshot: ${this.formatRevealSettingsSnapshotForError(step1Snapshot)}`
      );
    }

    await this.continueRevealSettingsOnce();
    const stepTwoSnapshot = await this.waitForRevealSettingsStepTwoSnapshot();
    const flowClassification = this.classifyRevealLaterFlow(stepTwoSnapshot);
    const schedule = this.buildRevealLaterScheduleEvidenceFromSnapshots({
      step1Snapshot,
      stepTwoSnapshot
    });

    if (flowClassification === "unknown") {
      throw new Error(
        `Expected Reveal settings Step 2 to expose scheduling, contact/share, or combined controls after selecting "Reveal later". ` +
          `Step 1 snapshot: ${this.formatRevealSettingsSnapshotForError(step1Snapshot)}. ` +
          `Step 2 snapshot: ${this.formatRevealSettingsSnapshotForError(stepTwoSnapshot)}.`
      );
    }

    return {
      continueClicked: true,
      flowClassification,
      revealAudience: null,
      revealTiming,
      schedule,
      step1Snapshot,
      stepTwoSnapshot
    };
  }

  private hasActionableRevealLaterSchedule(schedule: InssaRevealLaterScheduleEvidence): boolean {
    return Boolean(schedule.chosenIntervalLabel || schedule.dateTimeInputFilled || schedule.dateInputFilled || schedule.timeInputFilled);
  }

  private classifyRevealLaterFlow(snapshot: InssaRevealSettingsModalSnapshot): InssaRevealLaterFlowClassification {
    const hasSchedulingControls =
      snapshot.schedulingControls.length > 0 || snapshot.visibleDateFields.length > 0 || snapshot.visibleTimeFields.length > 0;
    const hasContactControls = snapshot.contactShareDecisionVisible || snapshot.contactControls.length > 0;

    if (hasSchedulingControls && hasContactControls) {
      return "scheduling-and-contact-step";
    }

    if (hasSchedulingControls) {
      return "scheduling-step";
    }

    if (hasContactControls) {
      return "contact-share-step";
    }

    return "unknown";
  }

  private buildRevealLaterScheduleEvidenceFromSnapshots(input: {
    step1Snapshot: InssaRevealSettingsModalSnapshot;
    stepTwoSnapshot: InssaRevealSettingsModalSnapshot;
  }): InssaRevealLaterScheduleEvidence {
    const visibleDateTimeControls = Array.from(
      new Set([
        ...input.step1Snapshot.schedulingControls,
        ...input.step1Snapshot.visibleDateFields,
        ...input.step1Snapshot.visibleTimeFields,
        ...input.stepTwoSnapshot.schedulingControls,
        ...input.stepTwoSnapshot.visibleDateFields,
        ...input.stepTwoSnapshot.visibleTimeFields
      ])
    );
    const visibleScheduleButtons = Array.from(
      new Set(
        [...input.step1Snapshot.visibleButtons, ...input.stepTwoSnapshot.visibleButtons].filter((label) =>
          /later|minute|min|hour|tomorrow|date|time|schedule|reveal/i.test(label)
        )
      )
    );

    return {
      chosenIntervalLabel: null,
      dateInputFilled: false,
      dateTimeInputFilled: false,
      scheduledAtIso: null,
      scheduledAtText: this.extractRevealLaterScheduleTextFromSnapshots(input.step1Snapshot, input.stepTwoSnapshot),
      timeInputFilled: false,
      visibleDateTimeControls,
      visibleScheduleButtons
    };
  }

  private extractRevealLaterScheduleTextFromSnapshots(
    ...snapshots: InssaRevealSettingsModalSnapshot[]
  ): string | null {
    return (
      snapshots
        .flatMap((snapshot) => snapshot.visibleText.split(/\n+/))
        .map((value) => value.replace(/\s+/g, " ").trim())
        .find((value) => /reveal later|scheduled|schedule|tomorrow|\b(?:min|minute|hour|date|time)\b/i.test(value)) ?? null
    );
  }

  private async waitForRevealSettingsStepTwoSnapshot(): Promise<InssaRevealSettingsModalSnapshot> {
    const deadline = Date.now() + DEFAULT_TIMEOUT;
    let lastSnapshot: InssaRevealSettingsModalSnapshot | null = null;

    while (Date.now() < deadline) {
      const snapshot = await this.snapshotRevealSettingsModal();
      lastSnapshot = snapshot;
      if (this.isRevealSettingsStepTwoSnapshot(snapshot)) {
        return snapshot;
      }

      await this.page.waitForTimeout(250);
    }

    throw new Error(
      `Expected Reveal settings to advance to Step 2 of 2 after selecting "Reveal later" and clicking Continue. Last snapshot: ${
        lastSnapshot ? this.formatRevealSettingsSnapshotForError(lastSnapshot) : "none"
      }`
    );
  }

  private isRevealSettingsStepTwoSnapshot(snapshot: InssaRevealSettingsModalSnapshot): boolean {
    return /step\s*2\s*of\s*2/i.test(
      [snapshot.titleText, snapshot.stepLabel, snapshot.selectedContactsStepLabel, snapshot.visibleText].filter(Boolean).join("\n")
    );
  }

  private formatRevealSettingsSnapshotForError(snapshot: InssaRevealSettingsModalSnapshot): string {
    return JSON.stringify({
      contactControls: snapshot.contactControls,
      personalMemoryVisible: snapshot.personalMemoryVisible,
      revealLaterVisible: snapshot.revealLaterVisible,
      revealNowVisible: snapshot.revealNowVisible,
      schedulingControls: snapshot.schedulingControls,
      selectedContactsStepLabel: snapshot.selectedContactsStepLabel,
      sharedCapsuleVisible: snapshot.sharedCapsuleVisible,
      stepLabel: snapshot.stepLabel,
      titleText: snapshot.titleText,
      visibleButtons: snapshot.visibleButtons,
      visibleDateFields: snapshot.visibleDateFields,
      visibleInputs: snapshot.visibleInputs,
      visibleTimeFields: snapshot.visibleTimeFields,
      visibleText: snapshot.visibleText,
      validationMessages: snapshot.validationMessages
    });
  }

  private async configureRevealLaterSchedule(input: { futureOffsetMinutes: number }): Promise<InssaRevealLaterScheduleEvidence> {
    const scheduledAt = new Date(Date.now() + input.futureOffsetMinutes * 60_000);
    const intervalOption = await this.findRevealLaterIntervalOption();
    let chosenIntervalLabel: string | null = null;
    let dateTimeInputFilled = false;
    let dateInputFilled = false;
    let timeInputFilled = false;

    if (intervalOption) {
      chosenIntervalLabel = await intervalOption.innerText().catch(() => null);
      if (!(await this.locatorLooksSelected(intervalOption).catch(() => false))) {
        await intervalOption.click();
      }
    } else {
      dateTimeInputFilled = await this.fillFirstVisibleTemporalInput("input[type='datetime-local']", formatDateTimeLocal(scheduledAt));
      dateInputFilled = await this.fillFirstVisibleTemporalInput("input[type='date']", formatDateInput(scheduledAt));
      timeInputFilled = await this.fillFirstVisibleTemporalInput("input[type='time']", formatTimeInput(scheduledAt));
    }

    return {
      chosenIntervalLabel: chosenIntervalLabel?.replace(/\s+/g, " ").trim() ?? null,
      dateInputFilled,
      dateTimeInputFilled,
      scheduledAtIso: scheduledAt.toISOString(),
      scheduledAtText: await this.extractRevealLaterScheduleText(),
      timeInputFilled,
      visibleDateTimeControls: await this.listVisibleTemporalControls(),
      visibleScheduleButtons: (await this.listVisibleButtonLabels()).filter((label) =>
        /later|minute|min|hour|tomorrow|date|time|schedule/i.test(label)
      )
    };
  }

  private async findRevealLaterIntervalOption(): Promise<Locator | null> {
    const intervalPattern =
      /^(?:in\s*)?(?:5|10|15|30|45)\s*(?:min|mins|minute|minutes)$|^(?:in\s*)?1\s*(?:hr|hour)$|tomorrow/i;

    return await this.firstVisibleLocator([
      this.page.getByRole("radio", { name: intervalPattern }),
      this.page.getByRole("button", { name: intervalPattern }),
      this.page.getByRole("checkbox", { name: intervalPattern }),
      this.page.locator("[role='radio'], [role='checkbox'], button, label").filter({ hasText: intervalPattern })
    ]);
  }

  private async fillFirstVisibleTemporalInput(selector: string, value: string): Promise<boolean> {
    const input = this.page.locator(selector);
    const total = await input.count();
    for (let index = 0; index < total; index += 1) {
      const candidate = input.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      await candidate.fill(value);
      return true;
    }

    return false;
  }

  private async listVisibleInputDescriptors(): Promise<string[]> {
    return await this.page.locator("input, textarea, select").evaluateAll((elements) =>
      elements
        .filter((element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none";
        })
        .map((element) => {
          const type = element.getAttribute("type")?.trim() ?? "";
          const name = element.getAttribute("name")?.trim() ?? "";
          const ariaLabel = element.getAttribute("aria-label")?.trim() ?? "";
          const placeholder = element.getAttribute("placeholder")?.trim() ?? "";
          const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value?.trim() ?? "" : "";
          return [element.tagName.toLowerCase(), type, name, ariaLabel, placeholder, value ? "has-value" : ""].filter(Boolean).join(" | ");
        })
    );
  }

  private async listVisibleTemporalControls(): Promise<string[]> {
    return await this.page.locator("input, select").evaluateAll((elements) =>
      elements
        .filter((element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none";
        })
        .map((element) => {
          const type = element.getAttribute("type")?.trim() ?? "";
          const name = element.getAttribute("name")?.trim() ?? "";
          const ariaLabel = element.getAttribute("aria-label")?.trim() ?? "";
          const placeholder = element.getAttribute("placeholder")?.trim() ?? "";
          return [element.tagName.toLowerCase(), type, name, ariaLabel, placeholder].filter(Boolean).join(" | ");
        })
        .filter((descriptor) => /date|time|reveal|schedule/i.test(descriptor))
    );
  }

  private async extractRevealLaterScheduleText(): Promise<string | null> {
    const bodyText = await this.page.locator("body").innerText().catch(() => "");
    const line = bodyText
      .split(/\n+/)
      .map((value) => value.replace(/\s+/g, " ").trim())
      .find((value) => /reveal later|scheduled|schedule|tomorrow|\b(?:min|minute|hour|date|time)\b/i.test(value));

    return line ?? null;
  }

  async continueRevealSettingsOnce(): Promise<void> {
    await this.dismissBrowserSessionWarningIfPresent();
    const continueButton = this.page.getByRole("button", { name: INSSA_REVEAL_CONTINUE_PATTERN }).first();
    await expect(continueButton, 'Expected the Reveal settings modal to expose a visible "Continue" action.').toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await continueButton.click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async waitForLiveCapsuleShareLinkEvidence(): Promise<{
    followupClickedLabel: string | null;
    revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[];
    sendToContactsClicked: boolean;
    shareEvidence: InssaLiveCapsuleShareEvidence;
    shareDecisionStepReached: boolean;
    skipContactsClicked: boolean;
  }> {
    const revealSettingsSnapshots: InssaRevealSettingsModalSnapshot[] = [];
    let followupClickedLabel: string | null = null;
    let sendToContactsClicked = false;
    let shareDecisionStepReached = false;
    let skipContactsClicked = false;
    const deadline = Date.now() + POST_CONTINUE_SUCCESS_TIMEOUT;

    while (Date.now() < deadline) {
      const snapshot = await this.snapshotRevealSettingsModal();
      shareDecisionStepReached = shareDecisionStepReached || snapshot.contactShareDecisionVisible;
      const lastSnapshot = revealSettingsSnapshots[revealSettingsSnapshots.length - 1];
      if (!lastSnapshot || JSON.stringify(lastSnapshot) !== JSON.stringify(snapshot)) {
        revealSettingsSnapshots.push(snapshot);
      }

      const shareEvidence = await this.readLiveCapsuleShareEvidence();
      if (this.hasStrongLiveCapsuleShareEvidence(shareEvidence)) {
        return {
          followupClickedLabel,
          revealSettingsSnapshots,
          sendToContactsClicked,
          shareEvidence,
          shareDecisionStepReached,
          skipContactsClicked
        };
      }

      if (snapshot.contactShareDecisionVisible && !skipContactsClicked && !followupClickedLabel) {
        if (!snapshot.skipContactsShareLinkVisible) {
          throw new Error(
            `Expected Step 2 contact/share decision to expose a share-link finalization action. Visible buttons: ${snapshot.visibleButtons.join(
              ", "
            )}`
          );
        }

        followupClickedLabel = await this.chooseSkipContactsAndShareLink();
        skipContactsClicked = INSSA_SKIP_CONTACTS_SHARE_LINK_PATTERN.test(followupClickedLabel);
        sendToContactsClicked = false;
        await this.page.waitForLoadState("domcontentloaded").catch(() => {});
        continue;
      }

      if (snapshot.titleVisible && !followupClickedLabel) {
        const eligibleFollowups = Array.from(
          new Set(
            snapshot.safeFollowupLabels.filter((label) => {
              if (!this.isSafeRevealFollowupLabel(label)) {
                return false;
              }

              if (/^continue$/i.test(label) && snapshot.contactSelectionVisible) {
                return false;
              }

              return !INSSA_REVEAL_CANCEL_PATTERN.test(label);
            })
          )
        ).sort((left, right) => {
          const priority = (value: string) => {
            if (/^share by link$/i.test(value)) return 0;
            if (/^skip contacts(?:\s*&\s*share link with others)?$/i.test(value)) return 1;
            if (/^bury\s*&\s*share link with others$/i.test(value)) return 1;
            if (/^done$/i.test(value)) return 2;
            if (/^continue$/i.test(value)) return 3;
            return 4;
          };
          return priority(left) - priority(right);
        });

        if (eligibleFollowups.length > 1) {
          throw new Error(
            `Reveal settings exposed multiple possible follow-up actions after Continue: ${eligibleFollowups.join(", ")}.`
          );
        }

        if (eligibleFollowups.length === 1) {
          followupClickedLabel = eligibleFollowups[0];
          await this.dismissBrowserSessionWarningIfPresent();
          await this.clickLiveCreateActionOnce(followupClickedLabel);
          skipContactsClicked = INSSA_SKIP_CONTACTS_SHARE_LINK_PATTERN.test(followupClickedLabel);
          sendToContactsClicked = INSSA_SEND_SELECTED_CONTACTS_PATTERN.test(followupClickedLabel);
          await this.page.waitForLoadState("domcontentloaded").catch(() => {});
          continue;
        }
      }

      await this.page.waitForTimeout(250);
    }

    const finalSnapshot = revealSettingsSnapshots[revealSettingsSnapshots.length - 1] ?? (await this.snapshotRevealSettingsModal());
    throw new Error(
      `Expected live capsule creation to expose share-link evidence after Reveal settings. Final snapshot: titleVisible=${
        finalSnapshot.titleVisible
      }, contactShareDecisionVisible=${finalSnapshot.contactShareDecisionVisible}, step="${
        finalSnapshot.selectedContactsStepLabel ?? finalSnapshot.stepLabel ?? "unknown"
      }", visibleButtons=${finalSnapshot.visibleButtons.join(", ")}`
    );
  }

  async waitForContactShareDecisionStep(): Promise<InssaRevealSettingsModalSnapshot> {
    const deadline = Date.now() + DEFAULT_TIMEOUT;
    let lastSnapshot: InssaRevealSettingsModalSnapshot | null = null;

    while (Date.now() < deadline) {
      const snapshot = await this.snapshotRevealSettingsModal();
      lastSnapshot = snapshot;
      if (snapshot.contactShareDecisionVisible && snapshot.skipContactsShareLinkVisible) {
        return snapshot;
      }

      await this.page.waitForTimeout(250);
    }

    throw new Error(
      `Expected Reveal settings Step 2 of 2 contact/share decision. Last visible buttons: ${
        lastSnapshot?.visibleButtons.join(", ") ?? "none"
      }`
    );
  }

  async chooseSkipContactsAndShareLink(): Promise<string> {
    await this.waitForContactShareDecisionStep();
    const buttons = this.page.getByRole("button", { name: INSSA_SHARE_LINK_WITH_OTHERS_PATTERN });
    const visibleIndexes: number[] = [];
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      if (await buttons.nth(index).isVisible().catch(() => false)) {
        visibleIndexes.push(index);
      }
    }

    if (visibleIndexes.length !== 1) {
      const snapshot = await this.snapshotRevealSettingsModal();
      throw new Error(
        `Expected exactly one share-link finalization action. Found ${visibleIndexes.length}. Visible buttons: ${snapshot.visibleButtons.join(
          ", "
        )}`
      );
    }

    const button = buttons.nth(visibleIndexes[0]);
    const label = (await button.innerText().catch(() => "")) || "share link with others";
    await button.click();
    return label.replace(/\s+/g, " ").trim();
  }

  private isSafeRevealFollowupLabel(label: string): boolean {
    return INSSA_SAFE_REVEAL_FOLLOWUP_PATTERN.test(label) || INSSA_SHARE_LINK_WITH_OTHERS_PATTERN.test(label);
  }

  async readLiveCapsuleShareEvidence(): Promise<InssaLiveCapsuleShareEvidence> {
    const visibleButtons = await this.listVisibleButtonLabels();
    const bodyText = await this.page.locator("body").innerText().catch(() => "");
    const finalShareLink = extractVisibleShareLink(bodyText) ?? (await this.readVisibleShareLinkFromDom());
    const urlCandidate = /\/capsule\//i.test(this.page.url()) ? this.page.url() : null;
    const shareUrl = finalShareLink ?? urlCandidate;
    const copyShareLinkVisible = await this.isCopyShareLinkVisible();
    const shareLinkButtonVisible = await this.isShareLinkButtonVisible();
    const homeVisible = await this.isHomeVisible();
    const visibleSuccessText = extractVisibleSuccessText(bodyText);

    return {
      copyShareLinkVisible,
      finalShareLink: shareUrl,
      homeVisible,
      possibleFinalCapsuleId: extractCapsuleIdFromCandidate(shareUrl ?? this.page.url()),
      possibleShareToken: extractShareTokenFromCandidate(shareUrl ?? this.page.url()),
      shareLinkButtonVisible,
      successSignals: [
        ...(shareUrl ? [`share-link=${shareUrl}`] : []),
        ...(copyShareLinkVisible ? ["copy-share-link-visible"] : []),
        ...(shareLinkButtonVisible ? ["share-link-button-visible"] : []),
        ...(homeVisible ? ["home-button-visible"] : []),
        ...(visibleSuccessText ? [`visible-success=${visibleSuccessText}`] : [])
      ],
      visibleButtons,
      visibleSuccessText
    };
  }

  private hasStrongLiveCapsuleShareEvidence(shareEvidence: InssaLiveCapsuleShareEvidence): boolean {
    return (
      shareEvidence.copyShareLinkVisible ||
      shareEvidence.shareLinkButtonVisible ||
      shareEvidence.homeVisible ||
      Boolean(shareEvidence.finalShareLink) ||
      Boolean(shareEvidence.possibleFinalCapsuleId) ||
      Boolean(shareEvidence.possibleShareToken) ||
      Boolean(shareEvidence.visibleSuccessText)
    );
  }

  private async isCopyShareLinkVisible(): Promise<boolean> {
    return (
      (await this.page.getByRole("button", { name: INSSA_COPY_SHARE_LINK_PATTERN }).first().isVisible().catch(() => false)) ||
      (await this.page.getByText(INSSA_COPY_SHARE_LINK_PATTERN).first().isVisible().catch(() => false))
    );
  }

  private async isShareLinkButtonVisible(): Promise<boolean> {
    return (
      (await this.page.getByRole("button", { name: INSSA_SHARE_LINK_BUTTON_PATTERN }).first().isVisible().catch(() => false)) ||
      (await this.page.getByText(INSSA_SHARE_LINK_BUTTON_PATTERN).first().isVisible().catch(() => false))
    );
  }

  private async isHomeVisible(): Promise<boolean> {
    return (
      (await this.page.getByRole("button", { name: INSSA_HOME_BUTTON_PATTERN }).first().isVisible().catch(() => false)) ||
      (await this.page.getByText(INSSA_HOME_BUTTON_PATTERN).first().isVisible().catch(() => false))
    );
  }

  private async readVisibleShareLinkFromDom(): Promise<string | null> {
    return await this.page.locator("a[href], input, textarea, [role='link'], button, p, span, div").evaluateAll((elements, patternSource) => {
      const pattern = new RegExp(patternSource, "i");

      for (const element of elements) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }

        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") {
          continue;
        }

        const candidateValues = [
          element instanceof HTMLAnchorElement ? element.href : "",
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "",
          element.innerText ?? "",
          element.textContent ?? ""
        ]
          .map((value) => value.trim())
          .filter(Boolean);

        const match = candidateValues.map((value) => value.match(pattern)?.[0] ?? "").find(Boolean);
        if (match) {
          return match;
        }
      }

      return null;
    }, INSSA_CAPSULE_SHARE_LINK_PATTERN.source);
  }

  async clickLiveCreateActionOnce(label: string): Promise<void> {
    const button = this.page.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") }).first();
    await expect(button, `Expected the final live create action "${label}" to be visible before clicking.`).toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await button.click();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async discardDraft(): Promise<void> {
    await expect(this.discardDraftButton(), "Expected Discard draft to be visible before cleanup.").toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });

    const nativeDialog = this.page.waitForEvent("dialog", { timeout: 1_000 }).catch(() => null);
    await this.discardDraftButton().click();

    const dialog = await nativeDialog;
    if (dialog) {
      await dialog.accept();
      await this.page.waitForLoadState("domcontentloaded").catch(() => {});
      return;
    }

    const dialogRoot = this.page.locator("[role='dialog'], [aria-modal='true']").last();
    const confirmButton = dialogRoot
      .locator("button")
      .filter({ hasText: /^discard draft$|discard|delete|remove|confirm|yes/i })
      .first();

    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }

    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  subjectField(): Locator {
    return this.page.locator("input[type='text']").first();
  }

  messageField(): Locator {
    return this.page.locator("textarea:not([name='g-recaptcha-response'])").first();
  }

  discardDraftButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_DISCARD_DRAFT_PATTERN }).first();
  }

  saveAndExitButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_SAVE_EXIT_PATTERN }).first();
  }

  nextStepButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_NEXT_STEP_PATTERN }).first();
  }

  remoteImageUrlField(): Locator {
    return this.page
      .locator(
        "input[placeholder*='url' i], input[placeholder*='link' i], input[placeholder*='image' i], textarea[placeholder*='url' i], textarea[placeholder*='link' i], input[aria-label*='url' i], input[aria-label*='link' i], input[aria-label*='image' i], textarea[aria-label*='url' i], textarea[aria-label*='link' i], textarea[aria-label*='image' i], input[name*='url' i], input[name*='link' i], input[name*='image' i], textarea[name*='url' i], textarea[name*='link' i], textarea[name*='image' i]"
      )
      .first();
  }

  deleteCapsuleButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_DELETE_CAPSULE_PATTERN }).first();
  }

  archiveCapsuleButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_ARCHIVE_CAPSULE_PATTERN }).first();
  }

  hideCapsuleButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_HIDE_CAPSULE_PATTERN }).first();
  }

  editCapsuleButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_EDIT_CAPSULE_PATTERN }).first();
  }

  publishCapsuleButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_PUBLISH_CAPSULE_PATTERN }).first();
  }

  unpublishCapsuleButton(): Locator {
    return this.page.getByRole("button", { name: INSSA_UNPUBLISH_CAPSULE_PATTERN }).first();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractVisibleSuccessText(bodyText: string): string | null {
  const match = bodyText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(
      (line) =>
        line &&
        !/automated playwright test|qa_live_|qa live|QA_LIVE_/i.test(line) &&
        !/^\s*(subject|message)\s*:/i.test(line)
    )
    .join("\n")
    .match(
      /capsule (?:created|ready|shared|buried)|your capsule (?:is )?(?:ready|live|created)|ready to share|successfully (?:created|shared|buried)|created|success/i
    );
  return match?.[0] ?? null;
}

function extractVisibleShareLink(bodyText: string): string | null {
  const match = bodyText.match(INSSA_CAPSULE_SHARE_LINK_PATTERN);
  return match?.[0] ?? null;
}

function extractValidationMessages(bodyText: string): string[] {
  return Array.from(
    new Set(
      bodyText
        .split(/\n+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => /required|invalid|select|choose|missing|enter|must|error/i.test(line))
    )
  );
}

function extractCapsuleIdFromCandidate(candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }

  const match = candidate.match(/\/capsule\/([A-Za-z0-9_-]{6,})/i);
  return match?.[1] ?? null;
}

function extractShareTokenFromCandidate(candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }

  const match = candidate.match(/[?&]token=([^&\s]+)/i);
  return match?.[1] ?? null;
}

function formatDateTimeLocal(value: Date): string {
  return `${formatDateInput(value)}T${formatTimeInput(value)}`;
}

function formatDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeInput(value: Date): string {
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
