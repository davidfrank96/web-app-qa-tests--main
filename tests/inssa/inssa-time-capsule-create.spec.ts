import { expect, test as baseTest, type Page, type Response, type TestInfo } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  INSSA_TIME_CAPSULE_NEXT_PATTERN,
  INSSA_TIME_CAPSULE_ROUTE_PATTERN
} from "../../utils/inssa-test-data";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { test as authenticatedTest } from "./fixtures";

const PUBLIC_COMPOSE_ENTRY_TIMEOUT = 60_000;
const AUTHENTICATED_COMPOSE_ENTRY_TIMEOUT = 90_000;

baseTest.describe("INSSA time capsule compose entry", () => {
  baseTest.beforeAll(() => {
    assertValidInssaUrl();
  });

  baseTest("logged-out bury redirects to sign-in with a timecapsule next param", async ({ page }, testInfo) => {
    baseTest.setTimeout(PUBLIC_COMPOSE_ENTRY_TIMEOUT);
    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);

    await withLandingFailureDiagnostics(page, testInfo, "public-compose-entry", async () => {
      await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
        await monitor.step("open INSSA landing page", () => landing.goToHome(), { phase: "navigation", route: "/" });
        await monitor.step("assert public landing surface", () => landing.expectPublicLandingSurface(), {
          phase: "assertion"
        });
        await monitor.step("open Bury while logged out", () => landing.openBuryEntry(), { phase: "interaction" });
        await monitor.step("assert logged-out compose entry redirects to sign-in", async () => {
          await expect
            .poll(() => page.url(), {
              message: "Expected logged-out Bury to redirect to the sign-in route.",
              timeout: 15_000
            })
            .toMatch(/\/signin/i);
          await expect(page.url()).toMatch(INSSA_TIME_CAPSULE_NEXT_PATTERN);
        }, { phase: "assertion" });
        await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
          phase: "assertion"
        });
      });
    });
  });
});

authenticatedTest.describe("INSSA time capsule compose entry", () => {
  authenticatedTest.skip(
    !hasInssaTestCredentials(),
    "INSSA_TEST_EMAIL and INSSA_TEST_PASSWORD are required for authenticated safe-suite checks."
  );

  authenticatedTest.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  authenticatedTest("authenticated bury opens the compose surface", async ({ page }, testInfo) => {
    authenticatedTest.setTimeout(AUTHENTICATED_COMPOSE_ENTRY_TIMEOUT);
    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);
    const timeCapsule = new TimeCapsulePage(page);

    await withLandingFailureDiagnostics(page, testInfo, "authenticated-compose-entry", async () => {
      await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
        await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
          phase: "navigation",
          route: "/"
        });
        await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
          phase: "assertion"
        });
        await monitor.step("open authenticated Bury entry", () => landing.openBuryEntry(), { phase: "interaction" });
        await monitor.step("assert time capsule compose surface", () => timeCapsule.expectComposeSurface(), {
          phase: "assertion",
          route: "/timecapsule"
        });
        await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
          phase: "assertion"
        });
      });
    });
  });

  authenticatedTest("authenticated direct compose route renders the non-destructive compose surface", async ({ page }, testInfo) => {
    const errorMonitor = createInssaErrorMonitor(page);
    const timeCapsule = new TimeCapsulePage(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated compose route directly", () => timeCapsule.goToComposeRoute(), {
        phase: "navigation",
        route: "/timecapsule"
      });
      await monitor.step("assert compose route is active", async () => {
        await expect
          .poll(() => page.url(), {
            message: "Expected direct authenticated compose navigation to stay on the compose route.",
            timeout: 15_000
          })
          .toMatch(INSSA_TIME_CAPSULE_ROUTE_PATTERN);
      }, { phase: "assertion" });
      await monitor.step("assert compose surface and required-field metadata", async () => {
        await timeCapsule.expectComposeSurface();
        await timeCapsule.expectRequiredFieldMetadata();
      }, { phase: "assertion" });
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});

function hasInssaTestCredentials() {
  return Boolean(process.env.INSSA_TEST_EMAIL?.trim() && process.env.INSSA_TEST_PASSWORD?.trim());
}

type SanitizedApiStatus = {
  method: string;
  path: string;
  status: number;
};

async function withLandingFailureDiagnostics<T>(
  page: Page,
  testInfo: TestInfo,
  label: string,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const apiStatuses: SanitizedApiStatus[] = [];
  const onResponse = (response: Response) => {
    const status = sanitizeApiStatus(response);
    if (status && apiStatuses.length < 250) {
      apiStatuses.push(status);
    }
  };
  page.on("response", onResponse);

  try {
    return await run();
  } catch (error) {
    const browserState = await readSanitizedBrowserState(page);
    await testInfo.attach(`${label}-failure-diagnostics.json`, {
      body: JSON.stringify(
        {
          apiStatuses,
          browserState,
          elapsedMs: Date.now() - startedAt,
          error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))
        },
        null,
        2
      ),
      contentType: "application/json"
    });

    const screenshot = await page.screenshot({ fullPage: true, timeout: 5_000 }).catch(() => null);
    if (screenshot) {
      await testInfo.attach(`${label}-final-state.png`, {
        body: screenshot,
        contentType: "image/png"
      });
    }
    throw error;
  } finally {
    page.off("response", onResponse);
  }
}

function sanitizeApiStatus(response: Response): SanitizedApiStatus | null {
  try {
    const url = new URL(response.url());
    const relevant =
      url.hostname === "staging.inssa.us" ||
      /(?:firebase|firestore|cloudfunctions|identitytoolkit|googleapis)\./i.test(url.hostname);
    if (!relevant || (!/\/(?:api|Account)\//i.test(url.pathname) && !/(?:firestore|cloudfunctions|identitytoolkit)/i.test(url.hostname))) {
      return null;
    }
    return {
      method: response.request().method(),
      path: `${url.origin}${url.pathname}`,
      status: response.status()
    };
  } catch {
    return null;
  }
}

async function readSanitizedBrowserState(page: Page) {
  return page
    .evaluate(() => {
      const isVisible = (element: Element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      };
      const controls = Array.from(document.querySelectorAll("header a, header button, nav a, nav button, main button"))
        .filter(isVisible)
        .map((element) => (element.textContent ?? element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 40);
      const current = new URL(window.location.href);
      const pointsLedgerVisible = Array.from(document.querySelectorAll("a[href='/points-ledger']")).some(isVisible);
      const profileVisible = Array.from(document.querySelectorAll("a[href='/me'], a[href*='/profile']")).some(isVisible);
      const signInVisible = Array.from(document.querySelectorAll("a[href*='/signin'], a[href*='/login']")).some(isVisible);

      return {
        authenticatedSession:
          pointsLedgerVisible || profileVisible ? "authenticated" : signInVisible ? "public" : "indeterminate",
        finalUrl: `${current.origin}${current.pathname}${current.search ? `?<${[...current.searchParams.keys()].join(",")}>` : ""}`,
        visibleNavigationControls: controls
      };
    })
    .then((state) => ({
      ...state,
      visibleNavigationControls: state.visibleNavigationControls.map(sanitizeDiagnosticText)
    }))
    .catch(() => ({
      authenticatedSession: "unavailable",
      finalUrl: "unavailable",
      visibleNavigationControls: [] as string[]
    }));
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]{12,}){0,2}\b/g, "<redacted-token>")
    .slice(0, 2_000);
}
