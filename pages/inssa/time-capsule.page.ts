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
const INSSA_CONTACT_SELECTION_CURRENT_TITLE_PATTERN = /send or save/i;
const INSSA_CONTACT_SHARE_DECISION_STEP_PATTERN = /\b\d+\s+selected\s*[·•-]?\s*step\s*2\s*of\s*2|step\s*2\s*of\s*2/i;
const INSSA_SEND_SELECTED_CONTACTS_PATTERN = /^send to selected contacts\s*&\s*bury$/i;
const INSSA_SELECT_ALL_CONTACTS_PATTERN = /^select all$/i;
const INSSA_BURY_THEN_CHOOSE_SHARE_PATTERN =
  /^bury,\s*(?:then choose who to share with|send to \d+ contacts?, then share more)$/i;
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
  mediaControls: string[];
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
  contactCount: number | null;
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
  selectedContactsCount: number | null;
  sendToContactsVisible: boolean;
  shareLinkButtonVisible: boolean;
  sharedCapsuleVisible: boolean;
  skipContactsShareLinkVisible: boolean;
  stepLabel: string | null;
  stepTitle: string | null;
  titleText: string | null;
  titleVisible: boolean;
  visibleButtons: string[];
  visibleContacts: string[];
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

export type InssaContactSelectionDiagnostic = {
  afterSnapshot: InssaRevealSettingsModalSnapshot;
  beforeSnapshot: InssaRevealSettingsModalSnapshot;
  selectedContactLabel: string;
  selectedCountChanged: boolean;
  targetIdentityVerified: boolean;
  visibleButtonsChanged: boolean;
};

export type InssaExactContactSelection = InssaContactSelectionDiagnostic & {
  selectedRowCount: number;
  selectedRowVerified: boolean;
};

export type InssaRevealLaterScheduleEvidence = {
  chosenIntervalLabel: string | null;
  dateInputFilled: boolean;
  dateTimeInputFilled: boolean;
  scheduledAtIso: string | null;
  scheduledAtText: string | null;
  textDateTimeInputFilled: boolean;
  timeInputFilled: boolean;
  visibleDateTimeControls: string[];
  visibleScheduleButtons: string[];
};

export type InssaRevealTimestampCandidate = {
  context: string;
  normalizedIso: string | null;
  source: "dom-hidden-input" | "dom-visible-input" | "network" | "session-storage" | "local-storage" | "visible-text";
  value: string;
};

export type InssaRevealTimestampEvidence = {
  candidateTimestamps: InssaRevealTimestampCandidate[];
  hiddenSchedulingValues: string[];
  localStorageCandidates: InssaRevealTimestampCandidate[];
  networkCandidates: InssaRevealTimestampCandidate[];
  scheduledAtIso: string | null;
  selectedDateText: string | null;
  selectedTimeText: string | null;
  sessionStorageCandidates: InssaRevealTimestampCandidate[];
  source: string | null;
  visibleSchedulingControls: string[];
  visibleSchedulingValues: string[];
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
  timestampEvidence: InssaRevealTimestampEvidence;
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
    await expect
      .poll(
        async () => {
          const snapshot = await this.snapshotComposeStepState();
          return this.isMediaStepContentReady(snapshot);
        },
        {
          timeout: DEFAULT_TIMEOUT,
          message: "Expected the compose flow to expose Step 2 media content."
        }
      )
      .toBe(true);
  }

  async advanceToShareStep(): Promise<void> {
    const currentSnapshot = await this.snapshotComposeStepState();
    if (this.isCurrentCombinedMediaBuryStep(currentSnapshot)) {
      return;
    }

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
    await expect
      .poll(
        async () => {
          const snapshot = await this.snapshotComposeStepState();
          return this.isShareStep(snapshot) || this.isCurrentCombinedMediaBuryStep(snapshot);
        },
        {
          timeout: DEFAULT_TIMEOUT,
          message:
            "Expected the compose flow to expose Step 3: Share or the current Step 2 Add media & bury finalization surface."
        }
      )
      .toBe(true);
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
    const mediaControls = await this.listVisibleMediaControlLabels();

    return {
      candidateFinalActionLabels,
      currentUrl: this.page.url(),
      finalActionLabel,
      mediaControls,
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
      mediaControls: snapshot.mediaControls,
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
    return INSSA_COMPOSE_STEP_MEDIA_PATTERN.test(snapshot.step ?? "") || snapshot.mediaControls.length > 0;
  }

  private async listVisibleMediaControlLabels(): Promise<string[]> {
    const candidates = [
      { label: "Photo", pattern: /^photo$/i },
      { label: "Video", pattern: /^video$/i },
      { label: "Gallery", pattern: /^gallery$/i }
    ];
    const labels: string[] = [];

    for (const candidate of candidates) {
      if (await this.page.getByRole("button", { name: candidate.pattern }).first().isVisible().catch(() => false)) {
        labels.push(candidate.label);
      }
    }

    return labels;
  }

  private isShareStep(snapshot: InssaComposeStepSnapshot): boolean {
    return INSSA_COMPOSE_STEP_SHARE_PATTERN.test(snapshot.step ?? "");
  }

  private isMediaStepContentReady(snapshot: InssaComposeStepSnapshot): boolean {
    return (
      this.isMediaStep(snapshot) &&
      (Boolean(snapshot.mediaSelectedSummaryText) ||
        snapshot.mediaControls.length > 0)
    );
  }

  private isCurrentCombinedMediaBuryStep(snapshot: InssaComposeStepSnapshot): boolean {
    return (
      this.isMediaStepContentReady(snapshot) &&
      /^bury$/i.test(snapshot.finalActionLabel ?? "") &&
      !snapshot.nextStepVisible
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
      }". Media controls: ${failedSnapshot?.mediaControls.join(", ") ?? ""}. Selected summary: ${
        failedSnapshot?.mediaSelectedSummaryText ?? "none"
      }. Visible buttons: ${failedSnapshot?.visibleButtons.join(", ") ?? ""}`,
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
      this.page.getByRole("button", { name: INSSA_BROWSER_SESSION_WARNING_DISMISS_PATTERN }),
      this.page.getByText(INSSA_BROWSER_SESSION_WARNING_DISMISS_PATTERN).first()
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
    const stepTitle =
      bodyText
        .split(/\n+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .find((line) => INSSA_CONTACT_SELECTION_CURRENT_TITLE_PATTERN.test(line) || INSSA_CONTACT_SHARE_DECISION_TITLE_PATTERN.test(line)) ??
      titleText;
    const selectedContactsCount = selectedContactsStepLabel
      ? Number(selectedContactsStepLabel.match(/\b(\d+)\s+selected\b/i)?.[1] ?? "")
      : null;
    const visibleContacts = extractVisibleContactLabels(bodyText);
    const totalContactCount = Number(bodyText.match(/\b\d+\s+of\s+(\d+)\s+contacts?\s+selected\b/i)?.[1] ?? "");
    const currentContactSelectionVisible =
      Boolean(selectedContactsStepLabel) ||
      Boolean(stepTitle && INSSA_CONTACT_SELECTION_CURRENT_TITLE_PATTERN.test(stepTitle)) ||
      visibleInputs.some((descriptor) => /search by name or email|search/i.test(descriptor)) ||
      visibleButtons.some((label) => INSSA_SELECT_ALL_CONTACTS_PATTERN.test(label)) ||
      visibleButtons.some((label) => INSSA_BURY_THEN_CHOOSE_SHARE_PATTERN.test(label)) ||
      visibleContacts.length > 0;
    const contactShareDecisionVisible =
      (await this.page.getByText(INSSA_CONTACT_SHARE_DECISION_TITLE_PATTERN).first().isVisible().catch(() => false)) ||
      currentContactSelectionVisible;
    const copyShareLinkVisible = await this.isCopyShareLinkVisible();
    const shareLinkButtonVisible = await this.isShareLinkButtonVisible();
    const homeVisible = await this.isHomeVisible();
    const schedulingControls = [
      ...(await this.listVisibleTemporalControls()),
      ...visibleButtons.filter((label) => /later|minute|min|hour|tomorrow|date|time|schedule|reveal/i.test(label))
    ];
    const contactControls = [
      ...visibleButtons.filter((label) =>
        /contacts?|selected|select all|people|friends|shared capsule|personal memory|share link|send or save|choose who to share|bury,\s*then/i.test(
          label
        )
      ),
      ...visibleInputs.filter((descriptor) => /contacts?|people|friends|recipient|search/i.test(descriptor))
    ];

    return {
      browserSessionWarningDismissed,
      cancelVisible: await this.page.getByRole("button", { name: INSSA_REVEAL_CANCEL_PATTERN }).first().isVisible().catch(() => false),
      contactShareDecisionVisible,
      contactSelectionVisible:
        currentContactSelectionVisible ||
        (await this.page.getByText(INSSA_CONTACT_SELECTION_PATTERN).first().isVisible().catch(() => false)),
      contactCount: Number.isFinite(totalContactCount) ? totalContactCount : visibleContacts.length,
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
      selectedContactsCount: Number.isFinite(selectedContactsCount) ? selectedContactsCount : null,
      sendToContactsVisible: visibleButtons.some((label) => INSSA_SEND_SELECTED_CONTACTS_PATTERN.test(label)),
      shareLinkButtonVisible: copyShareLinkVisible || shareLinkButtonVisible,
      sharedCapsuleVisible: await this.page.getByText(INSSA_SHARED_CAPSULE_PATTERN).first().isVisible().catch(() => false),
      skipContactsShareLinkVisible: visibleButtons.some((label) => INSSA_SHARE_LINK_WITH_OTHERS_PATTERN.test(label)),
      stepLabel,
      stepTitle,
      titleText,
      titleVisible,
      visibleButtons,
      visibleContacts,
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
    const futureOffsetMinutes = input.futureOffsetMinutes ?? 24 * 60;
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
    const scheduledAt = new Date(Date.now() + futureOffsetMinutes * 60_000);
    let configuredSchedule = await this.configureRevealLaterSchedule({ scheduledAt });
    const timestampEvidence = await this.readRevealTimestampEvidence();
    if (timestampEvidence.scheduledAtIso && !configuredSchedule.scheduledAtIso) {
      configuredSchedule = {
        ...configuredSchedule,
        scheduledAtIso: timestampEvidence.scheduledAtIso
      };
    }
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
    let schedule = this.buildRevealLaterScheduleEvidenceFromSnapshots({
      step1Snapshot,
      stepTwoSnapshot
    });
    schedule = {
      ...schedule,
      ...configuredSchedule,
      visibleDateTimeControls: Array.from(
        new Set([...schedule.visibleDateTimeControls, ...configuredSchedule.visibleDateTimeControls])
      ),
      visibleScheduleButtons: Array.from(new Set([...schedule.visibleScheduleButtons, ...configuredSchedule.visibleScheduleButtons]))
    };

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
      stepTwoSnapshot,
      timestampEvidence
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
      textDateTimeInputFilled: false,
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
      contactCount: snapshot.contactCount,
      personalMemoryVisible: snapshot.personalMemoryVisible,
      revealLaterVisible: snapshot.revealLaterVisible,
      revealNowVisible: snapshot.revealNowVisible,
      schedulingControls: snapshot.schedulingControls,
      selectedContactsStepLabel: snapshot.selectedContactsStepLabel,
      selectedContactsCount: snapshot.selectedContactsCount,
      sharedCapsuleVisible: snapshot.sharedCapsuleVisible,
      stepLabel: snapshot.stepLabel,
      stepTitle: snapshot.stepTitle,
      titleText: snapshot.titleText,
      visibleButtons: snapshot.visibleButtons,
      visibleContacts: snapshot.visibleContacts,
      visibleDateFields: snapshot.visibleDateFields,
      visibleInputs: snapshot.visibleInputs,
      visibleTimeFields: snapshot.visibleTimeFields,
      visibleText: snapshot.visibleText,
      validationMessages: snapshot.validationMessages
    });
  }

  private async configureRevealLaterSchedule(input: { scheduledAt: Date }): Promise<InssaRevealLaterScheduleEvidence> {
    const scheduledAt = input.scheduledAt;
    const intervalOption = await this.findRevealLaterIntervalOption();
    let chosenIntervalLabel: string | null = null;
    let dateTimeInputFilled = false;
    let dateInputFilled = false;
    let textDateTimeInputFilled = false;
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
      if (!dateTimeInputFilled && !dateInputFilled && !timeInputFilled) {
        textDateTimeInputFilled = await this.fillFirstVisibleTemporalTextInput(formatUsDateTimeInput(scheduledAt));
      }
    }

    return {
      chosenIntervalLabel: chosenIntervalLabel?.replace(/\s+/g, " ").trim() ?? null,
      dateInputFilled,
      dateTimeInputFilled,
      scheduledAtIso: chosenIntervalLabel || dateTimeInputFilled || dateInputFilled || timeInputFilled || textDateTimeInputFilled
        ? scheduledAt.toISOString()
        : null,
      scheduledAtText: await this.extractRevealLaterScheduleText(),
      textDateTimeInputFilled,
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

  private async fillFirstVisibleTemporalTextInput(value: string): Promise<boolean> {
    const input = this.page.locator("input, textarea");
    const total = await input.count();
    for (let index = 0; index < total; index += 1) {
      const candidate = input.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      const descriptor = await candidate
        .evaluate((element) => {
          const type = element.getAttribute("type")?.trim() ?? "";
          const name = element.getAttribute("name")?.trim() ?? "";
          const ariaLabel = element.getAttribute("aria-label")?.trim() ?? "";
          const placeholder = element.getAttribute("placeholder")?.trim() ?? "";
          return [element.tagName.toLowerCase(), type, name, ariaLabel, placeholder].filter(Boolean).join(" | ");
        })
        .catch(() => "");
      if (!/MM\/DD\/YYYY|date|time|reveal|schedule/i.test(descriptor)) {
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
          const temporalValue = /MM\/DD\/YYYY|date|time|reveal|schedule/i.test([type, name, ariaLabel, placeholder].join(" "))
            ? value
            : "";
          return [
            element.tagName.toLowerCase(),
            type,
            name,
            ariaLabel,
            placeholder,
            temporalValue ? `value=${temporalValue}` : value ? "has-value" : ""
          ]
            .filter(Boolean)
            .join(" | ");
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
          const value = element instanceof HTMLInputElement ? element.value?.trim() ?? "" : "";
          return [element.tagName.toLowerCase(), type, name, ariaLabel, placeholder, value ? `value=${value}` : ""]
            .filter(Boolean)
            .join(" | ");
        })
        .filter((descriptor) => /date|time|reveal|schedule/i.test(descriptor))
    );
  }

  async readRevealTimestampEvidence(input: { networkPayloads?: string[] } = {}): Promise<InssaRevealTimestampEvidence> {
    const visibleSchedulingControls = await this.listVisibleTemporalControls();
    const bodyText = await this.page.locator("body").innerText().catch(() => "");
    const visibleTextCandidates = collectRevealTimestampCandidates("visible-text", bodyText, "body");
    const inputValues = await this.page.locator("input, textarea, select").evaluateAll((elements) =>
      elements
        .filter((element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
        .map((element) => {
          const htmlElement = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          const style = window.getComputedStyle(htmlElement);
          const visible = style.visibility !== "hidden" && style.display !== "none";
          const type = htmlElement.getAttribute("type")?.trim() ?? "";
          const name = htmlElement.getAttribute("name")?.trim() ?? "";
          const ariaLabel = htmlElement.getAttribute("aria-label")?.trim() ?? "";
          const placeholder = htmlElement.getAttribute("placeholder")?.trim() ?? "";
          return {
            descriptor: [htmlElement.tagName.toLowerCase(), type, name, ariaLabel, placeholder].filter(Boolean).join(" | "),
            value: htmlElement.value?.trim() ?? "",
            visible
          };
        })
        .filter((entry) => /reveal|schedule|date|time|MM\/DD\/YYYY/i.test(`${entry.descriptor} ${entry.value}`))
    );
    const storage = await this.page.evaluate(() => {
      const collect = (store: Storage) => {
        const entries: Array<{ key: string; value: string }> = [];
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index) ?? "";
          const value = store.getItem(key) ?? "";
          if (/reveal|schedule|date|time|capsule|draft/i.test(`${key} ${value}`)) {
            entries.push({ key, value });
          }
        }
        return entries;
      };

      return {
        localStorage: collect(window.localStorage),
        sessionStorage: collect(window.sessionStorage)
      };
    });

    const visibleSchedulingValues = inputValues
      .filter((entry) => entry.visible && entry.value)
      .map((entry) => `${entry.descriptor} = ${entry.value}`);
    const hiddenSchedulingValues = inputValues
      .filter((entry) => !entry.visible && entry.value)
      .map((entry) => `${entry.descriptor} = ${entry.value}`);
    const domCandidates = inputValues.flatMap((entry) =>
      collectRevealTimestampCandidates(entry.visible ? "dom-visible-input" : "dom-hidden-input", entry.value, entry.descriptor)
    );
    const localStorageCandidates = storage.localStorage.flatMap((entry) =>
      collectRevealTimestampCandidates("local-storage", entry.value, entry.key)
    );
    const sessionStorageCandidates = storage.sessionStorage.flatMap((entry) =>
      collectRevealTimestampCandidates("session-storage", entry.value, entry.key)
    );
    const networkCandidates = (input.networkPayloads ?? []).flatMap((payload, index) =>
      collectRevealTimestampCandidates("network", payload, `payload-${index + 1}`)
    );
    const candidateTimestamps = [
      ...domCandidates,
      ...visibleTextCandidates,
      ...localStorageCandidates,
      ...sessionStorageCandidates,
      ...networkCandidates
    ];
    const strongestCandidate =
      candidateTimestamps.find(
        (candidate) =>
          candidate.normalizedIso &&
          candidate.source === "network" &&
          /revealDate|scheduledAt|scheduledFor|deliverAt|deliveryAt|availableAt|unlockAt|opensAt/i.test(candidate.context)
      ) ??
      candidateTimestamps.find((candidate) => candidate.normalizedIso && candidate.source === "dom-visible-input") ??
      candidateTimestamps.find((candidate) => candidate.normalizedIso && candidate.source === "visible-text") ??
      candidateTimestamps.find((candidate) => candidate.normalizedIso && candidate.source === "network") ??
      candidateTimestamps.find((candidate) => candidate.normalizedIso) ??
      null;

    return {
      candidateTimestamps,
      hiddenSchedulingValues,
      localStorageCandidates,
      networkCandidates,
      scheduledAtIso: strongestCandidate?.normalizedIso ?? null,
      selectedDateText: extractSelectedDateText(bodyText, visibleSchedulingValues),
      selectedTimeText: extractSelectedTimeText(bodyText, visibleSchedulingValues),
      sessionStorageCandidates,
      source: strongestCandidate ? `${strongestCandidate.source}:${strongestCandidate.context}` : null,
      visibleSchedulingControls,
      visibleSchedulingValues
    };
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
            `Expected Step 2 contact/share decision to expose a share-link finalization action. ` +
              `The current product UI appears to require contact handling before share-link generation. ` +
              `Step title="${snapshot.stepTitle ?? "unknown"}", step="${snapshot.selectedContactsStepLabel ?? snapshot.stepLabel ?? "unknown"}", ` +
              `selectedContacts=${snapshot.selectedContactsCount ?? "unknown"}, contactCount=${snapshot.contactCount ?? "unknown"}, ` +
              `visibleContacts=${snapshot.visibleContacts.join(", ") || "none"}, ` +
              `visibleInputs=${snapshot.visibleInputs.join(", ") || "none"}, ` +
              `visibleButtons=${snapshot.visibleButtons.join(", ") || "none"}`
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
      }", stepTitle="${finalSnapshot.stepTitle ?? "unknown"}", selectedContacts=${
        finalSnapshot.selectedContactsCount ?? "unknown"
      }, contactCount=${finalSnapshot.contactCount ?? "unknown"}, visibleContacts=${
        finalSnapshot.visibleContacts.join(", ") || "none"
      }, visibleInputs=${finalSnapshot.visibleInputs.join(", ") || "none"}, visibleButtons=${finalSnapshot.visibleButtons.join(", ")}`
    );
  }

  async waitForContactShareDecisionStep(): Promise<InssaRevealSettingsModalSnapshot> {
    const deadline = Date.now() + DEFAULT_TIMEOUT;
    let lastSnapshot: InssaRevealSettingsModalSnapshot | null = null;

    while (Date.now() < deadline) {
      const snapshot = await this.snapshotRevealSettingsModal();
      lastSnapshot = snapshot;
      if (snapshot.contactShareDecisionVisible) {
        return snapshot;
      }

      await this.page.waitForTimeout(250);
    }

    throw new Error(
      `Expected Reveal settings Step 2 of 2 contact/share decision. Last visible buttons: ${
        lastSnapshot?.visibleButtons.join(", ") ?? "none"
      }. Last visible inputs: ${lastSnapshot?.visibleInputs.join(", ") ?? "none"}. Last visible contacts: ${
        lastSnapshot?.visibleContacts.join(", ") ?? "none"
      }`
    );
  }

  async selectFirstVisibleContactForDiagnostic(input: { targetLabelPattern?: RegExp } = {}): Promise<InssaContactSelectionDiagnostic> {
    const beforeSnapshot = await this.waitForContactListReadyForDiagnostic();
    if (beforeSnapshot.selectedContactsCount !== 0) {
      throw new Error(
        `Expected contact-share selection to begin at 0 selected; observed ${beforeSnapshot.selectedContactsCount ?? "unknown"}.`
      );
    }
    const bodyText = await this.page.locator("body").innerText().catch(() => "");
    const rawContactLabels = extractVisibleContactLabels(bodyText, { maskEmails: false });
    const selectableLabels = input.targetLabelPattern
      ? rawContactLabels.filter((label) => input.targetLabelPattern?.test(label))
      : rawContactLabels;

    if (selectableLabels.length === 0) {
      throw new Error(
        `Expected at least one selectable contact row${
          input.targetLabelPattern ? ` matching ${input.targetLabelPattern}` : ""
        } before contact-share finalization. ` +
          `Step title="${beforeSnapshot.stepTitle ?? "unknown"}", step="${
            beforeSnapshot.selectedContactsStepLabel ?? beforeSnapshot.stepLabel ?? "unknown"
          }", visibleContacts=${beforeSnapshot.visibleContacts.join(", ") || "none"}, ` +
          `visibleInputs=${beforeSnapshot.visibleInputs.join(", ") || "none"}, ` +
          `visibleButtons=${beforeSnapshot.visibleButtons.join(", ") || "none"}`
      );
    }

    let selectedRawLabel: string | null = null;
    let selectedLocator: Locator | null = null;
    for (const rawLabel of selectableLabels) {
      const locator = await this.findVisibleContactSelectionLocator(rawLabel);
      if (locator) {
        selectedRawLabel = rawLabel;
        selectedLocator = locator;
        break;
      }
    }

    if (!selectedRawLabel || !selectedLocator) {
      throw new Error(
        `Expected exactly one visible contact to be selectable, but no safe contact locator was found. ` +
          `Visible contacts=${beforeSnapshot.visibleContacts.join(", ") || "none"}, ` +
          `visibleInputs=${beforeSnapshot.visibleInputs.join(", ") || "none"}, ` +
          `visibleButtons=${beforeSnapshot.visibleButtons.join(", ") || "none"}`
      );
    }

    await selectedLocator.click();
    await expect
      .poll(
        async () => {
          const snapshot = await this.snapshotRevealSettingsModal();
          return snapshot.selectedContactsCount;
        },
        {
          timeout: DEFAULT_TIMEOUT,
          message: "Expected selecting one contact to update the selected contact count before finalization."
        }
      )
      .toBe(1);

    const afterSnapshot = await this.snapshotRevealSettingsModal();
    const selectedCountChanged = beforeSnapshot.selectedContactsCount !== afterSnapshot.selectedContactsCount;
    const visibleButtonsChanged = beforeSnapshot.visibleButtons.join("\n") !== afterSnapshot.visibleButtons.join("\n");

    return {
      afterSnapshot,
      beforeSnapshot,
      selectedContactLabel: maskContactDiagnostic(selectedRawLabel),
      selectedCountChanged,
      targetIdentityVerified: input.targetLabelPattern ? regexMatches(input.targetLabelPattern, selectedRawLabel) : true,
      visibleButtonsChanged
    };
  }

  async selectExactContactForLifecycle(targetEmail: string): Promise<InssaExactContactSelection> {
    const normalizedEmail = normalizeContactEmail(targetEmail);
    if (!normalizedEmail) {
      throw new Error("Expected a valid approved contact email before lifecycle contact selection.");
    }

    const beforeSnapshot = await this.waitForContactListReadyForDiagnostic();
    if (!/send or save/i.test(beforeSnapshot.stepTitle ?? "")) {
      throw new Error(
        `Expected the current contact-selection title to be "Send or save"; observed "${beforeSnapshot.stepTitle ?? "unknown"}".`
      );
    }
    if (!/step\s*2\s*of\s*2/i.test(beforeSnapshot.selectedContactsStepLabel ?? beforeSnapshot.stepLabel ?? "")) {
      throw new Error(
        `Expected lifecycle contact selection to be on Step 2 of 2; observed "${
          beforeSnapshot.selectedContactsStepLabel ?? beforeSnapshot.stepLabel ?? "unknown"
        }".`
      );
    }
    if (beforeSnapshot.selectedContactsCount !== 0) {
      throw new Error(
        `Expected lifecycle contact selection to begin at 0 selected; observed ${
          beforeSnapshot.selectedContactsCount ?? "unknown"
        }.`
      );
    }

    const initialRow = await this.findUniqueExactContactRow(normalizedEmail);
    await expect(initialRow, `Expected exact contact row ${maskContactDiagnostic(normalizedEmail)} to be visible.`).toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await expect(initialRow, `Expected exact contact row ${maskContactDiagnostic(normalizedEmail)} to be enabled.`).toBeEnabled({
      timeout: DEFAULT_TIMEOUT
    });

    let clickCompleted = false;
    for (let attempt = 0; attempt < 2 && !clickCompleted; attempt += 1) {
      const currentSnapshot = await this.snapshotRevealSettingsModal();
      if (currentSnapshot.selectedContactsCount === 1) {
        clickCompleted = true;
        break;
      }

      const currentRow = await this.findUniqueExactContactRow(normalizedEmail);
      try {
        await currentRow.click({ timeout: DEFAULT_TIMEOUT });
        clickCompleted = true;
      } catch (error) {
        const afterClickError = await this.snapshotRevealSettingsModal();
        if (afterClickError.selectedContactsCount === 1) {
          clickCompleted = true;
          break;
        }
        if (attempt === 1) {
          throw error;
        }
      }
    }

    await expect
      .poll(
        async () => {
          const snapshot = await this.snapshotRevealSettingsModal();
          const reResolvedRow = await this.findUniqueExactContactRow(normalizedEmail).catch(() => null);
          return {
            count: snapshot.selectedContactsCount,
            rowSelected: reResolvedRow ? await this.isContactRowSelected(reResolvedRow) : false,
            selectedRows: await this.countSelectedContactRows()
          };
        },
        {
          intervals: [100, 250, 500],
          timeout: DEFAULT_TIMEOUT,
          message: `Expected exact contact ${maskContactDiagnostic(
            normalizedEmail
          )} to be the only selected row after a 0-to-1 transition.`
        }
      )
      .toEqual({ count: 1, rowSelected: true, selectedRows: 1 });

    const reResolvedRow = await this.findUniqueExactContactRow(normalizedEmail);
    const afterSnapshot = await this.snapshotRevealSettingsModal();
    const selectedRowCount = await this.countSelectedContactRows();
    const selectedRowVerified = await this.isContactRowSelected(reResolvedRow);

    return {
      afterSnapshot,
      beforeSnapshot,
      selectedContactLabel: maskContactDiagnostic(normalizedEmail),
      selectedCountChanged: beforeSnapshot.selectedContactsCount === 0 && afterSnapshot.selectedContactsCount === 1,
      selectedRowCount,
      selectedRowVerified,
      targetIdentityVerified: selectedRowVerified && selectedRowCount === 1,
      visibleButtonsChanged: beforeSnapshot.visibleButtons.join("\n") !== afterSnapshot.visibleButtons.join("\n")
    };
  }

  private async waitForContactListReadyForDiagnostic(): Promise<InssaRevealSettingsModalSnapshot> {
    const deadline = Date.now() + DEFAULT_TIMEOUT;
    let lastSnapshot: InssaRevealSettingsModalSnapshot | null = null;

    while (Date.now() < deadline) {
      const snapshot = await this.waitForContactShareDecisionStep();
      lastSnapshot = snapshot;
      const hasRealContactRows =
        (snapshot.contactCount ?? 0) > 0 &&
        snapshot.visibleContacts.some((label) => !/no saved contacts yet|loading connections/i.test(label));

      if (hasRealContactRows) {
        return snapshot;
      }

      await this.page.waitForTimeout(250);
    }

    throw new Error(
      `Expected contact list to finish loading with at least one real contact before selection. ` +
        `Last step="${lastSnapshot?.selectedContactsStepLabel ?? lastSnapshot?.stepLabel ?? "unknown"}", ` +
        `contactCount=${lastSnapshot?.contactCount ?? "unknown"}, visibleContacts=${
          lastSnapshot?.visibleContacts.join(", ") || "none"
        }, visibleButtons=${lastSnapshot?.visibleButtons.join(", ") || "none"}`
    );
  }

  async clickBuryThenChooseWhoToShareWithOnce(): Promise<string> {
    const preClickSnapshot = await this.snapshotRevealSettingsModal();
    if (preClickSnapshot.selectedContactsCount !== 1) {
      throw new Error(
        `Refusing contact-share finalization without exactly 1 selected contact; observed ${
          preClickSnapshot.selectedContactsCount ?? "unknown"
        }.`
      );
    }
    const buttons = this.page.getByRole("button", { name: INSSA_BURY_THEN_CHOOSE_SHARE_PATTERN });
    const visibleEnabledIndexes: number[] = [];
    const count = await buttons.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = buttons.nth(index);
      if (
        (await candidate.isVisible().catch(() => false)) &&
        (await candidate.isEnabled().catch(() => false))
      ) {
        visibleEnabledIndexes.push(index);
      }
    }

    if (visibleEnabledIndexes.length !== 1) {
      const snapshot = await this.snapshotRevealSettingsModal();
      throw new Error(
        `Expected exactly one enabled contact-share Bury action. Found ${visibleEnabledIndexes.length}. ` +
          `Step title="${snapshot.stepTitle ?? "unknown"}", step="${
            snapshot.selectedContactsStepLabel ?? snapshot.stepLabel ?? "unknown"
          }", selectedContacts=${snapshot.selectedContactsCount ?? "unknown"}, contactCount=${
            snapshot.contactCount ?? "unknown"
          }, visibleContacts=${snapshot.visibleContacts.join(", ") || "none"}, ` +
          `visibleInputs=${snapshot.visibleInputs.join(", ") || "none"}, visibleButtons=${snapshot.visibleButtons.join(", ")}`
      );
    }

    const button = buttons.nth(visibleEnabledIndexes[0]);
    const label = (await button.innerText().catch(() => "")) || "Bury contact-share action";
    await button.click();
    return label.replace(/\s+/g, " ").trim();
  }

  async waitForPostContactFinalizationEvidence(): Promise<InssaLiveCapsuleShareEvidence> {
    let evidence = await this.readLiveCapsuleShareEvidence();
    await expect
      .poll(
        async () => {
          evidence = await this.readLiveCapsuleShareEvidence();
          return this.hasStrongLiveCapsuleShareEvidence(evidence);
        },
        {
          intervals: [500, 1_000, 2_000],
          timeout: POST_CONTINUE_SUCCESS_TIMEOUT,
          message: "Expected success/share evidence after the single contact-share finalization action."
        }
      )
      .toBeTruthy();
    return evidence;
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
        `Expected exactly one share-link finalization action. Found ${visibleIndexes.length}. ` +
          `Step title="${snapshot.stepTitle ?? "unknown"}", step="${snapshot.selectedContactsStepLabel ?? snapshot.stepLabel ?? "unknown"}", ` +
          `selectedContacts=${snapshot.selectedContactsCount ?? "unknown"}, contactCount=${snapshot.contactCount ?? "unknown"}, ` +
          `visibleContacts=${snapshot.visibleContacts.join(", ") || "none"}, ` +
          `visibleInputs=${snapshot.visibleInputs.join(", ") || "none"}, visibleButtons=${snapshot.visibleButtons.join(", ")}`
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

  private async findVisibleContactSelectionLocator(rawLabel: string): Promise<Locator | null> {
    const labelPattern = new RegExp(escapeRegExp(rawLabel), "i");
    const exactLabelPattern = new RegExp(`^${escapeRegExp(rawLabel)}$`, "i");
    const candidates = [
      this.page.getByRole("checkbox", { name: labelPattern }).first(),
      this.page.getByRole("button", { name: labelPattern }).first(),
      this.page.getByRole("option", { name: labelPattern }).first(),
      this.page.getByRole("listitem").filter({ hasText: labelPattern }).first(),
      this.page.locator("label").filter({ hasText: labelPattern }).first(),
      this.page.getByText(exactLabelPattern).first()
    ];

    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }

    return null;
  }

  private async findUniqueExactContactRow(normalizedEmail: string): Promise<Locator> {
    const dialog = this.page.getByRole("dialog").filter({ hasText: INSSA_CONTACT_SELECTION_CURRENT_TITLE_PATTERN });
    await expect(dialog, 'Expected the visible "Send or save" contact-selection dialog.').toBeVisible({ timeout: DEFAULT_TIMEOUT });
    const exactEmail = dialog.getByText(normalizedEmail, { exact: true });
    const matchingEmailCount = await exactEmail.count();
    if (matchingEmailCount !== 1) {
      throw new Error(
        `Expected exactly one visible contact email matching ${maskContactDiagnostic(normalizedEmail)}; found ${matchingEmailCount}.`
      );
    }

    const row = exactEmail.locator("xpath=ancestor::*[@role='button'][1]");
    if ((await row.count()) !== 1) {
      throw new Error(
        `Expected exact contact ${maskContactDiagnostic(normalizedEmail)} to belong to exactly one selectable contact row.`
      );
    }
    return row;
  }

  private async countSelectedContactRows(): Promise<number> {
    const dialog = this.page.getByRole("dialog").filter({ hasText: INSSA_CONTACT_SELECTION_CURRENT_TITLE_PATTERN });
    const rows = dialog.locator("div[role='button']");
    let selectedRows = 0;
    for (let index = 0; index < (await rows.count()); index += 1) {
      const row = rows.nth(index);
      if (await this.isContactRowSelected(row)) {
        selectedRows += 1;
      }
    }
    return selectedRows;
  }

  private async isContactRowSelected(row: Locator): Promise<boolean> {
    const attributes = await Promise.all(
      ["aria-checked", "aria-pressed", "aria-selected", "data-selected", "data-state"].map((name) =>
        row.getAttribute(name).catch(() => null)
      )
    );
    if (attributes.some((value) => /^(?:true|checked|selected|on)$/i.test(value ?? ""))) {
      return true;
    }

    const className = (await row.getAttribute("class").catch(() => null)) ?? "";
    if (/(?:^|\s)Mui-selected(?:\s|$)/.test(className)) {
      return true;
    }

    return row
      .locator(
        '[aria-checked="true"], [aria-selected="true"], [data-selected="true"], [data-testid*="RadioButtonChecked"], [data-testid*="CheckCircle"]'
      )
      .first()
      .isVisible()
      .catch(() => false);
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

function regexMatches(pattern: RegExp, value: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")).test(value);
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

function extractVisibleContactLabels(
  bodyText: string,
  input: {
    maskEmails?: boolean;
  } = {}
): string[] {
  const maskEmails = input.maskEmails ?? true;
  const rawLines = bodyText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const contactStepIndex = rawLines.findIndex((line) => INSSA_CONTACT_SELECTION_CURRENT_TITLE_PATTERN.test(line));

  if (contactStepIndex < 0) {
    return [];
  }

  const contactStepLines = rawLines.slice(contactStepIndex);
  const selectAllIndex = contactStepLines.findIndex((line) => INSSA_SELECT_ALL_CONTACTS_PATTERN.test(line));
  const finalActionIndex = contactStepLines.findIndex((line) => INSSA_BURY_THEN_CHOOSE_SHARE_PATTERN.test(line));
  const contactCandidateLines =
    selectAllIndex >= 0 && finalActionIndex > selectAllIndex
      ? contactStepLines.slice(selectAllIndex + 1, finalActionIndex)
      : contactStepLines;
  const nonContactLinePattern =
    /^(?:reveal settings|send or save|send to my contacts|select all|back|continue|cancel|bury|bury,\s*then choose who to share with|search by name or email|\d+\s+selected\s*[·•-]?\s*step\s*2\s*of\s*2|step\s*\d+\s*of\s*\d+|reveal timing|reveal now|reveal later|personal memory|shared capsule|copy share link|share link|home|choose contacts now|after burying|your phone will open sharing|selected \d+\/12 files|add media|compose|photo|video|gallery|save & exit|discard draft|got it)$/i;

  const contactLikeLines = contactCandidateLines
    .filter((line) => !nonContactLinePattern.test(line))
    .filter((line) => !/^\d+\s+of\s+\d+\s+contacts?\s+selected$/i.test(line))
    .filter((line) => !/heads up about this browser session|private browsing|sign-in|app preferences|got it/i.test(line))
    .filter((line) => !/no saved contacts yet|loading connections/i.test(line))
    .filter((line) => /@|^[A-Za-z][A-Za-z .'-]{1,80}$/.test(line))
    .filter((line) => line.length > 1)
    .map((line) => (maskEmails ? maskContactDiagnostic(line) : line));

  return Array.from(new Set(contactLikeLines)).slice(0, 20);
}

function maskContactDiagnostic(value: string): string {
  return value.replace(/\b([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi, "$1***$2");
}

function normalizeContactEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
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

function formatUsDateTimeInput(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const year = value.getFullYear();
  const hours24 = value.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const suffix = hours24 >= 12 ? "PM" : "AM";
  return `${month}/${day}/${year} ${hours12}:${minutes} ${suffix}`;
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

function collectRevealTimestampCandidates(
  source: InssaRevealTimestampCandidate["source"],
  value: string,
  context: string
): InssaRevealTimestampCandidate[] {
  const candidates: InssaRevealTimestampCandidate[] = [];
  const text = String(value ?? "");
  const namedTimestampMatches = text.matchAll(
    /"(revealDate|scheduledAt|scheduledFor|deliverAt|deliveryAt|availableAt|unlockAt|opensAt)"\s*:\s*\{[^}]*"timestampValue"\s*:\s*"([^"]+)"/gi
  );
  for (const match of namedTimestampMatches) {
    const normalizedIso = normalizeTimestampCandidate(match[2]);
    candidates.push({ context: `${context}:${match[1]}`, normalizedIso, source, value: match[2] });
  }

  const flatNamedTimestampMatches = text.matchAll(
    /"(revealDate|scheduledAt|scheduledFor|deliverAt|deliveryAt|availableAt|unlockAt|opensAt)"\s*:\s*"([^"]+)"/gi
  );
  for (const match of flatNamedTimestampMatches) {
    const normalizedIso = normalizeTimestampCandidate(match[2]);
    candidates.push({ context: `${context}:${match[1]}`, normalizedIso, source, value: match[2] });
  }

  const isoMatches = text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g);
  for (const match of isoMatches) {
    const normalizedIso = normalizeTimestampCandidate(match[0]);
    candidates.push({ context, normalizedIso, source, value: match[0] });
  }

  const usDateMatches = text.matchAll(
    /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)\b/gi
  );
  for (const match of usDateMatches) {
    const normalizedIso = normalizeUsDateTimeCandidate(match[0]);
    candidates.push({ context, normalizedIso, source, value: match[0] });
  }

  const selectedDateMatches = text.matchAll(/\bselected date is ([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b/gi);
  for (const match of selectedDateMatches) {
    const normalizedIso = normalizeDateOnlyCandidate(match[1]);
    candidates.push({ context, normalizedIso, source, value: match[1] });
  }

  return candidates;
}

function normalizeTimestampCandidate(value: string): string | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeUsDateTimeCandidate(value: string): string | null {
  const match = value.match(
    /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)\b/i
  );
  if (!match) {
    return null;
  }

  const [, month, day, year, hour, minute, meridiem] = match;
  let hour24 = Number(hour);
  if (/pm/i.test(meridiem) && hour24 < 12) {
    hour24 += 12;
  }
  if (/am/i.test(meridiem) && hour24 === 12) {
    hour24 = 0;
  }

  const parsed = new Date(Number(year), Number(month) - 1, Number(day), hour24, Number(minute), 0, 0);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeDateOnlyCandidate(value: string): string | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function extractSelectedDateText(bodyText: string, values: string[]): string | null {
  const combined = [bodyText, ...values].join("\n");
  return combined.match(/selected date is [^\n]+/i)?.[0] ?? combined.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0] ?? null;
}

function extractSelectedTimeText(bodyText: string, values: string[]): string | null {
  const combined = [bodyText, ...values].join("\n");
  return combined.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i)?.[0] ?? combined.match(/\b\d{2}:\d{2}\b/)?.[0] ?? null;
}
