import { expect, type Page } from "@playwright/test";

// The application renders a conditional status banner, not a modal. Keep the
// dismissal scoped to that known prerequisite; never target unrelated Got it controls.
export async function dismissInssaSessionWarning(page: Page, options: { timeoutMs?: number } = {}): Promise<void> {
  const timeout = options.timeoutMs ?? 3_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Session warning budget must be positive and finite.");
  const deadline = Date.now() + timeout;
  const notice = page.getByRole("status").filter({ hasText: "Heads up about this browser session" });
  if (!(await notice.isVisible())) return;
  const remaining = () => Math.max(1, deadline - Date.now());
  try {
    // Let Playwright wait for actionability (including entrance animations and
    // detached/replaced nodes) within the existing budget. Repeated 500ms clicks
    // reset that work and the outer poll discarded the actionable error.
    await notice.getByRole("button", { name: "Got it", exact: true }).click({ timeout: remaining() });
  } catch (error) {
    // Navigation/removal may satisfy the prerequisite while a click is pending.
    // A still-visible notice must retain the original Playwright call log.
    if (await notice.isVisible()) throw error;
  }
  await expect(notice, "Known browser session warning must dismiss or leave the page during initialization")
    .not.toBeVisible({ timeout: remaining() });
}
