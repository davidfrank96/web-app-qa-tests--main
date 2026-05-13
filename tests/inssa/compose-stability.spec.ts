import { type Page, type Route } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { expectPageNotBlank } from "../../utils/assertions";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { createConsoleSecurityMonitor } from "../../utils/security";
import { expect, test } from "./fixtures";

const INSSA_SENSITIVE_PATTERNS = [
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/=]{12,}\b/
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
  },
  {
    name: "token-assignment",
    pattern: /\b(?:token|access[_ -]?token|refresh[_ -]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{8,}/i
  },
  {
    name: "secret-assignment",
    pattern: /\b(?:secret|client[_ -]?secret|private[_ -]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{8,}/i
  },
  {
    name: "password-assignment",
    pattern: /\b(?:password|passwd|pwd)\b\s*[:=]\s*["']?[^\s"']{4,}/i
  },
  {
    name: "service-role",
    pattern: /\bservice[_ -]?role\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{4,}/i
  }
] as const;

const INSSA_ALLOWED_AUTH_NETWORK_PATTERNS = [
  /securetoken\.googleapis\.com\/v1\/token/i,
  /identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/i
] as const;

test.describe("INSSA compose stability", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  test("authenticated compose surface stays mounted without unexpected writes", async ({ page, context }, testInfo) => {
    test.slow();

    const errorMonitor = createInssaErrorMonitor(page);
    const securityMonitor = createConsoleSecurityMonitor(page, {
      sensitivePatterns: [...INSSA_SENSITIVE_PATTERNS]
    });
    const landing = new LandingPage(page);
    const compose = new TimeCapsulePage(page);
    const writeMonitor = createUnexpectedWriteMonitor(page);

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
        phase: "navigation",
        route: "/"
      });
      await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
        phase: "assertion"
      });
      await monitor.step("open authenticated compose entry", () => landing.openBuryEntry(), { phase: "interaction" });
      await monitor.step("assert compose surface and metadata", async () => {
        await compose.expectComposeSurface();
        await compose.expectRequiredFieldMetadata();
        await expectAuthenticatedUrl(page, "initial compose render");
      }, { phase: "assertion", route: "/timecapsule" });

      await monitor.step("refresh compose without unmounting or redirecting", async () => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForSettledSurface(page);
        await compose.expectComposeSurface();
        await compose.expectRequiredFieldMetadata();
        await expectAuthenticatedUrl(page, "compose refresh");
      }, { phase: "navigation" });

      await monitor.step("background and refocus compose without auth reset", async () => {
        const secondary = await context.newPage();
        try {
          await secondary.goto("about:blank");
          await secondary.bringToFront();
          await page.waitForTimeout(750);
          await page.bringToFront();
          await page.waitForTimeout(1_000);
        } finally {
          await secondary.close().catch(() => {});
        }

        await waitForSettledSurface(page);
        await compose.expectComposeSurface();
        await compose.expectRequiredFieldMetadata();
        await expectAuthenticatedUrl(page, "compose focus restore");
      }, { phase: "interaction" });

      const slowNetworkHandler = async (route: Route) => {
        const request = route.request();
        if (request.isNavigationRequest() || ["document", "xhr", "fetch"].includes(request.resourceType())) {
          await delay(300);
        }
        await route.continue();
      };

      await context.route("**/*", slowNetworkHandler);

      try {
        await monitor.step("reload compose under delayed network", async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
          await waitForSettledSurface(page, 20_000);
          await compose.expectComposeSurface();
          await compose.expectRequiredFieldMetadata();
          await expectAuthenticatedUrl(page, "slow-network compose reload");
        }, { phase: "navigation" });
      } finally {
        await context.unroute("**/*", slowNetworkHandler);
      }

      await monitor.step("assert compose stayed non-destructive", () => writeMonitor.expectNoUnexpectedWrites(), {
        phase: "assertion"
      });
      await monitor.step(
        "assert no sensitive token or secret leakage",
        () => securityMonitor.expectNoSensitiveLogs([...INSSA_ALLOWED_AUTH_NETWORK_PATTERNS]),
        {
          phase: "assertion"
        }
      );
      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});

function createUnexpectedWriteMonitor(page: Page) {
  const suspiciousWrites: string[] = [];

  page.on("request", (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      return;
    }

    const url = request.url();
    if (isAllowedBackgroundWrite(url)) {
      return;
    }

    suspiciousWrites.push(`${request.method()} ${url}`);
  });

  return {
    suspiciousWrites,
    expectNoUnexpectedWrites() {
      expect(
        suspiciousWrites,
        suspiciousWrites.length === 0
          ? "Expected the non-destructive compose audit to avoid capsule creation, draft persistence, or other app writes."
          : `Unexpected write requests during compose stability audit:\n${suspiciousWrites.join("\n")}`
      ).toEqual([]);
    }
  };
}

function isAllowedBackgroundWrite(url: string): boolean {
  return /google-analytics\.com\/g\/collect|sentry\.io\/api\/|csp\.withgoogle\.com\/csp\/|google\.firestore\.v1\.Firestore\/(?:Listen|Write)\/channel|identitytoolkit\.googleapis\.com\/v1\/accounts:lookup|securetoken\.googleapis\.com\/v1\/token|firebaseinstallations\.googleapis\.com|maps\.googleapis\.com\/\$rpc\/google\.internal\.maps\.mapsjs\.v1\.MapsJsInternalService\/GetViewportInfo|GetUserProfileByEmail|SocialLoginJWT/i.test(
    url
  ) || /firestore\.googleapis\.com\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents:runAggregationQuery/i.test(
    url
  );
}

async function expectAuthenticatedUrl(page: Page, contextLabel: string): Promise<void> {
  const url = page.url();
  expect(
    !/\/signin\/?$|\/sign-in\/?$|\/login\/?$|\/auth/i.test(url),
    `Expected ${contextLabel} to remain on an authenticated INSSA compose route, but landed on "${url}".`
  ).toBeTruthy();
}

async function waitForSettledSurface(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  await expectPageNotBlank(page);

  const progressbar = page.getByRole("progressbar").first();
  if (await progressbar.isVisible().catch(() => false)) {
    await expect(progressbar, "Expected compose loading to finish before assertions.").toBeHidden({ timeout }).catch(
      () => {}
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
