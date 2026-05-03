import fs from "node:fs/promises";
import path from "node:path";
import type { ConsoleMessage, Page, Request, Response, TestInfo } from "@playwright/test";

const REPORTS_DIR = path.resolve(process.cwd(), "reports");
const REPORT_PATH = path.join(REPORTS_DIR, "localman-results.json");
const LOCK_PATH = path.join(REPORTS_DIR, ".localman-results.lock");
const SLOW_THRESHOLD_MS = 5_000;
const LOCK_TIMEOUT_MS = 10_000;

type LocalManFeature = "admin" | "api" | "discovery" | "map" | "ui";
type LocalManStatus = "fail" | "pass" | "slow";

type LocalManLoadTime = {
  durationMs: number;
  metric: string;
  route: string;
  status: LocalManStatus;
  timestamp: string;
};

type LocalManResultRecord = {
  consoleErrors: string[];
  duration: number;
  durationMs: number;
  errors: string[];
  feature: LocalManFeature;
  loadTimes: LocalManLoadTime[];
  networkFailures: string[];
  pageErrors: string[];
  route: string;
  skipped?: boolean;
  status: LocalManStatus;
  test: string;
  timestamp: string;
};

type PageState = {
  consoleErrors: string[];
  lastRoute: string;
  networkFailures: string[];
  pageErrors: string[];
};

type LocalManResultCollector = ReturnType<typeof createLocalManResultCollector>;

const collectorsByPage = new WeakMap<Page, LocalManResultCollector>();

export function createLocalManResultCollector(testInfo: TestInfo) {
  const pages = new Map<Page, PageState>();
  const loadTimes: LocalManLoadTime[] = [];
  let finalized = false;

  const collector = {
    trackPage(page: Page) {
      if (pages.has(page)) {
        return;
      }

      const state: PageState = {
        consoleErrors: [],
        lastRoute: toRoute(page.url()),
        networkFailures: [],
        pageErrors: []
      };

      page.on("console", (message) => {
        if (message.type() !== "error") {
          return;
        }

        state.consoleErrors.push(formatConsoleError(message));
      });

      page.on("pageerror", (error) => {
        state.pageErrors.push(`pageerror: ${error.message}`);
      });

      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          state.lastRoute = toRoute(frame.url());
        }
      });

      page.on("requestfailed", (request) => {
        if (!shouldCaptureRequestFailure(request)) {
          return;
        }

        state.networkFailures.push(formatRequestFailure(request));
      });

      page.on("response", (response) => {
        if (!shouldCaptureResponseFailure(response)) {
          return;
        }

        state.networkFailures.push(formatResponseFailure(response));
      });

      pages.set(page, state);
      collectorsByPage.set(page, collector);
    },

    recordLoadTime(metric: string, durationMs: number, route?: string) {
      loadTimes.push({
        durationMs,
        metric,
        route: toRoute(route ?? inferRouteFromPages(pages)),
        status: durationMs > SLOW_THRESHOLD_MS ? "slow" : "pass",
        timestamp: new Date().toISOString()
      });
    },

    async finalize() {
      if (finalized) {
        return;
      }

      finalized = true;

      const consoleErrors = [...pages.values()].flatMap((state) => state.consoleErrors);
      const pageErrors = [...pages.values()].flatMap((state) => state.pageErrors);
      const networkFailures = [...pages.values()].flatMap((state) => state.networkFailures);
      const errors = dedupe([
        ...consoleErrors,
        ...pageErrors,
        ...networkFailures,
        ...(testInfo.errors ?? []).map((error) => error.message)
      ]);
      const route = inferRouteFromPages(pages);
      const status = deriveStatus(testInfo, loadTimes);

      const record: LocalManResultRecord = {
        consoleErrors,
        duration: testInfo.duration,
        durationMs: testInfo.duration,
        errors,
        feature: inferFeature(testInfo.file),
        loadTimes,
        networkFailures,
        pageErrors,
        route,
        skipped: testInfo.status === "skipped" ? true : undefined,
        status,
        test: testInfo.titlePath.slice(1).join(" > "),
        timestamp: new Date().toISOString()
      };

      await ensureReportsDirectory();
      await appendLocalManResult(record);
      console.log(JSON.stringify(record));
      await testInfo.attach("localman-result.json", {
        body: JSON.stringify(record, null, 2),
        contentType: "application/json"
      });
    }
  };

  return collector;
}

export function recordLocalManLoadTime(
  page: Page,
  input: {
    durationMs: number;
    metric: string;
    route?: string;
  }
) {
  collectorsByPage.get(page)?.recordLoadTime(input.metric, input.durationMs, input.route);
}

async function appendLocalManResult(record: LocalManResultRecord) {
  await withReportLock(async () => {
    const existing = await readExistingResults();
    existing.push(record);
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  });
}

async function readExistingResults(): Promise<LocalManResultRecord[]> {
  try {
    const raw = await fs.readFile(REPORT_PATH, "utf8");
    if (raw.trim() === "") {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected ${REPORT_PATH} to contain a JSON array.`);
    }

    return parsed as LocalManResultRecord[];
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function withReportLock<T>(run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(LOCK_PATH);
      break;
    } catch (error) {
      if (!isErrno(error) || error.code !== "EEXIST") {
        throw error;
      }

      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting to append Local Man results at ${REPORT_PATH}.`);
      }

      await delay(50);
    }
  }

  try {
    return await run();
  } finally {
    await fs.rm(LOCK_PATH, { force: true, recursive: true });
  }
}

async function ensureReportsDirectory() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await ensureReportFile();
}

async function ensureReportFile() {
  try {
    await fs.access(REPORT_PATH);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      await fs.writeFile(REPORT_PATH, "[]\n", "utf8");
      return;
    }

    throw error;
  }
}

function inferFeature(filePath: string): LocalManFeature {
  if (/\/api\.spec\.ts$/i.test(filePath)) {
    return "api";
  }

  if (/\/(?:map|geolocation)\.spec\.ts$/i.test(filePath)) {
    return "map";
  }

  if (/\/ui\.spec\.ts$/i.test(filePath)) {
    return "ui";
  }

  if (/\/admin\//i.test(filePath) || /admin/i.test(filePath)) {
    return "admin";
  }

  return "discovery";
}

function deriveStatus(testInfo: TestInfo, loadTimes: LocalManLoadTime[]): LocalManStatus {
  if (testInfo.status !== testInfo.expectedStatus) {
    return "fail";
  }

  if (testInfo.status === "failed" || testInfo.status === "timedOut" || testInfo.status === "interrupted") {
    return "fail";
  }

  const slowLoad = loadTimes.some((loadTime) => loadTime.durationMs > SLOW_THRESHOLD_MS);
  return testInfo.duration > SLOW_THRESHOLD_MS || slowLoad ? "slow" : "pass";
}

function inferRouteFromPages(pages: Map<Page, PageState>): string {
  const routes = [...pages.values()].map((state) => state.lastRoute).filter((route) => route && route !== "about:blank");
  return routes.at(-1) ?? "/";
}

function formatConsoleError(message: ConsoleMessage): string {
  const location = message.location();
  const suffix = location.url ? ` (source: ${location.url}:${location.lineNumber}:${location.columnNumber})` : "";
  return `console: ${message.text()}${suffix}`;
}

function formatRequestFailure(request: Request): string {
  return `requestfailed: ${request.method()} ${request.url()} (${request.resourceType()}) ${
    request.failure()?.errorText ?? "Request failed"
  }`;
}

function formatResponseFailure(response: Response): string {
  return `response: ${response.request().method()} ${response.url()} (${response.request().resourceType()}) HTTP ${response.status()}`;
}

function shouldCaptureRequestFailure(request: Request): boolean {
  const url = request.url();
  if (/^(data|blob):/i.test(url)) {
    return false;
  }

  return request.isNavigationRequest() || ["document", "fetch", "xhr", "image", "script", "stylesheet"].includes(request.resourceType());
}

function shouldCaptureResponseFailure(response: Response): boolean {
  const status = response.status();
  if (status < 400) {
    return false;
  }

  const request = response.request();
  return shouldCaptureRequestFailure(request);
}

function toRoute(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url || "about:blank";
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function delay(timeoutMs: number) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
