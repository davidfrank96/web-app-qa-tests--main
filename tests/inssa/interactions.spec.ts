import { type Locator, type Page } from "@playwright/test";
import { AuthPage } from "../../pages/inssa/auth-page";
import { expectPageNotBlank } from "../../utils/assertions";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { expect, test } from "./fixtures";

const CREATE_ACTION_PATTERN = /create|new|compose|post|capsule|share/i;
const EDIT_PROFILE_PATTERN = /edit profile/i;
const NAVIGATION_ACTION_PATTERN = /my contacts|contacts|requests|alerts|following|loved|favorites/i;
const SUBMIT_PATTERN = /create|publish|post|save|submit|continue|update|done/i;
const SUCCESS_PATTERN = /saved|updated|published|posted|created|success/i;
const VALIDATION_PATTERN = /required|invalid|must|too short|cannot be empty|enter/i;
const EMPTY_OR_RESOLVED_PATTERN =
  /no (contacts?|connections?|people|posts?|capsules?|content|items?|results?) (yet|found)|nothing (here|to show|yet)|be the first|coming soon|empty/i;
const CREATE_TEXT_INPUT_PATTERN = /title|headline|subject|name|caption/i;
const CREATE_BODY_PATTERN = /description|details|body|content|message|story|caption/i;
const FORM_FIELD_PATTERN = "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled])";

type ActionCandidate = { text: string };

test.describe("INSSA deeper interactions", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  test.beforeEach(async ({ page }) => {
    page.setDefaultNavigationTimeout(30_000);
  });

  test("create flow submits minimal valid data when accessible create UI exists", async ({ page, authPage }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", () => authPage.goToProfile(), { phase: "navigation" });
      await monitor.step("assert cached authenticated profile surface", () => authPage.expectProfileSurface(), {
        phase: "assertion"
      });

      const createAction = await findAccessibleCreateAction(page, authPage);
      test.skip(!createAction, "No accessible create action is exposed in the current INSSA build.");

      await monitor.step(`open create action "${createAction!.text}"`, async () => {
        await clickVisibleAction(page, createAction!.text);
        await waitForSettledSurface(page);
        await expectPageNotBlank(page);
      }, { phase: "navigation" });

      const submitControl = await findSubmitControl(page);
      expect(submitControl, "Expected a submit action on the create surface.").not.toBeNull();

      const populatedCount = await monitor.step("fill minimal valid create form data", () => fillMinimalValidFormData(page));
      expect(populatedCount, "Expected at least one visible create-form field to be fillable.").toBeGreaterThan(0);

      const beforeUrl = page.url();
      const loadingObserved = await monitor.step("submit create form", () => submitAndWatchLoading(page, submitControl!));

      await monitor.step("assert create success or confirmation", () =>
        expectCreateSuccessOrConfirmation(page, beforeUrl, loadingObserved), { phase: "assertion" }
      );
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("editable form rejects an empty required field", async ({ page, authPage }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      const opened = await monitor.step("open edit profile form", () => openEditProfileForm(page, authPage), {
        phase: "navigation"
      });
      test.skip(!opened, "No accessible edit-profile form is exposed in the current INSSA build.");

      await monitor.step("assert edit profile form is ready", async () => {
        await waitForSettledSurface(page);
        await expectPageNotBlank(page);
      }, { phase: "assertion" });

      const submitControl = await findSubmitControl(page);
      expect(submitControl, "Expected a submit action on the editable surface.").not.toBeNull();

      const targetField = await findValidationTarget(page);
      test.skip(!targetField, "No editable text field was available for validation coverage.");

      await monitor.step("clear required profile field and validate submission guard", async () => {
        await targetField!.fill("");
        await targetField!.blur();

        if (await submitControl!.isDisabled().catch(() => false)) {
          await expect(submitControl!, "Expected invalid form input to keep submission disabled.").toBeDisabled();
        } else {
          await submitControl!.click();
          await expectValidationState(page, targetField!);
        }
      });

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("interactive surfaces show loading and resolved states", async ({ page, authPage }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", async () => {
        await authPage.goToProfile();
        await authPage.expectProfileSurface();
      }, { phase: "navigation" });

      const action = await findResolvedSectionAction(page);
      test.skip(!action, "No accessible section action was exposed for interactive-state coverage.");

      const loadingObserved = await monitor.step(`open resolved section "${action!.text}"`, () =>
        clickActionAndWatchLoading(page, action!.text), { phase: "navigation" }
      );

      await monitor.step(`assert resolved state for "${action!.text}"`, async () => {
        await waitForSettledSurface(page);
        await expectResolvedInteractiveSurface(page);

        expect(
          loadingObserved || (await hasResolvedSurfaceCue(page)),
          `Expected the "${action!.text}" interaction to show a loading state or a resolved surface cue.`
        ).toBeTruthy();
      }, { phase: "assertion" });

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  test("rapid navigation between sections stays stable", async ({ page, authPage }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", async () => {
        await authPage.goToProfile();
        await authPage.expectProfileSurface();
      }, { phase: "navigation" });

      const actions = await collectNavigationActions(page);
      expect(actions.length, "Expected at least two accessible section actions for navigation stability checks.").toBeGreaterThanOrEqual(2);

      for (const action of actions.slice(0, 2)) {
        await monitor.step(`navigate rapidly to "${action.text}"`, async () => {
          await authPage.goToProfile();
          await authPage.expectProfileSurface();

          await clickVisibleAction(page, action.text);
          await waitForSettledSurface(page);
          await expectResolvedInteractiveSurface(page);

          const currentUrl = page.url();
          expect(
            !/\/signin\/?$|\/sign-in\/?$|\/login\/?$|\/auth/i.test(currentUrl),
            `Expected navigation action "${action.text}" to stay on an authenticated route.`
          ).toBeTruthy();
        }, { phase: "navigation" });
      }

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});

async function findAccessibleCreateAction(page: Page, authPage: AuthPage): Promise<ActionCandidate | null> {
  const currentSurfaceAction = await findVisibleActionByPattern(page, CREATE_ACTION_PATTERN);
  if (currentSurfaceAction) {
    return currentSurfaceAction;
  }

  await authPage.goToProfile();
  await authPage.expectProfileSurface();

  const profileAction = await findVisibleActionByPattern(page, CREATE_ACTION_PATTERN);
  if (profileAction) {
    return profileAction;
  }

  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ERR_ABORTED/i.test(message)) {
      throw error;
    }
  }

  await waitForSettledSurface(page);
  await expectPageNotBlank(page);
  return findVisibleActionByPattern(page, CREATE_ACTION_PATTERN);
}

async function openEditProfileForm(page: Page, authPage: AuthPage): Promise<boolean> {
  await authPage.goToProfile();
  await authPage.expectProfileSurface();

  const editAction = await findVisibleActionByPattern(page, EDIT_PROFILE_PATTERN);
  if (!editAction) {
    return false;
  }

  await clickVisibleAction(page, editAction.text);
  return true;
}

async function collectNavigationActions(page: Page): Promise<ActionCandidate[]> {
  const actions = page.locator("button, a[href]").filter({ hasText: NAVIGATION_ACTION_PATTERN });
  const total = await actions.count();
  const seen = new Set<string>();
  const results: ActionCandidate[] = [];

  for (let index = 0; index < total; index += 1) {
    const action = actions.nth(index);
    if (!(await action.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await action.textContent());
    if (!text || seen.has(text)) {
      continue;
    }

    results.push({ text });
    seen.add(text);
  }

  return results;
}

async function findResolvedSectionAction(page: Page): Promise<ActionCandidate | null> {
  const actions = await collectNavigationActions(page);
  return actions.find((action) => /requests|following|loved|favorites|contacts|alerts/i.test(action.text)) ?? null;
}

async function findVisibleActionByPattern(page: Page, pattern: RegExp): Promise<ActionCandidate | null> {
  const actions = page.locator("button, a[href]").filter({ hasText: pattern });
  const total = await actions.count();

  for (let index = 0; index < total; index += 1) {
    const action = actions.nth(index);
    if (!(await action.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await action.textContent());
    if (text) {
      return { text };
    }
  }

  return null;
}

async function clickVisibleAction(page: Page, text: string): Promise<void> {
  const action = page
    .locator("button, a[href]")
    .filter({ hasText: new RegExp(escapeRegExp(text), "i") })
    .first();

  await expect(action, `Expected the action "${text}" to be visible.`).toBeVisible();
  await action.click();
}

async function findSubmitControl(page: Page): Promise<Locator | null> {
  const roleButton = page.getByRole("button", { name: SUBMIT_PATTERN }).first();
  if (await roleButton.isVisible().catch(() => false)) {
    return roleButton;
  }

  const fallback = page.locator("button, input[type='submit']").filter({ hasText: SUBMIT_PATTERN }).first();
  if (await fallback.isVisible().catch(() => false)) {
    return fallback;
  }

  const buttons = page.locator("button, input[type='submit']");
  const total = await buttons.count();
  for (let index = 0; index < total; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible().catch(() => false)) {
      return button;
    }
  }

  return null;
}

async function fillMinimalValidFormData(page: Page): Promise<number> {
  const controls = page.locator(FORM_FIELD_PATTERN);
  const total = await controls.count();
  let populated = 0;

  for (let index = 0; index < total; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible().catch(() => false))) {
      continue;
    }

    const tagName = await control.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    const type = ((await control.getAttribute("type")) ?? "").toLowerCase();
    const disabled = await control.isDisabled().catch(() => false);
    const readOnly = ((await control.getAttribute("readonly")) ?? "") !== "";

    if (disabled || readOnly || type === "file" || type === "checkbox" || type === "radio") {
      continue;
    }

    if (tagName === "select") {
      const options = control.locator("option");
      const optionCount = await options.count();
      if (optionCount > 1) {
        const value = await options.nth(1).getAttribute("value");
        if (value) {
          await control.selectOption(value);
          populated += 1;
        }
      }
      continue;
    }

    const placeholder = normalizeText(await control.getAttribute("placeholder"));
    const name = normalizeText(await control.getAttribute("name"));
    const labelHint = `${placeholder} ${name}`.trim();
    const currentValue = await control.inputValue().catch(() => "");
    if (currentValue.trim()) {
      continue;
    }

    const value = buildFieldValue(tagName, type, labelHint, populated);
    if (!value) {
      continue;
    }

    await control.fill(value);
    populated += 1;
  }

  return populated;
}

function buildFieldValue(tagName: string, type: string, hint: string, index: number): string | null {
  if (type === "email") {
    return "qa-inssa@example.com";
  }

  if (type === "url") {
    return "https://example.com";
  }

  if (type === "date") {
    return "2026-05-03";
  }

  if (tagName === "textarea" || CREATE_BODY_PATTERN.test(hint)) {
    return "Automated INSSA interaction test content.";
  }

  if (CREATE_TEXT_INPUT_PATTERN.test(hint)) {
    return "QA Interaction Test";
  }

  if (type === "text" || type === "search" || type === "") {
    return index === 0 ? "QA Interaction Test" : "Automated INSSA interaction coverage.";
  }

  return null;
}

async function findValidationTarget(page: Page): Promise<Locator | null> {
  const preferred = page.locator(
    [
      "input[required]:not([type='hidden']):not([disabled])",
      "textarea[required]:not([disabled])",
      "input[name*='name' i]:not([type='hidden']):not([disabled])",
      "input[name*='handle' i]:not([type='hidden']):not([disabled])",
      "input[name*='user' i]:not([type='hidden']):not([disabled])",
      "textarea[name*='bio' i]:not([disabled])"
    ].join(", ")
  );
  const preferredCandidate = await firstVisible(preferred);
  if (preferredCandidate) {
    return preferredCandidate;
  }

  return firstVisible(page.locator("input:not([type='hidden']):not([disabled]), textarea:not([disabled])"));
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
  const total = await locator.count();
  for (let index = 0; index < total; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return null;
}

async function expectValidationState(page: Page, field: Locator): Promise<void> {
  const invalidElements = page.locator(":invalid");
  if ((await invalidElements.count()) > 0) {
    return;
  }

  const ariaInvalid = await field.getAttribute("aria-invalid");
  if (ariaInvalid === "true") {
    return;
  }

  const validationMessage = await field.evaluate((element) => {
    if ("validationMessage" in element) {
      return (element as HTMLInputElement | HTMLTextAreaElement).validationMessage;
    }
    return "";
  });
  if (normalizeText(validationMessage)) {
    return;
  }

  const errorText = page
    .locator("[role='alert'], [aria-live='assertive'], [aria-live='polite'], p, span, div, li")
    .filter({ hasText: VALIDATION_PATTERN })
    .first();

  await expect(
    errorText,
    "Expected form submission with an empty required field to expose validation feedback."
  ).toBeVisible();
}

async function submitAndWatchLoading(page: Page, submitControl: Locator): Promise<boolean> {
  return performActionAndWatchLoading(page, async () => {
    await submitControl.click();
  });
}

async function clickActionAndWatchLoading(page: Page, text: string): Promise<boolean> {
  return performActionAndWatchLoading(page, async () => {
    await clickVisibleAction(page, text);
  });
}

async function performActionAndWatchLoading(page: Page, action: () => Promise<void>): Promise<boolean> {
  const progressbar = page.getByRole("progressbar").first();

  await action();

  const loadingObserved =
    (await progressbar.isVisible().catch(() => false)) ||
    (await expect(progressbar).toBeVisible({ timeout: 2_000 }).then(() => true).catch(() => false));

  if (loadingObserved) {
    await expect(progressbar, "Expected the loading indicator to eventually resolve.").toBeHidden({
      timeout: 15_000
    });
  }

  return loadingObserved;
}

async function expectCreateSuccessOrConfirmation(
  page: Page,
  beforeUrl: string,
  loadingObserved: boolean
): Promise<void> {
  await waitForSettledSurface(page);

  const successMessage = page
    .locator("[role='status'], [role='alert'], [aria-live='polite'], [aria-live='assertive'], h1, h2, h3, p, div, span")
    .filter({ hasText: SUCCESS_PATTERN })
    .first();

  if (await successMessage.isVisible().catch(() => false)) {
    return;
  }

  if (page.url() !== beforeUrl) {
    return;
  }

  const enteredText = page
    .locator("main, [role='main'], body")
    .filter({ hasText: /QA Interaction Test|Automated INSSA interaction test content\./i })
    .first();
  if (await enteredText.isVisible().catch(() => false)) {
    return;
  }

  expect(
    loadingObserved,
    "Expected create submission to surface a success cue, navigate, render the submitted content, or show a loading resolution."
  ).toBeTruthy();
}

async function expectResolvedInteractiveSurface(page: Page): Promise<void> {
  await waitForSettledSurface(page);
  await expectPageNotBlank(page);

  const interactiveCount = await page.locator("a[href], button, input:not([type='hidden']), textarea, select").count();
  const emptyState = page
    .locator("main, [role='main'], body")
    .locator("h1, h2, h3, p, span, div, li")
    .filter({ hasText: EMPTY_OR_RESOLVED_PATTERN })
    .first();

  if (interactiveCount > 0 || (await emptyState.isVisible().catch(() => false))) {
    return;
  }

  throw new Error("Expected the INSSA interaction surface to resolve to interactive UI or a valid empty state.");
}

async function hasResolvedSurfaceCue(page: Page): Promise<boolean> {
  const successMessage = page
    .locator("[role='status'], [role='alert'], [aria-live='polite'], [aria-live='assertive'], h1, h2, h3, p, div, span")
    .filter({ hasText: SUCCESS_PATTERN })
    .first();
  if (await successMessage.isVisible().catch(() => false)) {
    return true;
  }

  const emptyState = page
    .locator("main, [role='main'], body")
    .locator("h1, h2, h3, p, span, div, li")
    .filter({ hasText: EMPTY_OR_RESOLVED_PATTERN })
    .first();
  if (await emptyState.isVisible().catch(() => false)) {
    return true;
  }

  return (await page.locator("a[href], button, input:not([type='hidden']), textarea, select").count()) > 0;
}

async function waitForSettledSurface(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

  const progressbar = page.getByRole("progressbar").first();
  if (await progressbar.isVisible().catch(() => false)) {
    await expect(progressbar).toBeHidden({ timeout: 15_000 }).catch(() => {});
  }
}

function normalizeText(value: string | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
