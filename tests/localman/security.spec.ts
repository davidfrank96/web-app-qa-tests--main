import { expect, type Locator, type Page } from "@playwright/test";
import { createCriticalPageMonitor, expectPageNotBlank, expectPageReady, expectVisiblePageUi } from "../../utils/assertions";
import { test } from "./fixtures";

const PROTECTED_ROUTES = [
  {
    label: "admin",
    path: "/admin"
  }
] as const;

test.describe("Local Man route protection", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`logged-out users are redirected away from ${route.path}`, async ({ page }) => {
      const monitor = createCriticalPageMonitor(page, {
        ignorePatterns: [/ERR_ABORTED/i]
      });

      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expectPageReady(page);
      await expectPageNotBlank(page);
      await expectVisiblePageUi(page, `Expected Local Man to render a visible redirect target for protected route "${route.path}".`);

      await waitForRedirectSettle(page, requestedPathFromRoute(route.path));

      const finalPath = normalizePath(page.url());
      const requestedPath = normalizePath(route.path);
      const redirected = finalPath !== requestedPath;

      expect(
        redirected,
        `Expected logged-out access to protected route "${route.path}" to redirect, but the final path remained "${finalPath}".`
      ).toBeTruthy();

      const protectedSurfaceVisible = await hasVisibleProtectedSurface(page);
      expect(
        protectedSurfaceVisible,
        `Expected Local Man to block logged-out access to "${route.path}", but protected admin UI remained visible.`
      ).toBeFalsy();

      const redirectSurface = await firstVisible([
        page.getByLabel(/^Email$/i),
        page.getByLabel(/^Password$/i),
        page.getByRole("button", { name: /^Sign in$/i }),
        page.getByRole("searchbox"),
        page.getByRole("textbox", { name: /search|location|vendor|business/i }),
        page.getByRole("heading"),
        page.getByRole("banner"),
        page.getByRole("main")
      ]);

      expect(
        redirectSurface,
        `Expected logged-out access to "${route.path}" to land on a public or auth surface after redirect.`
      ).not.toBeNull();

      await monitor.expectNoCriticalIssues();
    });
  }
});

async function hasVisibleProtectedSurface(page: Page): Promise<boolean> {
  const protectedLocators = [
    page.getByRole("heading", { name: /manage vendors/i }),
    page.getByRole("button", { name: /log out/i }),
    page.getByRole("button", { name: /^Create vendor$/i }),
    page.getByRole("link", { name: /open edit workspace/i }),
    page.locator("input[name='name']").first(),
    page.locator("input[name='slug']").first()
  ];

  return Boolean(await firstVisible(protectedLocators, 2_000));
}

async function firstVisible(locators: Locator[], timeoutMs = 8_000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

async function waitForRedirectSettle(page: Page, requestedPath: string, timeoutMs = 3_000) {
  try {
    await page.waitForFunction(
      (expectedPath) => {
        const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
        return pathname !== expectedPath;
      },
      requestedPath,
      { timeout: timeoutMs }
    );
  } catch {
    // Keep the current route when no redirect occurs so the strict assertion can fail explicitly.
  }
}

function requestedPathFromRoute(path: string): string {
  return normalizePath(path);
}

function normalizePath(urlOrPath: string): string {
  try {
    const url = new URL(urlOrPath);
    const pathname = url.pathname.replace(/\/+$/, "");
    return pathname || "/";
  } catch {
    const pathname = urlOrPath.replace(/[?#].*$/, "").replace(/\/+$/, "");
    return pathname || "/";
  }
}
