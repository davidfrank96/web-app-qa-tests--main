import { expect, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import {
  INSSA_DRAFTS_ROUTE,
  INSSA_DRAFTS_SURFACE_PATTERN,
  INSSA_GENERIC_JS_SHELL_PATTERN
} from "../../utils/inssa-test-data";

const DEFAULT_TIMEOUT = 15_000;
const QA_SUBJECT_PATTERN = /\bQA_TEST_CAPSULE_[A-Za-z0-9_-]+\b/i;

export class DraftsPage {
  constructor(private readonly page: Page) {}

  async goToDrafts(): Promise<void> {
    const response = await this.page.goto(INSSA_DRAFTS_ROUTE, { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400) {
      throw new Error(`INSSA drafts page returned HTTP ${response.status()}.`);
    }

    await this.expectDraftsSurface();
  }

  async expectDraftsSurface(): Promise<void> {
    await expectPageNotBlank(this.page);
    await expect(this.page.locator("body")).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);
    await expect(
      this.page.getByText(INSSA_DRAFTS_SURFACE_PATTERN).first(),
      "Expected the authenticated drafts surface to render."
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });
  }

  async listQaDraftSubjects(): Promise<string[]> {
    await this.expectDraftsSurface();

    const matches = await this.page.locator("body").evaluate((body) => {
      const text = ("innerText" in body ? body.innerText : body.textContent) || "";
      return Array.from(text.matchAll(/\bQA_TEST_CAPSULE_[A-Za-z0-9_-]+\b/g)).map((match) => String(match[0] ?? ""));
    });

    return Array.from(new Set(matches));
  }

  async openDraftBySubject(subject: string, index = 0): Promise<void> {
    await this.expectDraftsSurface();
    await expect(
      this.draftSubject(subject, index),
      `Expected draft "${subject}" to be visible in Buried drafts at index ${index}.`
    ).toBeVisible({
      timeout: DEFAULT_TIMEOUT
    });
    await this.draftSubject(subject, index).click();
  }

  async openFirstQaDraft(): Promise<string | null> {
    await this.expectDraftsSurface();
    const subjects = await this.listQaDraftSubjects();
    const subject = subjects[0];

    if (!subject) {
      return null;
    }

    await this.openDraftBySubject(subject, 0);
    return subject;
  }

  async expectDraftAbsent(subject: string): Promise<void> {
    await this.expectDraftsSurface();
    await expect(this.draftSubject(subject, 0)).toHaveCount(0);
  }

  qaDraftSubjects(): Locator {
    return this.page.getByText(QA_SUBJECT_PATTERN);
  }

  private draftSubject(subject: string, index: number): Locator {
    return this.page.getByText(subject, { exact: true }).nth(index);
  }
}
