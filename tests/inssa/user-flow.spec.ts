import { expect, test as baseTest, type Locator, type Page } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { createInssaErrorMonitor, getInssaTestCredentials, login } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { test as authenticatedTest } from "./fixtures";

const PRIMARY_ACTION_PATTERN =
  /explore|discover|feed|home|profile|my contacts|contacts|requests|alerts|following|loved|favorites|create|new|compose|post|capsule|content|edit profile/i;
const PROFILE_NAV_PATTERN = /my contacts|contacts|requests|alerts|following|loved|favorites|edit profile/i;
const CONTENT_ACTION_PATTERN = /following|loved|favorites|requests|alerts|contacts|content|capsule|post/i;
const EMPTY_STATE_PATTERN =
  /no (posts?|capsules?|content|items?|results?|contacts?|connections?|people) (yet|found)|nothing (here|to show|yet)|be the first|coming soon|empty/i;
const PUBLIC_AUTH_PATTERN = /sign in|log in|continue|get started|email|google|apple|next/i;

type ActionCandidate = { text: string };

authenticatedTest.describe("INSSA authenticated user flow", () => {
  authenticatedTest.describe.configure({ mode: "serial" });

  authenticatedTest.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  authenticatedTest("dashboard loads after login", async ({ page, authPage }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated dashboard", () => authPage.goToProfile(), { phase: "navigation" });
      await monitor.step("assert authenticated dashboard health", () => expectHealthyAuthenticatedPage(page), {
        phase: "assertion"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  authenticatedTest("primary authenticated navigation routes load without crashing", async ({ page, authPage }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", () => authPage.goToProfile(), { phase: "navigation" });
      await monitor.step("assert authenticated profile surface", () => authPage.expectProfileSurface(), {
        phase: "assertion"
      });
      const candidates = await collectProfileActionCandidates(page);

      expect(
        candidates.length,
        "Expected at least one visible authenticated navigation action after login."
      ).toBeGreaterThan(0);

      for (const candidate of candidates.slice(0, 3)) {
        await monitor.step(`navigate via authenticated action "${candidate.text}"`, async () => {
          await authPage.goToProfile();
          await authPage.expectProfileSurface();

          const action = page
            .locator("button, a[href]")
            .filter({ hasText: new RegExp(escapeRegExp(candidate.text), "i") })
            .first();
          await expect(action, `Expected the authenticated action "${candidate.text}" to remain visible.`).toBeVisible();

          const beforeUrl = page.url();
          await action.click();
          await page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 5_000 }).catch(() => {});
          await expectHealthyAuthenticatedPage(page);

          const afterPath = currentPath(page);
          expect(
            !/^\/signin\/?$|^\/sign-in\/?$|^\/login\/?$|^\/auth/.test(afterPath),
            `Expected authenticated navigation action "${candidate.text}" to stay on a non-authenticated route.`
          ).toBeTruthy();
        }, { phase: "navigation" });
      }

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

  authenticatedTest("authenticated user can see content blocks or a valid empty state", async ({ page, authPage }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open cached authenticated profile", () => authPage.goToProfile(), { phase: "navigation" });
      await monitor.step("assert authenticated profile surface", () => authPage.expectProfileSurface(), {
        phase: "assertion"
      });

      const contentAction = await findFirstContentAction(page);
      if (contentAction) {
        await monitor.step(`open content-related action "${contentAction.text}"`, async () => {
          const action = page
            .locator("button, a[href]")
            .filter({ hasText: new RegExp(escapeRegExp(contentAction.text), "i") })
            .first();
          if (await action.isVisible().catch(() => false)) {
            const beforeUrl = page.url();
            await action.click();
            await page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 5_000 }).catch(() => {});
          }
        }, { phase: "navigation" });
      }

      await monitor.step("assert authenticated content surface health", () => expectHealthyAuthenticatedPage(page), {
        phase: "assertion"
      });
      await monitor.step("assert content blocks or empty state", () => expectContentOrEmptyState(page), {
        phase: "assertion"
      });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });

});

baseTest.describe("INSSA authenticated user flow", () => {
  baseTest.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  baseTest("protected route redirects when logged out and succeeds when logged in", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("access /me while logged out", async () => {
        await page.goto("/me", { waitUntil: "domcontentloaded" });
        await expectPageNotBlank(page);
      }, { phase: "navigation", route: "/me" });

      const loggedOutPath = currentPath(page);
      expect(
        loggedOutPath !== "/me",
        `Expected logged-out access to /me to redirect, but the final path remained "${loggedOutPath}".`
      ).toBeTruthy();

      const publicAuthSurface = await findVisibleAuthOrPublicSurface(page);
      expect(publicAuthSurface, "Expected a public or auth entry surface after logged-out protected-route access.").not.toBeNull();

      const authPage = await monitor.step("login with valid credentials", () => login(page), { phase: "navigation" });
      await monitor.step("open authenticated /me profile surface", async () => {
        await authPage.goToProfile();
        await authPage.expectProfileSurface();
        await expectHealthyAuthenticatedPage(page);
      }, { phase: "navigation", route: "/me" });

      const loggedInPath = currentPath(page);
      expect(
        !/^\/signin\/?$|^\/sign-in\/?$|^\/login\/?$|^\/auth/.test(loggedInPath),
        `Expected authenticated access to /me to succeed, but landed on "${loggedInPath}".`
      ).toBeTruthy();

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});

async function expectHealthyAuthenticatedPage(page: Page): Promise<void> {
  await waitForSurfaceToSettle(page);
  await expectPageNotBlank(page);
  await expectInteractiveElementsPresent(
    page,
    "Expected at least one interactive element on the authenticated INSSA surface."
  );
}

async function collectProfileActionCandidates(page: Page): Promise<ActionCandidate[]> {
  const actions = page.locator("button, a[href]").filter({ hasText: PROFILE_NAV_PATTERN });
  const seen = new Set<string>();
  const results: ActionCandidate[] = [];
  const total = await actions.count();

  for (let index = 0; index < total; index += 1) {
    const action = actions.nth(index);
    if (!(await action.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await action.textContent());
    if (!text || seen.has(text)) {
      continue;
    }

    if (PRIMARY_ACTION_PATTERN.test(text)) {
      results.push({ text });
      seen.add(text);
    }
  }

  return results;
}

async function findFirstContentAction(page: Page): Promise<ActionCandidate | null> {
  const candidates = await collectProfileActionCandidates(page);
  return candidates.find((candidate) => CONTENT_ACTION_PATTERN.test(candidate.text)) ?? null;
}

async function expectContentOrEmptyState(page: Page): Promise<void> {
  const contentBlocks = page.locator(
    [
      "main article",
      "[role='main'] article",
      "main [role='listitem']",
      "[role='main'] [role='listitem']",
      "main li",
      "[role='main'] li",
      "main a[href*='/capsule']",
      "main a[href*='/post']",
      "main a[href*='/content']",
      "[role='main'] a[href*='/capsule']",
      "[role='main'] a[href*='/post']",
      "[role='main'] a[href*='/content']"
    ].join(", ")
  );

  if (await hasSubstantiveVisibleElement(contentBlocks)) {
    return;
  }

  const emptyState = page
    .locator("main, [role='main'], body")
    .locator("h1, h2, h3, p, span, div, li")
    .filter({ hasText: EMPTY_STATE_PATTERN })
    .first();

  await expect(
    emptyState,
    "Expected authenticated INSSA content to render a content block or a valid empty-state message."
  ).toBeVisible();
}

async function findVisibleAuthOrPublicSurface(page: Page) {
  const candidates = [
    page.getByRole("link", { name: PUBLIC_AUTH_PATTERN }).first(),
    page.getByRole("button", { name: PUBLIC_AUTH_PATTERN }).first(),
    page.locator("input[type='email'], input[autocomplete='email'], input[placeholder*='email' i]").first()
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return null;
}

async function hasSubstantiveVisibleElement(locator: Locator): Promise<boolean> {
  const total = await locator.count();

  for (let index = 0; index < total; index += 1) {
    const element = locator.nth(index);
    if (!(await element.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await element.textContent());
    if (text.length >= 20) {
      return true;
    }
  }

  return false;
}

function normalizeText(value: string | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function currentPath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForSurfaceToSettle(page: Page, timeout = 10_000): Promise<void> {
  const progressbar = page.getByRole("progressbar").first();
  if (await progressbar.isVisible().catch(() => false)) {
    await expect(progressbar, "Expected route loading progress to finish.").toBeHidden({ timeout }).catch(() => {});
  }

  const interactive = page.locator("a[href], button, input:not([type='hidden']), select, textarea");
  const deadline = Date.now() + timeout;

  while (Date.now() <= deadline) {
    if ((await interactive.count()) > 0) {
      return;
    }

    if (!(await progressbar.isVisible().catch(() => false))) {
      await page.waitForTimeout(250);
    } else {
      await page.waitForTimeout(200);
    }
  }
}

async function expectInteractiveElementsPresent(page: Page, message: string): Promise<void> {
  const count = await page.locator("a[href], button, input:not([type='hidden']), select, textarea").count();
  expect(count, message).toBeGreaterThan(0);
}
