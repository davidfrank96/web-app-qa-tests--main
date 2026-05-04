import { expect, type Locator, type Page } from "@playwright/test";
import { createCriticalPageMonitor, expectPageNotBlank, expectPageReady, expectVisiblePageUi } from "../../../utils/assertions";
import { test } from "../fixtures";

const ADMIN_ROUTE = "/admin";
const ADMIN_CREATE_ROUTE = "/admin/vendors/new";
const ADMIN_LIST_API = "/api/admin/vendors";
const ADMIN_SESSION_STORAGE_KEY = "local-man-admin-session";
const EXPECTED_ADMIN_API_DENIAL_PATTERN = /Failed to load resource: the server responded with a status of 401 \(Unauthorized\).*(?:\/api\/admin\/vendors|localhost:3000\/api\/admin\/vendors)|\/api\/admin\/vendors.*401 \(Unauthorized\)/i;
const FAKE_NON_ADMIN_TOKEN = createFakeJwt({
  email: "qa-non-admin@example.com",
  role: "user",
  sub: "qa-non-admin-user"
});

test.describe("Local Man authorization bypass protection", () => {
  test("logged-out users are redirected away from /admin", async ({ page }) => {
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i]
    });

    await page.goto(ADMIN_ROUTE, { waitUntil: "domcontentloaded" });
    await expectPageReady(page);
    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, `Expected Local Man to render a visible public or auth surface after denying access to "${ADMIN_ROUTE}".`);

    await waitForRedirectSettle(page, normalizePath(ADMIN_ROUTE));

    const finalPath = normalizePath(page.url());
    expect(
      finalPath !== normalizePath(ADMIN_ROUTE),
      `Expected logged-out access to "${ADMIN_ROUTE}" to redirect, but the final path remained "${finalPath}".`
    ).toBeTruthy();

    const protectedSurfaceVisible = await hasVisibleProtectedSurface(page);
    expect(
      protectedSurfaceVisible,
      `Expected Local Man to block logged-out access to "${ADMIN_ROUTE}", but protected admin UI remained visible.`
    ).toBeFalsy();

    await monitor.expectNoCriticalIssues();
  });

  test('logged-out browser fetch("/api/admin/vendors") is denied', async ({ page }) => {
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i, EXPECTED_ADMIN_API_DENIAL_PATTERN]
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectPageReady(page);
    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, "Expected Local Man to render a visible public surface before probing admin APIs.");

    const result = await browserFetchAdminEndpoint(page);
    expectUnauthorizedAdminApiResult(result, {
      context: 'logged-out browser fetch("/api/admin/vendors")',
      endpoint: ADMIN_LIST_API
    });

    await monitor.expectNoCriticalIssues();
  });

  test("non-admin-style session cannot open admin routes or admin APIs", async ({ page }) => {
    const monitor = createCriticalPageMonitor(page, {
      ignorePatterns: [/ERR_ABORTED/i, EXPECTED_ADMIN_API_DENIAL_PATTERN]
    });

    await page.addInitScript(
      ({ sessionKey, sessionValue }) => {
        window.localStorage.setItem(sessionKey, JSON.stringify(sessionValue));
      },
      {
        sessionKey: ADMIN_SESSION_STORAGE_KEY,
        sessionValue: {
          accessToken: FAKE_NON_ADMIN_TOKEN,
          refreshToken: "fake-refresh-token",
          user: {
            email: "qa-non-admin@example.com",
            role: "user"
          }
        }
      }
    );

    await page.goto(ADMIN_CREATE_ROUTE, { waitUntil: "domcontentloaded" });
    await expectPageReady(page);
    await expectPageNotBlank(page);
    await expectVisiblePageUi(page, `Expected Local Man to render a visible denial surface after blocking "${ADMIN_CREATE_ROUTE}".`);

    await waitForRedirectSettle(page, normalizePath(ADMIN_CREATE_ROUTE));

    const finalPath = normalizePath(page.url());
    const protectedSurfaceVisible = await hasVisibleProtectedSurface(page);
    expect(
      finalPath !== normalizePath(ADMIN_CREATE_ROUTE) || !protectedSurfaceVisible,
      `Expected a non-admin-style session to be denied admin route "${ADMIN_CREATE_ROUTE}", but the admin create surface remained reachable at "${finalPath}".`
    ).toBeTruthy();
    expect(
      protectedSurfaceVisible,
      "Expected a non-admin-style session not to expose Local Man protected admin controls."
    ).toBeFalsy();

    const result = await browserFetchAdminEndpoint(page, FAKE_NON_ADMIN_TOKEN);
    expectUnauthorizedAdminApiResult(result, {
      context: "non-admin-style session fetch to /api/admin/vendors",
      endpoint: ADMIN_LIST_API
    });

    await monitor.expectNoCriticalIssues();
  });
});

async function browserFetchAdminEndpoint(page: Page, token?: string) {
  return page.evaluate(
    async ({ endpoint, tokenValue }) => {
      const response = await fetch(endpoint, {
        headers: tokenValue
          ? {
              authorization: `Bearer ${tokenValue}`
            }
          : undefined
      });

      return {
        bodyText: await response.text(),
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: response.url,
        redirected: response.redirected,
        status: response.status
      };
    },
    {
      endpoint: ADMIN_LIST_API,
      tokenValue: token ?? null
    }
  );
}

function expectUnauthorizedAdminApiResult(
  result: {
    bodyText: string;
    contentType: string;
    finalUrl: string;
    redirected: boolean;
    status: number;
  },
  input: {
    context: string;
    endpoint: string;
  }
) {
  const finalPath = normalizePath(result.finalUrl);
  const deniedByStatus = result.status === 401 || result.status === 403;
  const deniedByRedirect = result.redirected && finalPath !== normalizePath(input.endpoint);

  expect(
    deniedByStatus || deniedByRedirect,
    `Expected ${input.context} to be denied, but received status=${result.status}, redirected=${String(result.redirected)}, finalPath="${finalPath}".`
  ).toBeTruthy();

  expect(
    containsAdminDataLeak(result.bodyText),
    `Expected ${input.context} not to leak admin vendor data.`
  ).toBeFalsy();
}

function containsAdminDataLeak(bodyText: string) {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  return /\bvendors?\b/i.test(normalized) && /"slug"|"id"|"name"|\[\s*\{/i.test(normalized);
}

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

function createFakeJwt(payload: Record<string, string>) {
  const header = encodeJwtSegment({
    alg: "HS256",
    typ: "JWT"
  });
  const body = encodeJwtSegment(payload);
  return `${header}.${body}.invalid-signature`;
}

function encodeJwtSegment(value: Record<string, string>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
