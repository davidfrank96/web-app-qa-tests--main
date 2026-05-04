import { expect, type Page, type Response } from "@playwright/test";

const REQUIRED_SECURITY_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "x-content-type-options"
] as const;

export type RequiredSecurityHeader = (typeof REQUIRED_SECURITY_HEADERS)[number];
export type SecurityHeaderStatus = "fail" | "pass";

export type SecurityHeaderEntry = {
  headers: Record<RequiredSecurityHeader, string | null>;
  missingHeaders: RequiredSecurityHeader[];
  route: string;
  status: SecurityHeaderStatus;
  timestamp: string;
  url: string;
};

export function createSecurityHeaderMonitor(
  page: Page,
  options: {
    label?: string;
  } = {}
) {
  const label = options.label ?? "localman-security-headers";
  const entries: SecurityHeaderEntry[] = [];

  page.on("response", (response) => {
    if (!shouldCaptureResponse(response, page)) {
      return;
    }

    const entry = buildSecurityHeaderEntry(page, response);
    entries.push(entry);
    logEntry(label, entry);
  });

  return {
    entries,
    async waitForHeaderChecks(
      options: {
        minimum?: number;
        timeoutMs?: number;
      } = {}
    ): Promise<SecurityHeaderEntry[]> {
      const minimum = options.minimum ?? 1;
      const timeoutMs = options.timeoutMs ?? 10_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (entries.length >= minimum) {
          return entries.slice();
        }

        await page.waitForTimeout(100);
      }

      throw new Error(`Expected at least ${minimum} security-header checks within ${timeoutMs}ms.`);
    },

    expectRequiredHeaders(options: { minimum?: number } = {}) {
      const minimum = options.minimum ?? 1;

      expect(
        entries.length,
        `Expected at least ${minimum} security-header entries to be recorded.`
      ).toBeGreaterThanOrEqual(minimum);

      const failures = entries.filter((entry) => entry.status === "fail");

      expect(
        failures,
        failures.length === 0
          ? "Expected required security headers to be present."
          : `Missing required security headers:\n${failures.map(formatEntry).join("\n")}`
      ).toEqual([]);
    }
  };
}

export function validateRequiredSecurityHeaders(
  headers: Record<string, string | undefined>
): SecurityHeaderEntry["missingHeaders"] {
  return REQUIRED_SECURITY_HEADERS.filter((headerName) => !normalizeHeaderValue(headers[headerName]));
}

function buildSecurityHeaderEntry(page: Page, response: Response): SecurityHeaderEntry {
  const responseHeaders = response.headers();
  const headers: Record<RequiredSecurityHeader, string | null> = {
    "content-security-policy": normalizeHeaderValue(responseHeaders["content-security-policy"]),
    "x-content-type-options": normalizeHeaderValue(responseHeaders["x-content-type-options"]),
    "x-frame-options": normalizeHeaderValue(responseHeaders["x-frame-options"])
  };
  const missingHeaders = validateRequiredSecurityHeaders(responseHeaders);

  return {
    headers,
    missingHeaders,
    route: toRoute(page.url() || response.url()),
    status: missingHeaders.length === 0 ? "pass" : "fail",
    timestamp: new Date().toISOString(),
    url: response.url()
  };
}

function shouldCaptureResponse(response: Response, page: Page): boolean {
  const request = response.request();
  if (request.isNavigationRequest()) {
    return true;
  }

  if (request.resourceType() !== "document") {
    return false;
  }

  return isSameOrigin(response.url(), page.url());
}

function isSameOrigin(candidateUrl: string, pageUrl: string): boolean {
  try {
    return new URL(candidateUrl).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

function normalizeHeaderValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function toRoute(urlOrPath: string): string {
  if (!urlOrPath) {
    return "/";
  }

  try {
    const url = new URL(urlOrPath);
    return `${url.pathname}${url.search}`;
  } catch {
    return urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
  }
}

function logEntry(label: string, entry: SecurityHeaderEntry): void {
  console.log(`LOCALMAN_SECURITY_HEADERS ${JSON.stringify({ label, ...entry })}`);
}

function formatEntry(entry: SecurityHeaderEntry): string {
  return `${entry.url} route=${entry.route} missing=${entry.missingHeaders.join(", ")} headers=${JSON.stringify(entry.headers)}`;
}
