import { expect, type Page, type Request } from "@playwright/test";

const DEFAULT_API_PATTERN = /\/api(?:\/|$|\?)/i;
const DEFAULT_API_LATENCY_THRESHOLD_MS = 2_000;

export type ApiLatencyStatus = "fail" | "pass";

export type ApiLatencyEntry = {
  durationMs: number;
  endpoint: string;
  failureReason?: string;
  httpStatus?: number;
  kind: "requestfailed" | "response";
  method: string;
  route: string;
  status: ApiLatencyStatus;
  thresholdMs: number;
  timestamp: string;
};

export function createApiLatencyMonitor(
  page: Page,
  options: {
    endpointPattern?: RegExp;
    label?: string;
    thresholdMs?: number;
  } = {}
) {
  const endpointPattern = options.endpointPattern ?? DEFAULT_API_PATTERN;
  const label = options.label ?? "localman-api-latency";
  const thresholdMs = options.thresholdMs ?? DEFAULT_API_LATENCY_THRESHOLD_MS;
  const requestStarts = new Map<Request, number>();
  const entries: ApiLatencyEntry[] = [];

  page.on("request", (request) => {
    if (!endpointPattern.test(request.url())) {
      return;
    }

    requestStarts.set(request, Date.now());
  });

  page.on("response", async (response) => {
    if (!endpointPattern.test(response.url())) {
      return;
    }

    const request = response.request();
    await response.finished().catch(() => undefined);
    const durationMs = elapsedSinceRequest(requestStarts, request);
    const httpStatus = response.status();
    const hasFailure = durationMs > thresholdMs || httpStatus >= 500;

    const entry: ApiLatencyEntry = {
      durationMs,
      endpoint: response.url(),
      failureReason: hasFailure
        ? httpStatus >= 500
          ? `HTTP ${httpStatus}`
          : `Exceeded ${thresholdMs}ms`
        : undefined,
      httpStatus,
      kind: "response",
      method: request.method(),
      route: toRoute(page.url()),
      status: hasFailure ? "fail" : "pass",
      thresholdMs,
      timestamp: new Date().toISOString()
    };

    entries.push(entry);
    logEntry(label, entry);
  });

  page.on("requestfailed", (request) => {
    if (!endpointPattern.test(request.url())) {
      return;
    }

    const entry: ApiLatencyEntry = {
      durationMs: elapsedSinceRequest(requestStarts, request),
      endpoint: request.url(),
      failureReason: request.failure()?.errorText ?? "request failed",
      kind: "requestfailed",
      method: request.method(),
      route: toRoute(page.url()),
      status: "fail",
      thresholdMs,
      timestamp: new Date().toISOString()
    };

    entries.push(entry);
    logEntry(label, entry);
  });

  return {
    entries,
    async waitForApiActivity(
      options: {
        minimum?: number;
        timeoutMs?: number;
      } = {}
    ): Promise<ApiLatencyEntry[]> {
      const minimum = options.minimum ?? 1;
      const timeoutMs = options.timeoutMs ?? 10_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (entries.length >= minimum) {
          return entries.slice();
        }

        await page.waitForTimeout(100);
      }

      throw new Error(
        `Expected at least ${minimum} /api requests matching ${endpointPattern} within ${timeoutMs}ms.`
      );
    },

    expectNoApiLatencyFailures(options: { minimum?: number } = {}) {
      const minimum = options.minimum ?? 1;

      expect(
        entries.length,
        `Expected at least ${minimum} API latency entries to be recorded for ${endpointPattern}.`
      ).toBeGreaterThanOrEqual(minimum);

      const failures = entries.filter((entry) => entry.status === "fail");

      expect(
        failures,
        failures.length === 0
          ? "Expected all monitored /api requests to stay under the latency threshold and avoid server failures."
          : `Unexpected /api latency failures:\n${failures.map(formatEntry).join("\n")}`
      ).toEqual([]);
    }
  };
}

function elapsedSinceRequest(requestStarts: Map<Request, number>, request: Request): number {
  return Date.now() - (requestStarts.get(request) ?? Date.now());
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

function logEntry(label: string, entry: ApiLatencyEntry): void {
  console.log(`LOCALMAN_API_LATENCY ${JSON.stringify({ label, ...entry })}`);
}

function formatEntry(entry: ApiLatencyEntry): string {
  const httpStatus = typeof entry.httpStatus === "number" ? ` status=${entry.httpStatus}` : "";
  const failureReason = entry.failureReason ? ` reason=${entry.failureReason}` : "";
  return `${entry.kind} ${entry.method} ${entry.endpoint}${httpStatus} route=${entry.route} duration=${entry.durationMs}ms threshold=${entry.thresholdMs}ms${failureReason}`;
}
