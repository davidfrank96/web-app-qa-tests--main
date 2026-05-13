import { expect, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import {
  INSSA_ARCHIVE_CAPSULE_PATTERN,
  INSSA_COMPOSE_STEP_PATTERN,
  INSSA_COMPOSE_INITIAL_DRAFT_KEY_PREFIX,
  INSSA_COMPOSE_REFRESH_CACHE_KEY_PREFIX,
  INSSA_DELETE_CAPSULE_PATTERN,
  INSSA_DISCARD_DRAFT_PATTERN,
  INSSA_EDIT_CAPSULE_PATTERN,
  INSSA_GENERIC_JS_SHELL_PATTERN,
  INSSA_HIDE_CAPSULE_PATTERN,
  INSSA_MESSAGE_COUNTER_PATTERN,
  INSSA_MESSAGE_LABEL_PATTERN,
  INSSA_PUBLISH_CAPSULE_PATTERN,
  INSSA_SAVE_EXIT_PATTERN,
  INSSA_SUBJECT_COUNTER_PATTERN,
  INSSA_SUBJECT_LABEL_PATTERN,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN
} from "../../utils/inssa-test-data";

const DEFAULT_TIMEOUT = 15_000;

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
};

export class TimeCapsulePage {
  constructor(private readonly page: Page) {}

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

  async snapshotLifecycleControls(): Promise<InssaLifecycleControlSnapshot> {
    await this.expectComposeSurface();

    return {
      archiveCapsule: await this.archiveCapsuleButton().isVisible().catch(() => false),
      deleteCapsule: await this.deleteCapsuleButton().isVisible().catch(() => false),
      discardDraft: await this.discardDraftButton().isVisible().catch(() => false),
      editCapsule: await this.editCapsuleButton().isVisible().catch(() => false),
      hideCapsule: await this.hideCapsuleButton().isVisible().catch(() => false),
      publishCapsule: await this.publishCapsuleButton().isVisible().catch(() => false),
      saveAndExit: await this.saveAndExitButton().isVisible().catch(() => false)
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
}
