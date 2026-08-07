import { expect, test } from "@playwright/test";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";

const TARGET_EMAIL = "test2@gmail.com";

test.describe("INSSA Media and Video exact contact selection", () => {
  test("selects only the exact row across a transient re-render and finalizes once", async ({ page }) => {
    await page.setContent(contactDialogFixture());
    const compose = new TimeCapsulePage(page);

    await expect(compose.clickBuryThenChooseWhoToShareWithOnce()).rejects.toThrow(/exactly 1 selected contact/i);

    const selection = await compose.selectExactContactForLifecycle(TARGET_EMAIL);
    expect(selection.beforeSnapshot.selectedContactsCount).toBe(0);
    expect(selection.afterSnapshot.selectedContactsCount).toBe(1);
    expect(selection.selectedRowCount).toBe(1);
    expect(selection.selectedRowVerified).toBe(true);
    expect(selection.targetIdentityVerified).toBe(true);
    await expect(page.getByTestId("target-row")).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("similar-row")).not.toHaveAttribute("data-selected", "true");

    const actionLabel = await compose.clickBuryThenChooseWhoToShareWithOnce();
    expect(actionLabel).toMatch(/^bury,\s*then choose who to share with$/i);
    await expect(page.getByTestId("final-click-count")).toHaveText("1");
  });

  test("does not accept a similarly named or partial email row", async ({ page }) => {
    await page.setContent(contactDialogFixture({ targetEmail: "test2+other@gmail.com" }));
    const compose = new TimeCapsulePage(page);

    await expect(compose.selectExactContactForLifecycle(TARGET_EMAIL)).rejects.toThrow(
      /exactly one visible contact email matching/i
    );
    await expect(page.getByTestId("final-click-count")).toHaveText("0");
  });
});

function contactDialogFixture(input: { targetEmail?: string } = {}) {
  const targetEmail = input.targetEmail ?? TARGET_EMAIL;
  return `
    <main>
      <div role="dialog" aria-label="Send or save">
        <h2>Send or save</h2>
        <p data-testid="step-count">0 selected · Step 2 of 2</p>
        <label>Search by name or email <input aria-label="Search by name or email" /></label>
        <p data-testid="total-count">0 of 3 contacts selected</p>
        <button type="button">Select all</button>
        <div data-testid="contact-list">
          <div role="button" tabindex="0" data-testid="similar-row">
            <span>Test Two</span><span>test2-team@gmail.com</span>
            <svg data-testid="RadioButtonUncheckedRoundedIcon"></svg>
          </div>
          <div role="button" tabindex="0" data-testid="other-row">
            <span>David Frank</span><span>davidfrank96.df@gmail.com</span>
            <svg data-testid="RadioButtonUncheckedRoundedIcon"></svg>
          </div>
          <div role="button" tabindex="0" data-testid="target-row">
            <span>${targetEmail}</span><span>Inssa connection</span>
            <svg data-testid="RadioButtonUncheckedRoundedIcon"></svg>
          </div>
        </div>
        <button type="button" data-testid="final-action">Bury, then choose who to share with</button>
        <span data-testid="final-click-count">0</span>
      </div>
    </main>
    <script>
      const list = document.querySelector('[data-testid="contact-list"]');
      const target = document.querySelector('[data-testid="target-row"]');
      const targetEmail = ${JSON.stringify(targetEmail)};
      target.addEventListener('click', () => {
        document.querySelector('[data-testid="step-count"]').textContent = '1 selected · Step 2 of 2';
        document.querySelector('[data-testid="total-count"]').textContent = '1 of 3 contacts selected';
        list.innerHTML = [
          '<div role="button" tabindex="0" data-testid="similar-row"><span>Test Two</span><span>test2-team@gmail.com</span><svg data-testid="RadioButtonUncheckedRoundedIcon"></svg></div>',
          '<div role="button" tabindex="0" data-testid="other-row"><span>David Frank</span><span>davidfrank96.df@gmail.com</span><svg data-testid="RadioButtonUncheckedRoundedIcon"></svg></div>',
          '<div role="button" tabindex="0" data-testid="target-row" data-selected="true"><span>' + targetEmail + '</span><span>Inssa connection</span><svg data-testid="RadioButtonCheckedRoundedIcon"></svg></div>'
        ].join('');
      });
      document.querySelector('[data-testid="final-action"]').addEventListener('click', () => {
        const count = document.querySelector('[data-testid="final-click-count"]');
        count.textContent = String(Number(count.textContent) + 1);
      });
    </script>
  `;
}
