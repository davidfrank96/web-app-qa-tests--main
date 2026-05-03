import type { Page, TestInfo } from "@playwright/test";

const DEFAULT_SLOW_THRESHOLD_MS = 5_000;
const DEFAULT_UNSTABLE_THRESHOLD_MS = 10_000;
const DEFAULT_MEANINGFUL_RENDER_TIMEOUT_MS = 10_000;

type IssueKind = "console" | "pageerror" | "requestfailed";
type StepPhase = "navigation" | "interaction" | "assertion";
type StepStatus = "healthy" | "slow" | "unstable" | "broken";

type ErrorMonitorLike = {
  issues: Array<{ kind: IssueKind }>;
  setAction(action: string): void;
};

type StepOptions = {
  phase?: StepPhase;
  route?: string;
};

type StepLogRecord = {
  consoleErrors: number;
  durationMs: number;
  failureReason?: string;
  pageErrors: number;
  phase: StepPhase;
  renderObserved: boolean;
  requestFailures: number;
  requestedRoute?: string;
  route: string;
  status: StepStatus;
  step: string;
  test: string;
  timestamp: string;
};

type SummaryRecord = {
  brokenSteps: number;
  finalRoute: string;
  status: StepStatus;
  slowSteps: number;
  test: string;
  totalSteps: number;
  unstableSteps: number;
};

export function createInssaStabilityMonitor(
  page: Page,
  testInfo: TestInfo,
  errorMonitor: ErrorMonitorLike,
  options: {
    meaningfulRenderTimeoutMs?: number;
    slowThresholdMs?: number;
    unstableThresholdMs?: number;
  } = {}
) {
  const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
  const unstableThresholdMs = options.unstableThresholdMs ?? DEFAULT_UNSTABLE_THRESHOLD_MS;
  const meaningfulRenderTimeoutMs =
    options.meaningfulRenderTimeoutMs ?? DEFAULT_MEANINGFUL_RENDER_TIMEOUT_MS;
  const testName = testInfo.titlePath.slice(1).join(" > ");
  const records: StepLogRecord[] = [];

  return {
    async step<T>(step: string, run: () => Promise<T>, stepOptions: StepOptions = {}): Promise<T> {
      const phase = stepOptions.phase ?? inferPhase(step);
      const startedAt = Date.now();
      const issueStartIndex = errorMonitor.issues.length;
      errorMonitor.setAction(step);

      try {
        const result = await run();
        const renderObserved =
          phase === "navigation" ? await waitForMeaningfulRender(page, meaningfulRenderTimeoutMs) : false;
        const durationMs = Date.now() - startedAt;
        const counts = countIssuesByKind(errorMonitor.issues.slice(issueStartIndex));
        const status = classifyDuration(durationMs, slowThresholdMs, unstableThresholdMs);

        const record = buildRecord({
          counts,
          durationMs,
          page,
          phase,
          renderObserved,
          route: stepOptions.route,
          status,
          step,
          testName
        });
        records.push(record);
        logRecord(record);

        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const counts = countIssuesByKind(errorMonitor.issues.slice(issueStartIndex));
        const record = buildRecord({
          counts,
          durationMs,
          failureReason: getErrorMessage(error),
          page,
          phase,
          renderObserved: false,
          route: stepOptions.route,
          status: "broken",
          step,
          testName
        });
        records.push(record);
        logRecord(record);
        throw error;
      }
    },

    async finalize(): Promise<void> {
      const summary = buildSummary(testName, page, records);
      await testInfo.attach("inssa-monitor.json", {
        body: JSON.stringify({ summary, records }, null, 2),
        contentType: "application/json"
      });
      console.log(`INSSA_MONITOR_SUMMARY ${JSON.stringify(summary)}`);
    }
  };
}

export async function withInssaStabilityMonitor<T>(
  page: Page,
  testInfo: TestInfo,
  errorMonitor: ErrorMonitorLike,
  run: (monitor: ReturnType<typeof createInssaStabilityMonitor>) => Promise<T>,
  options: {
    meaningfulRenderTimeoutMs?: number;
    slowThresholdMs?: number;
    unstableThresholdMs?: number;
  } = {}
): Promise<T> {
  const monitor = createInssaStabilityMonitor(page, testInfo, errorMonitor, options);

  try {
    return await run(monitor);
  } finally {
    await monitor.finalize();
  }
}

function buildRecord(input: {
  counts: ReturnType<typeof countIssuesByKind>;
  durationMs: number;
  failureReason?: string;
  page: Page;
  phase: StepPhase;
  renderObserved: boolean;
  route?: string;
  status: StepStatus;
  step: string;
  testName: string;
}): StepLogRecord {
  return {
    consoleErrors: input.counts.console,
    durationMs: input.durationMs,
    failureReason: input.failureReason,
    pageErrors: input.counts.pageerror,
    phase: input.phase,
    renderObserved: input.renderObserved,
    requestFailures: input.counts.requestfailed,
    requestedRoute: input.route,
    route: input.page.url() || input.route || "about:blank",
    status: input.status,
    step: input.step,
    test: input.testName,
    timestamp: new Date().toISOString()
  };
}

function buildSummary(testName: string, page: Page, records: StepLogRecord[]): SummaryRecord {
  const brokenSteps = records.filter((record) => record.status === "broken").length;
  const unstableSteps = records.filter((record) => record.status === "unstable").length;
  const slowSteps = records.filter((record) => record.status === "slow").length;

  return {
    brokenSteps,
    finalRoute: page.url() || "about:blank",
    slowSteps,
    status:
      brokenSteps > 0 ? "broken" : unstableSteps > 0 ? "unstable" : slowSteps > 0 ? "slow" : "healthy",
    test: testName,
    totalSteps: records.length,
    unstableSteps
  };
}

function classifyDuration(durationMs: number, slowThresholdMs: number, unstableThresholdMs: number): StepStatus {
  if (durationMs > unstableThresholdMs) {
    return "unstable";
  }

  if (durationMs > slowThresholdMs) {
    return "slow";
  }

  return "healthy";
}

function countIssuesByKind(issues: Array<{ kind: IssueKind }>): Record<IssueKind, number> {
  return issues.reduce<Record<IssueKind, number>>(
    (counts, issue) => {
      counts[issue.kind] += 1;
      return counts;
    },
    {
      console: 0,
      pageerror: 0,
      requestfailed: 0
    }
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function inferPhase(step: string): StepPhase {
  return /open|go to|goto|navigate|reload|access|visit|login/i.test(step) ? "navigation" : "interaction";
}

function logRecord(record: StepLogRecord): void {
  console.log(`INSSA_MONITOR ${JSON.stringify(record)}`);
}

async function waitForMeaningfulRender(page: Page, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const body = document.body;
        if (!body) {
          return false;
        }

        const text = (body.innerText || "").replace(/\s+/g, " ").trim();
        const interactiveCount = document.querySelectorAll(
          "a[href], button, input:not([type='hidden']), select, textarea"
        ).length;
        const main = document.querySelector("main, [role='main']");
        const heading = document.querySelector("h1, h2, h3");

        return text.length > 0 || interactiveCount > 0 || Boolean(main) || Boolean(heading);
      },
      undefined,
      { timeout }
    );

    return true;
  } catch {
    return false;
  }
}
