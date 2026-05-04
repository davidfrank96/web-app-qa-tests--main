import { expect, type Locator, type Page, type Request, type Response } from "@playwright/test";

type CriticalPageIssueKind = "console" | "pageerror" | "requestfailed" | "response";
const SAFE_CLIENT_ERROR_STATUSES = new Set([400, 401, 403, 404, 422]);

type CriticalPageIssue = {
  kind: CriticalPageIssueKind;
  message: string;
  method?: string;
  pageUrl: string;
  requestUrl?: string;
  resourceType?: string;
  status?: number;
};

export async function expectPageReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("body")).toBeVisible();
}

export function collectCriticalPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }

    const text = `console: ${message.text()}`;
    if (isSafeClientConsoleError(text)) {
      return;
    }

    errors.push(text);
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

export async function expectNoCriticalConsoleErrors(errors: string[]): Promise<void> {
  expect(
    errors,
    errors.length === 0
      ? "Expected no critical console or page errors."
      : `Unexpected critical console or page errors:\n${errors.join("\n")}`
  ).toEqual([]);
}

export async function expectPageNotBlank(page: Page): Promise<void> {
  await expectPageReady(page);
  const bodyText = (await page.locator("body").textContent())?.replace(/\s+/g, " ").trim() ?? "";
  const interactiveCount = await page
    .locator("a[href], button, input:not([type='hidden']), select, textarea")
    .count();

  expect(
    bodyText.length > 0 || interactiveCount > 0,
    "Expected the page to render text or interactive controls instead of a blank document."
  ).toBeTruthy();
}

export async function expectVisiblePageUi(
  page: Page,
  message = "Expected the page to expose at least one visible UI element.",
  minimum = 1
): Promise<void> {
  await expectVisibleInteractiveElements(
    page.locator(
      [
        "main",
        "[role='main']",
        "header",
        "nav",
        "h1",
        "h2",
        "h3",
        "[role='heading']",
        "[role='status']",
        "[role='region']",
        "a[href]",
        "button",
        "input:not([type='hidden'])",
        "select",
        "textarea"
      ].join(", ")
    ),
    message,
    minimum
  );
}

export async function expectVisibleInteractiveElements(
  locator: Locator,
  message: string,
  minimum = 1
): Promise<void> {
  const visibleCount = await countVisible(locator);
  expect(visibleCount, message).toBeGreaterThanOrEqual(minimum);
}

export function createCriticalPageMonitor(
  page: Page,
  options: {
    ignorePatterns?: RegExp[];
    isCriticalRequestFailure?: (request: Request, page: Page) => boolean;
    isCriticalResponse?: (response: Response, page: Page) => boolean;
  } = {}
) {
  const issues: CriticalPageIssue[] = [];
  const ignorePatterns = options.ignorePatterns ?? [];
  const isCriticalRequestFailure = options.isCriticalRequestFailure ?? defaultIsCriticalRequestFailure;
  const isCriticalResponse = options.isCriticalResponse ?? defaultIsCriticalResponse;

  const recordIssue = (issue: Omit<CriticalPageIssue, "pageUrl">) => {
    issues.push({
      ...issue,
      pageUrl: page.url() || "about:blank"
    });
  };

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }

    const location = message.location();
    const locationSuffix = location.url ? ` (source: ${location.url}:${location.lineNumber}:${location.columnNumber})` : "";
    const consoleMessage = `${message.text()}${locationSuffix}`;
    if (isSafeClientConsoleError(consoleMessage)) {
      return;
    }

    recordIssue({
      kind: "console",
      message: consoleMessage
    });
  });

  page.on("pageerror", (error) => {
    recordIssue({
      kind: "pageerror",
      message: error.message
    });
  });

  page.on("requestfailed", (request) => {
    if (!isCriticalRequestFailure(request, page)) {
      return;
    }

    recordIssue({
      kind: "requestfailed",
      message: request.failure()?.errorText ?? "Request failed without a browser error message.",
      method: request.method(),
      requestUrl: request.url(),
      resourceType: request.resourceType()
    });
  });

  page.on("response", (response) => {
    if (!isCriticalResponse(response, page)) {
      return;
    }

    recordIssue({
      kind: "response",
      message: `Critical response returned HTTP ${response.status()}.`,
      method: response.request().method(),
      requestUrl: response.url(),
      resourceType: response.request().resourceType(),
      status: response.status()
    });
  });

  return {
    issues,
    async expectNoCriticalIssues(extraIgnorePatterns: RegExp[] = []) {
      const unexpected = issues.filter(
        (issue) =>
          !isSafeClientIssue(issue) && !matchesAnyPattern(issue, ignorePatterns.concat(extraIgnorePatterns))
      );

      expect(
        unexpected.length,
        unexpected.length === 0
          ? "Expected no critical console, page, or network issues."
          : `Unexpected critical issues:\n${unexpected.map(formatCriticalIssue).join("\n")}`
      ).toBe(0);
    }
  };
}

async function countVisible(locator: Locator): Promise<number> {
  const total = await locator.count();
  let visibleCount = 0;

  for (let index = 0; index < total; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      visibleCount += 1;
    }
  }

  return visibleCount;
}

function defaultIsCriticalRequestFailure(request: Request, page: Page): boolean {
  if (request.isNavigationRequest()) {
    return true;
  }

  if (!["xhr", "fetch"].includes(request.resourceType())) {
    return false;
  }

  return isSameOriginAppRequest(request.url(), page) || /\/api\/|vendors?|discover|directory|nearby|search/i.test(request.url());
}

function defaultIsCriticalResponse(response: Response, page: Page): boolean {
  if (!isCriticalResponseStatus(response.status())) {
    return false;
  }

  const request = response.request();
  if (request.isNavigationRequest()) {
    return true;
  }

  if (!["xhr", "fetch"].includes(request.resourceType())) {
    return false;
  }

  return isSameOriginAppRequest(response.url(), page) || /\/api\/|vendors?|discover|directory|nearby|search/i.test(response.url());
}

function isCriticalResponseStatus(status: number): boolean {
  return status >= 500;
}

function isSameOriginAppRequest(url: string, page: Page): boolean {
  const pageOrigin = getOrigin(page.url());
  const requestOrigin = getOrigin(url);
  return Boolean(pageOrigin && requestOrigin && pageOrigin === requestOrigin);
}

function getOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function matchesAnyPattern(issue: CriticalPageIssue, patterns: RegExp[]): boolean {
  const searchableValues = [
    issue.kind,
    issue.message,
    issue.pageUrl,
    issue.requestUrl ?? "",
    issue.method ?? "",
    issue.resourceType ?? "",
    String(issue.status ?? "")
  ];

  return patterns.some((pattern) => searchableValues.some((value) => pattern.test(value)));
}

function isSafeClientIssue(issue: CriticalPageIssue): boolean {
  if (issue.kind === "console") {
    return isSafeClientConsoleError(issue.message);
  }

  if (issue.kind === "response" && typeof issue.status === "number") {
    return SAFE_CLIENT_ERROR_STATUSES.has(issue.status);
  }

  return false;
}

function isSafeClientConsoleError(message: string): boolean {
  const status = extractResourceLoadStatus(message);
  if (status === null) {
    return false;
  }

  return SAFE_CLIENT_ERROR_STATUSES.has(status);
}

function extractResourceLoadStatus(message: string): number | null {
  const match = message.match(/status of (\d{3}) \([^)]+\)|HTTP (\d{3})/i);
  if (!match) {
    return null;
  }

  const candidate = match[1] ?? match[2];
  const parsed = Number(candidate);
  return Number.isInteger(parsed) ? parsed : null;
}

function formatCriticalIssue(issue: CriticalPageIssue): string {
  const parts = [`[${issue.kind}]`, `page="${issue.pageUrl}"`];

  if (issue.requestUrl) {
    parts.push(`request="${issue.requestUrl}"`);
  }

  if (issue.method) {
    parts.push(`method="${issue.method}"`);
  }

  if (issue.resourceType) {
    parts.push(`resource="${issue.resourceType}"`);
  }

  if (issue.status) {
    parts.push(`status="${issue.status}"`);
  }

  parts.push(issue.message);
  return parts.join(" ");
}
