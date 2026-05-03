import { expect, test, type Browser, type TestInfo } from "@playwright/test";
import { InssaPage } from "../../pages/inssa/inssa-page";
import { expectPageNotBlank } from "../../utils/assertions";
import {
  createInssaErrorMonitor,
  ensureInssaAuthStorageState,
  getInssaTestCredentials
} from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";

type RouteAccess = "public" | "auth" | "protected";
type RouteMode = "logged-out" | "logged-in";
type RouteStatus = "passed" | "failed";
type RouteFailureType = "timeout" | "no-redirect" | "blank-page" | "console-error" | "unknown";
type RouteBehavior =
  | "authenticated-route"
  | "authenticated-surface"
  | "auth-route"
  | "auth-surface"
  | "public-entry"
  | "unknown";

type RouteCase = {
  access: RouteAccess;
  label: string;
  path: string;
};

type RouteCoverageRecord = {
  access: RouteAccess;
  actualResult: string;
  behavior: RouteBehavior;
  consoleErrorCount: number;
  consoleErrors: string[];
  error?: string;
  expectedBehavior: string;
  finalPath: string;
  finalUrl: string;
  loadTimeMs: number;
  label: string;
  mode: RouteMode;
  pageErrorCount: number;
  requestedPath: string;
  redirected: boolean;
  requestFailureCount: number;
  routeDurationMs: number;
  failureType?: RouteFailureType;
  status: RouteStatus;
};

const ROUTE_CASES: RouteCase[] = [
  { access: "public", label: "home", path: "/" },
  { access: "auth", label: "sign-in", path: "/signin" },
  { access: "protected", label: "dashboard", path: "/dashboard" },
  { access: "protected", label: "profile", path: "/profile" },
  { access: "protected", label: "me", path: "/me" },
  { access: "protected", label: "edit-profile", path: "/profile/edit" },
  { access: "protected", label: "connections", path: "/profile/connections" },
  { access: "protected", label: "requests", path: "/profile/connections/requests" }
];

test.describe("INSSA route coverage", () => {
  test.setTimeout(240_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
  });

  test("logged-out route matrix covers public, auth, and protected entry points", async ({ browser }, testInfo) => {
    const coverage: RouteCoverageRecord[] = [];

    for (const routeCase of ROUTE_CASES) {
      await test.step(`logged out route ${routeCase.path}`, async () => {
        coverage.push(await probeRoute(browser, routeCase, "logged-out"));
      });
    }

    await attachCoverageSummary(testInfo, "logged-out", coverage);

    const failures = coverage.filter((record) => record.status === "failed");
    expect(
      failures,
      failures.length === 0
        ? "Expected all logged-out route probes to pass."
        : formatCoverageFailures("logged-out", failures)
    ).toEqual([]);
  });

  test("logged-in route matrix covers public, auth, and protected entry points", async ({ browser }, testInfo) => {
    getInssaTestCredentials();
    const storageStatePath = await ensureInssaAuthStorageState(browser);
    const coverage: RouteCoverageRecord[] = [];

    for (const routeCase of ROUTE_CASES) {
      await test.step(`logged in route ${routeCase.path}`, async () => {
        coverage.push(await probeRoute(browser, routeCase, "logged-in", storageStatePath));
      });
    }

    await attachCoverageSummary(testInfo, "logged-in", coverage);

    const failures = coverage.filter((record) => record.status === "failed");
    expect(
      failures,
      failures.length === 0
        ? "Expected all logged-in route probes to pass."
        : formatCoverageFailures("logged-in", failures)
    ).toEqual([]);
  });
});

async function probeRoute(
  browser: Browser,
  routeCase: RouteCase,
  mode: RouteMode,
  storageStatePath?: string
): Promise<RouteCoverageRecord> {
  const context = await browser.newContext({
    baseURL: assertValidInssaUrl(),
    storageState: storageStatePath
  });
  const page = await context.newPage();
  const inssa = new InssaPage(page);
  const errorMonitor = createInssaErrorMonitor(page, { defaultIgnorePatterns: [] });
  errorMonitor.setAction(`probe route ${mode} ${routeCase.path}`);
  const routeStartedAt = Date.now();
  let navigationStartedAt = 0;

  const record: RouteCoverageRecord = {
    access: routeCase.access,
    actualResult: "not-started",
    behavior: "unknown",
    consoleErrorCount: 0,
    consoleErrors: [],
    finalPath: "about:blank",
    finalUrl: "about:blank",
    expectedBehavior: describeExpectedBehavior(routeCase, mode),
    loadTimeMs: 0,
    label: routeCase.label,
    mode,
    pageErrorCount: 0,
    requestedPath: routeCase.path,
    redirected: false,
    requestFailureCount: 0,
    routeDurationMs: 0,
    status: "passed"
  };

  try {
    navigationStartedAt = Date.now();
    await inssa.goToPath(routeCase.path);
    record.loadTimeMs = Date.now() - navigationStartedAt;
    await expectPageNotBlank(page);

    if (mode === "logged-out") {
      await assertLoggedOutRoute(routeCase, inssa);
    } else {
      await assertLoggedInRoute(routeCase, inssa);
    }

    await errorMonitor.expectNoUnexpectedErrors();
  } catch (error) {
    if (navigationStartedAt > 0 && record.loadTimeMs === 0) {
      record.loadTimeMs = Date.now() - navigationStartedAt;
    }
    record.status = "failed";
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    record.routeDurationMs = Date.now() - routeStartedAt;
    record.finalUrl = page.url() || "about:blank";
    record.finalPath = inssa.currentPath() || "about:blank";
    record.behavior = await classifyRouteBehavior(inssa);
    record.redirected = normalizePath(record.requestedPath) !== normalizePath(record.finalPath);
    applyIssueDiagnostics(record, errorMonitor.issues);
    record.failureType = classifyFailureType(record);
    record.actualResult = describeActualResult(record);
    logRouteResult(record);
    await context.close().catch(() => {});
  }

  return record;
}

async function assertLoggedOutRoute(routeCase: RouteCase, inssa: InssaPage): Promise<void> {
  switch (routeCase.access) {
    case "public":
      await inssa.expectAnyActionableButton();
      if (routeCase.path === "/") {
        await inssa.expectLandingCTAVisible();
      }
      return;

    case "auth":
      await inssa.expectAuthSurface();
      return;

    case "protected": {
      const redirectedToEntry =
        inssa.isAuthRoute() ||
        (await inssa.hasAuthSurface()) ||
        (await inssa.hasPublicEntrySurface());

      expect(
        redirectedToEntry,
        `Expected logged-out access to "${routeCase.path}" to redirect to a public or auth surface.`
      ).toBeTruthy();
      await inssa.expectPublicOrAuthEntrySurface();
      return;
    }
  }
}

async function assertLoggedInRoute(routeCase: RouteCase, inssa: InssaPage): Promise<void> {
  switch (routeCase.access) {
    case "public":
      await inssa.expectAnyActionableButton();
      return;

    case "auth": {
      const authenticated = inssa.isAuthenticatedRoute() || (await inssa.hasAuthenticatedSurface());
      const authSurface = inssa.isAuthRoute() || (await inssa.hasAuthSurface());

      expect(
        authenticated || authSurface,
        `Expected logged-in access to "${routeCase.path}" to expose authenticated UI or a stable auth surface.`
      ).toBeTruthy();

      if (authenticated) {
        await inssa.expectAuthenticatedSurface();
      } else {
        await inssa.expectAuthSurface();
      }
      return;
    }

    case "protected":
      expect(
        inssa.isAuthenticatedRoute() || (await inssa.hasAuthenticatedSurface()),
        `Expected logged-in access to "${routeCase.path}" to reach authenticated INSSA UI.`
      ).toBeTruthy();
      await inssa.expectAuthenticatedSurface();
      return;
  }
}

async function classifyRouteBehavior(inssa: InssaPage): Promise<RouteBehavior> {
  if (await inssa.hasAuthenticatedSurface()) {
    return "authenticated-surface";
  }

  if (inssa.isAuthenticatedRoute()) {
    return "authenticated-route";
  }

  if (await inssa.hasAuthSurface()) {
    return "auth-surface";
  }

  if (inssa.isAuthRoute()) {
    return "auth-route";
  }

  if (await inssa.hasPublicEntrySurface()) {
    return "public-entry";
  }

  return "unknown";
}

async function attachCoverageSummary(
  testInfo: TestInfo,
  mode: RouteMode,
  coverage: RouteCoverageRecord[]
): Promise<void> {
  const summary = {
    mode,
    routes: coverage
  };

  console.log(`INSSA_ROUTE_COVERAGE ${JSON.stringify(summary)}`);
  await testInfo.attach(`inssa-route-coverage-${mode}.json`, {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json"
  });
}

function formatCoverageFailures(mode: RouteMode, failures: RouteCoverageRecord[]): string {
  return [
    `INSSA ${mode} route coverage failures:`,
    ...failures.map(
      (failure) =>
        `${failure.requestedPath} -> ${failure.finalPath} [${failure.failureType ?? "unknown"}] ${failure.actualResult}`
    )
  ].join("\n");
}

function describeExpectedBehavior(routeCase: RouteCase, mode: RouteMode): string {
  if (mode === "logged-out") {
    if (routeCase.access === "public") {
      return 'route loads and stays public with visible actionable UI';
    }

    if (routeCase.access === "auth") {
      return "route loads an auth surface";
    }

    return "route redirects to a public or auth surface";
  }

  if (routeCase.access === "public") {
    return "route loads with visible actionable UI";
  }

  if (routeCase.access === "auth") {
    return "route resolves to authenticated UI or remains a stable auth surface";
  }

  return "route resolves to authenticated UI";
}

function applyIssueDiagnostics(
  record: RouteCoverageRecord,
  issues: Array<{ kind: string; message: string }>
): void {
  const consoleErrors = issues.filter((issue) => issue.kind === "console");
  const pageErrors = issues.filter((issue) => issue.kind === "pageerror");
  const requestFailures = issues.filter((issue) => issue.kind === "requestfailed");

  record.consoleErrorCount = consoleErrors.length;
  record.consoleErrors = consoleErrors.map((issue) => issue.message);
  record.pageErrorCount = pageErrors.length;
  record.requestFailureCount = requestFailures.length;
}

function classifyFailureType(record: RouteCoverageRecord): RouteFailureType | undefined {
  const failureText = `${record.error ?? ""}\n${record.consoleErrors.join("\n")}`;

  if (record.status !== "failed") {
    return undefined;
  }

  if (/Timeout .* exceeded|timed out|TimeoutError|Unable to load INSSA path/i.test(failureText)) {
    return "timeout";
  }

  if (/redirect to a public or auth surface/i.test(failureText)) {
    return "no-redirect";
  }

  if (/blank document|render text or interactive controls instead of a blank document/i.test(failureText)) {
    return "blank-page";
  }

  if (record.consoleErrorCount > 0 || /Unexpected INSSA issues|Failed to load resource|Firestore/i.test(failureText)) {
    return "console-error";
  }

  return "unknown";
}

function describeActualResult(record: RouteCoverageRecord): string {
  const parts = [
    `finalPath=${record.finalPath}`,
    `behavior=${record.behavior}`,
    `redirected=${String(record.redirected)}`,
    `loadTimeMs=${record.loadTimeMs}`,
    `routeDurationMs=${record.routeDurationMs}`,
    `consoleErrors=${record.consoleErrorCount}`,
    `pageErrors=${record.pageErrorCount}`,
    `requestFailures=${record.requestFailureCount}`
  ];

  if (record.error) {
    parts.push(`reason=${sanitizeForLog(record.error)}`);
  }

  return parts.join(" | ");
}

function logRouteResult(record: RouteCoverageRecord): void {
  console.log(`INSSA_ROUTE_RESULT ${JSON.stringify(record)}`);
}

function normalizePath(value: string): string {
  if (value === "/") {
    return value;
  }

  return value.replace(/\/+$/, "");
}

function sanitizeForLog(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
