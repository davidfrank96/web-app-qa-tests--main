import { expect, type Page } from "@playwright/test";

// The application renders a conditional status banner, not a modal. Keep the
// dismissal scoped to that known prerequisite; never target unrelated Got it controls.
export async function dismissInssaSessionWarning(page: Page): Promise<void> {
  const notice = page.getByRole("status").filter({ hasText: "Heads up about this browser session" });
  await expect.poll(async () => {
    if (!(await notice.isVisible())) return true;
    try { await notice.getByRole("button", { name: "Got it", exact: true }).click({ timeout: 500 }); }
    catch (error) {
      if (!(await notice.isVisible())) return true;
      if (!(error instanceof Error) || !/Timeout|detached|not attached/i.test(error.message)) throw error;
    }
    return !(await notice.isVisible());
  }, { timeout: 3_000, message: "Known browser session warning must dismiss or leave the page during initialization" }).toBe(true);
}
