import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { InssaPage } from "../../pages/inssa/inssa-page";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import {
  createInssaErrorMonitor,
  ensureInssaAuthStorageState,
  getInssaTestCredentials
} from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  INSSA_STABLE_ROUTE_CASES,
  INSSA_TIME_CAPSULE_NEXT_PATTERN,
  type InssaStableRouteCase,
  type InssaStableSurface
} from "../../utils/inssa-test-data";

type RouteMode = "logged-in" | "logged-out";
type RouteStatus = "passed" | "failed";
type RouteFailureType =
  | "auth-flicker"
  | "console-error"
  | "hydration-failure"
  | "redirect-loop"
  | "security"
  | "timeout"
  | "unexpected-logout"
  | "unknown";

type RouteCoverageRecord = {
  acceptableIssueCount: number;
  actualResult: string;
  error?: string;
  expectedBehavior: string;
  failureType?: RouteFailureType;
  finalPath: string;
  finalUrl: string;
  issueCategorySummary: Record<string, number>;
  label: string;
  mode: RouteMode;
  navigationCount: number;
  nextRedirectPreserved?: boolean;
  requestedPath: string;
  stableUrl: string;
  status: RouteStatus;
  surface: InssaStableSurface;
  urlStable: boolean;
};

test.describe("INSSA route coverage", () => {
  test.setTimeout(240_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
  });

  test("logged-out stable route matrix preserves redirects and hydration", async ({ browser }, testInfo) => {
    const coverage: RouteCoverageRecord[] = [];

    for (const routeCase of INSSA_STABLE_ROUTE_CASES) {
      await test.step(`logged out route ${routeCase.path}`, async () => {
        coverage.push(await probeRoute(browser, routeCase, "logged-out"));
      });
    }

    await attachCoverageSummary(testInfo, "logged-out", coverage);

    const failures = coverage.filter((record) => record.status === "failed");
    expect(
      failures,
      failures.length === 0
        ? "Expected all logged-out stable INSSA route probes to pass."
        : formatCoverageFailures("logged-out", failures)
    ).toEqual([]);
  });

  test("logged-in stable route matrix preserves authenticated surfaces", async ({ browser }, testInfo) => {
    getInssaTestCredentials();
    const storageStatePath = await ensureInssaAuthStorageState(browser);
    const coverage: RouteCoverageRecord[] = [];

    for (const routeCase of INSSA_STABLE_ROUTE_CASES.filter((candidate) => candidate.access !== "auth")) {
      await test.step(`logged in route ${routeCase.path}`, async () => {
        coverage.push(await probeRoute(browser, routeCase, "logged-in", storageStatePath));
      });
    }

    await attachCoverageSummary(testInfo, "logged-in", coverage);

    const failures = coverage.filter((record) => record.status === "failed");
    expect(
      failures,
      failures.length === 0
        ? "Expected all logged-in stable INSSA route probes to pass."
        : formatCoverageFailures("logged-in", failures)
    ).toEqual([]);
  });
});

async function probeRoute(
  browser: Browser,
  routeCase: InssaStableRouteCase,
  mode: RouteMode,
  storageStatePath?: string
): Promise<RouteCoverageRecord> {
  const context = await browser.newContext({
    baseURL: assertValidInssaUrl(),
    storageState: storageStatePath
  });
  const page = await context.newPage();
  const landing = new LandingPage(page);
  const inssa = new InssaPage(page);
  const compose = new TimeCapsulePage(page);
  const errorMonitor = createInssaErrorMonitor(page);
  const navigationHistory: string[] = [];

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navigationHistory.push(frame.url());
    }
  });

  const expectation = mode === "logged-in" ? routeCase.loggedIn : routeCase.loggedOut;

  const record: RouteCoverageRecord = {
    acceptableIssueCount: 0,
    actualResult: "not-started",
    expectedBehavior: describeExpectedBehavior(routeCase, mode),
    finalPath: "about:blank",
    finalUrl: "about:blank",
    issueCategorySummary: {},
    label: routeCase.label,
    mode,
    navigationCount: 0,
    nextRedirectPreserved: undefined,
    requestedPath: routeCase.path,
    stableUrl: "about:blank",
    status: "passed",
    surface: expectation.surface,
    urlStable: false
  };

  try {
    await inssa.goToPath(routeCase.path, { allowHttpError: false });
    await inssa.expectHealthyPage();
    await inssa.expectNoGenericShell();

    await assertExpectedSurface({
      compose,
      inssa,
      landing,
      mode,
      page,
      record,
      routeCase
    });

    const stableUrl = await waitForStableUrl(page, 12_000, 1_500);
    record.stableUrl = stableUrl;
    record.urlStable = stableUrl === page.url();

    if (!record.urlStable) {
      throw new Error(`Expected route "${routeCase.path}" to stabilize, but URL kept changing.`);
    }

    await expect
      .poll(() => page.url(), {
        message: `Expected INSSA route "${routeCase.path}" to avoid auth/session flicker after load.`,
        timeout: 5_000
      })
      .toBe(record.stableUrl);

    if (mode === "logged-in") {
      expect(
        !/\/signin\/?$|\/sign-in\/?$|\/login\/?$|\/auth/i.test(page.url()),
        `Expected authenticated INSSA route "${routeCase.path}" to avoid unexpected logout.`
      ).toBeTruthy();
    }

    await errorMonitor.expectNoUnexpectedErrors();
  } catch (error) {
    record.status = "failed";
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    const classified = errorMonitor.classifyIssues();
    record.acceptableIssueCount = classified.filter(({ severity }) => severity === "acceptable").length;
    record.issueCategorySummary = errorMonitor.summarizeCategories();
    record.finalUrl = page.url() || "about:blank";
    record.finalPath = currentPath(page);
    record.navigationCount = navigationHistory.length;
    record.failureType = classifyFailureType(record);
    record.actualResult = describeActualResult(record);
    logRouteResult(record);
    await context.close().catch(() => {});
  }

  return record;
}

async function assertExpectedSurface(input: {
  compose: TimeCapsulePage;
  inssa: InssaPage;
  landing: LandingPage;
  mode: RouteMode;
  page: Page;
  record: RouteCoverageRecord;
  routeCase: InssaStableRouteCase;
}) {
  const expectation = input.mode === "logged-in" ? input.routeCase.loggedIn : input.routeCase.loggedOut;
  const currentPathValue = currentPath(input.page);

  expect(
    expectation.finalPathPattern.test(currentPathValue),
    `Expected route "${input.routeCase.path}" in ${input.mode} mode to resolve to a path matching ${expectation.finalPathPattern}, but landed on "${currentPathValue}".`
  ).toBeTruthy();

  switch (expectation.surface) {
    case "landing-public":
      await input.landing.expectPublicLandingSurface();
      return;
    case "landing-authenticated":
      await input.landing.expectAuthenticatedLandingSurface();
      return;
    case "auth":
      await input.inssa.expectAuthSurface();
      if (input.mode === "logged-out" && input.routeCase.path.includes("/timecapsule")) {
        input.record.nextRedirectPreserved = INSSA_TIME_CAPSULE_NEXT_PATTERN.test(input.page.url());
      }
      return;
    case "profile":
      await input.inssa.expectStableProfileSurface();
      return;
    case "points-ledger":
      await input.inssa.expectPointsLedgerSurface();
      return;
    case "settings":
      await input.inssa.expectSettingsSurface();
      return;
    case "connections":
      await input.inssa.expectConnectionsSurface();
      return;
    case "requests":
      await input.inssa.expectRequestsSurface();
      return;
    case "compose":
      await input.compose.expectComposeSurface();
      return;
  }
}

async function waitForStableUrl(page: Page, timeout = 8_000, quietWindowMs = 1_200) {
  const deadline = Date.now() + timeout;
  let lastUrl = page.url();
  let stableSince = Date.now();

  while (Date.now() <= deadline) {
    await page.waitForTimeout(200);
    const currentUrlValue = page.url();
    if (currentUrlValue !== lastUrl) {
      lastUrl = currentUrlValue;
      stableSince = Date.now();
      continue;
    }

    if (Date.now() - stableSince >= quietWindowMs) {
      return currentUrlValue;
    }
  }

  return page.url();
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
  await testInfo.attach(`inssa-stable-route-coverage-${mode}.json`, {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json"
  });
}

function describeExpectedBehavior(routeCase: InssaStableRouteCase, mode: RouteMode): string {
  const expectation = mode === "logged-in" ? routeCase.loggedIn : routeCase.loggedOut;
  return `${routeCase.path} resolves to ${expectation.surface} without hydration failure or auth flicker`;
}

function classifyFailureType(record: RouteCoverageRecord): RouteFailureType | undefined {
  if (record.status !== "failed") {
    return undefined;
  }

  const failureText = `${record.error ?? ""}\n${record.actualResult}`;
  if (/timed out|TimeoutError|Unable to load INSSA path/i.test(failureText)) {
    return "timeout";
  }

  if (/kept changing|redirect/i.test(failureText)) {
    return "redirect-loop";
  }

  if (/unexpected logout|signin/i.test(failureText)) {
    return "unexpected-logout";
  }

  if (/JavaScript shell|hydrate|generic JavaScript shell/i.test(failureText)) {
    return "hydration-failure";
  }

  if (/Sensitive|token|secret/i.test(failureText)) {
    return "security";
  }

  if (/Unexpected INSSA issues/i.test(failureText)) {
    return "console-error";
  }

  if (/flicker/i.test(failureText)) {
    return "auth-flicker";
  }

  return "unknown";
}

function describeActualResult(record: RouteCoverageRecord): string {
  return [
    `${record.requestedPath} -> ${record.finalPath}`,
    `surface=${record.surface}`,
    `stable=${record.urlStable}`,
    `navigations=${record.navigationCount}`,
    `acceptableIssues=${record.acceptableIssueCount}`,
    record.nextRedirectPreserved === undefined ? null : `nextPreserved=${record.nextRedirectPreserved}`
  ]
    .filter(Boolean)
    .join(" ");
}

function formatCoverageFailures(mode: RouteMode, failures: RouteCoverageRecord[]): string {
  return [
    `INSSA ${mode} stable route failures:`,
    ...failures.map(
      (failure) =>
        `${failure.requestedPath} -> ${failure.finalPath} [${failure.failureType ?? "unknown"}] ${failure.error ?? failure.actualResult}`
    )
  ].join("\n");
}

function currentPath(page: Page): string {
  try {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  } catch {
    return page.url();
  }
}

function logRouteResult(record: RouteCoverageRecord): void {
  console.log(`INSSA_ROUTE_RESULT ${JSON.stringify(record)}`);
}
