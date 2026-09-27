import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { expect, type Browser, type Page } from "@playwright/test";
import { AuthPage } from "../pages/inssa/auth-page";
import { assertValidInssaUrl, requiredEnv } from "./env";
import {
  classifyInssaRequestFailure,
  classifyInssaIssue,
  type ClassifiedInssaLifecycleNetworkIssue,
  type ClassifiedInssaIssue,
  type InssaLifecycleRequestFailureContext,
  type InssaIssueCategory
} from "./inssa-noise";

const ALWAYS_IGNORED_ERROR_PATTERNS = [
  /net::ERR_ABORTED/i,
  /NS_BINDING_ABORTED/i,
  /Framing 'https:\/\/www\.google\.com\/' violates the following report-only Content Security Policy directive/i,
  /https:\/\/csp\.withgoogle\.com\/csp\/(?:frame-ancestors|script-inclusions)\//i
];
const INSSA_AUTH_STATE_MAX_AGE_MS = 8 * 60 * 60 * 1_000;
const INSSA_AUTH_STATE_TRUST_WINDOW_MS = 15 * 60 * 1_000;
const INSSA_AUTH_LOCK_RETRY_MS = 250;
const INSSA_AUTH_LOCK_TIMEOUT_MS = 30_000;
const INSSA_AUTH_VALIDATION_TIMEOUT_MS = 10_000;

type InssaIssueKind = "console" | "pageerror" | "requestfailed";

export type InssaIssue = {
  action: string;
  kind: InssaIssueKind;
  message: string;
  method?: string;
  pageUrl: string;
  requestUrl?: string;
  resourceType?: string;
};

export function getInssaTestCredentials(): { email: string; password: string } {
  assertValidInssaUrl();

  const email = requiredEnv("INSSA_TEST_EMAIL").trim();
  const password = requiredEnv("INSSA_TEST_PASSWORD").trim();

  if (!email || !password) {
    throw new Error("INSSA test credentials are not configured correctly");
  }

  return { email, password };
}

export function getInssaAuthStorageStatePath(): string {
  const baseUrl = assertValidInssaUrl();
  const { email } = getInssaTestCredentials();
  const key = createHash("sha256").update(`${baseUrl}\n${email}`).digest("hex").slice(0, 16);

  return path.join(os.tmpdir(), "web-app-qa-tests", "inssa-auth", key, "storage-state.json");
}

export async function ensureInssaAuthStorageState(browser: Browser): Promise<string> {
  const statePath = getInssaAuthStorageStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  if (await hasUsableInssaAuthStorageState(browser, statePath)) {
    return statePath;
  }

  await withInssaAuthStateLock(statePath, async () => {
    if (await hasUsableInssaAuthStorageState(browser, statePath)) {
      return;
    }

    await writeInssaAuthStorageState(browser, statePath);
  });

  return statePath;
}

export function createInssaErrorMonitor(
  page: Page,
  options: {
    defaultIgnorePatterns?: RegExp[];
  } = {}
) {
  const issues: InssaIssue[] = [];
  const defaultIgnorePatterns = options.defaultIgnorePatterns ?? [];
  let currentAction = "initial page state";

  const recordIssue = (issue: Omit<InssaIssue, "action" | "pageUrl">) => {
    issues.push({
      ...issue,
      action: currentAction,
      pageUrl: page.url() || "about:blank"
    });
  };

  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      const locationSuffix = location.url ? ` (source: ${location.url}:${location.lineNumber}:${location.columnNumber})` : "";
      recordIssue({
        kind: "console",
        message: `${message.text()}${locationSuffix}`
      });
    }
  });

  page.on("pageerror", (error) => {
    recordIssue({
      kind: "pageerror",
      message: error.message
    });
  });

  page.on("requestfailed", (request) => {
    recordIssue({
      kind: "requestfailed",
      message: request.failure()?.errorText ?? "Request failed without a browser error message.",
      method: request.method(),
      requestUrl: request.url(),
      resourceType: request.resourceType()
    });
  });

  return {
    issues,
    classifyIssues(ignorePatterns: RegExp[] = []): ClassifiedInssaIssue[] {
      const patterns = [...ALWAYS_IGNORED_ERROR_PATTERNS, ...defaultIgnorePatterns, ...ignorePatterns];
      return issues.map((issue) => classifyIssue(issue, patterns));
    },
    summarizeCategories(ignorePatterns: RegExp[] = []): Record<InssaIssueCategory, number> {
      return this.classifyIssues(ignorePatterns).reduce<Record<InssaIssueCategory, number>>(
        (counts, classifiedIssue) => {
          counts[classifiedIssue.category] += 1;
          return counts;
        },
        {
          "acceptable-staging-noise": 0,
          "auth-error": 0,
          "failed-api-dependency": 0,
          "fatal-error": 0,
          "retryable-network-error": 0,
          "transport-chatter": 0,
          unknown: 0
        }
      );
    },
    classifyLifecycleRequestFailures(
      context: InssaLifecycleRequestFailureContext
    ): ClassifiedInssaLifecycleNetworkIssue[] {
      return issues
        .filter((issue) => issue.kind === "requestfailed")
        .map((issue) => classifyInssaRequestFailure(issue, context));
    },
    step<T>(action: string, run: () => Promise<T>): Promise<T> {
      currentAction = action;
      return run();
    },
    setAction(action: string) {
      currentAction = action;
    },
    async expectNoUnexpectedErrors(
      ignorePatterns: RegExp[] = [],
      options: {
        lifecycleRequestContext?: InssaLifecycleRequestFailureContext;
      } = {}
    ) {
      const classifiedIssues = this.classifyIssues(ignorePatterns);
      const lifecycleNetworkIssues = options.lifecycleRequestContext
        ? this.classifyLifecycleRequestFailures(options.lifecycleRequestContext)
        : [];
      const warningRequestIssueKeys = new Set(
        lifecycleNetworkIssues
          .filter((issue) => issue.impact === "warning")
          .map((issue) => formatIssueKey(issue.issue))
      );
      const lifecycleRequestIssueKeys = new Set(lifecycleNetworkIssues.map((issue) => formatIssueKey(issue.issue)));
      const fatalLifecycleNetworkIssues = lifecycleNetworkIssues.filter((issue) => issue.impact === "fatal");
      const unexpected = classifiedIssues.filter(({ issue, severity }) => {
        if (severity !== "critical") {
          return false;
        }

        const issueKey = formatIssueKey(issue);
        return !warningRequestIssueKeys.has(issueKey) && !lifecycleRequestIssueKeys.has(issueKey);
      });

      expect(
        unexpected.length + fatalLifecycleNetworkIssues.length,
        unexpected.length + fatalLifecycleNetworkIssues.length === 0
          ? "Expected no unexpected INSSA console, page, or network errors."
          : [
              unexpected.length > 0
                ? `Unexpected INSSA issues:\n${unexpected.map(({ issue }) => formatInssaIssue(issue)).join("\n")}`
                : null,
              fatalLifecycleNetworkIssues.length > 0
                ? `Fatal INSSA lifecycle network issues:\n${fatalLifecycleNetworkIssues
                    .map((issue) => formatLifecycleNetworkIssue(issue))
                    .join("\n")}`
                : null
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n")
      ).toBe(0);
    }
  };
}

export function captureInssaConsoleErrors(page: Page) {
  return createInssaErrorMonitor(page);
}

export async function login(page: Page): Promise<AuthPage> {
  const { email, password } = getInssaTestCredentials();
  const authPage = new AuthPage(page);

  await authPage.goToSignIn();
  await authPage.signInWithEmail(email, password);
  await authPage.expectAuthenticatedState();

  return authPage;
}

export async function logout(page: Page): Promise<AuthPage> {
  const authPage = new AuthPage(page);
  await authPage.signOut();
  await authPage.expectPublicState();
  return authPage;
}

function formatInssaIssue(issue: InssaIssue | ClassifiedInssaIssue["issue"]): string {
  const attributes = [
    `[${issue.kind}]`,
    `action="${issue.action}"`,
    `page="${issue.pageUrl}"`
  ];

  if (issue.requestUrl) {
    attributes.push(`request="${issue.requestUrl}"`);
  }

  if (issue.method) {
    attributes.push(`method="${issue.method}"`);
  }

  if (issue.resourceType) {
    attributes.push(`resource="${issue.resourceType}"`);
  }

  attributes.push(issue.message);
  return attributes.join(" ");
}

function formatLifecycleNetworkIssue(issue: ClassifiedInssaLifecycleNetworkIssue): string {
  return [
    formatInssaIssue(issue.issue),
    `classification="${issue.classification}"`,
    `impact="${issue.impact}"`,
    `stage="${issue.lifecycleStage}"`,
    `reason="${issue.reason}"`
  ].join(" ");
}

function formatIssueKey(issue: InssaIssue | ClassifiedInssaIssue["issue"]): string {
  return [
    issue.kind,
    issue.action,
    issue.message,
    issue.method ?? "",
    issue.requestUrl ?? "",
    issue.resourceType ?? ""
  ].join("\n");
}

function classifyIssue(issue: InssaIssue, ignorePatterns: RegExp[]): ClassifiedInssaIssue {
  const searchableValues = [
    issue.action,
    issue.kind,
    issue.message,
    issue.pageUrl,
    issue.requestUrl ?? "",
    issue.method ?? "",
    issue.resourceType ?? ""
  ];

  if (ignorePatterns.some((pattern) => searchableValues.some((value) => pattern.test(value)))) {
    return { issue, severity: "acceptable", category: "acceptable-staging-noise" };
  }

  const classified = classifyInssaIssue(issue);
  return {
    issue,
    severity: classified.severity,
    category: classified.category
  };
}

async function hasUsableInssaAuthStorageState(browser: Browser, statePath: string): Promise<boolean> {
  const ageMs = await getAuthStateAgeMs(statePath);
  if (ageMs === null || ageMs > INSSA_AUTH_STATE_MAX_AGE_MS) {
    return false;
  }

  // Firebase can authenticate before INSSA finishes persisting the profile used
  // by Bury. Do not reuse an early, partially initialized login snapshot.
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    const origin = state.origins?.find((entry: { origin: string }) => entry.origin === new URL(assertValidInssaUrl()).origin);
    if (!hasCompleteInssaSession(origin?.localStorage ?? [])) return false;
  } catch {
    return false;
  }

  if (ageMs <= INSSA_AUTH_STATE_TRUST_WINDOW_MS) {
    return true;
  }

  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;

  try {
    context = await browser.newContext({
      baseURL: assertValidInssaUrl(),
      storageState: statePath
    });

    const page = await context.newPage();
    const authPage = new AuthPage(page);
    await page.setDefaultNavigationTimeout(INSSA_AUTH_VALIDATION_TIMEOUT_MS);

    try {
      await authPage.goToProfile();
      await authPage.expectProfileSurface();
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  } finally {
    await context?.close().catch(() => {});
  }
}

async function writeInssaAuthStorageState(browser: Browser, statePath: string): Promise<void> {
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;

  try {
    context = await browser.newContext({
      baseURL: assertValidInssaUrl()
    });

    const page = await context.newPage();
    await login(page);
    await expect.poll(async () => {
      const entries = await page.evaluate(() => Object.entries(localStorage)
        .filter(([name]) => name === "userProfile" || name.startsWith("firebase:authUser:"))
        .map(([name, value]) => ({ name, value })));
      return hasCompleteInssaSession(entries);
    }, {
      message: "Expected Firebase authentication and the matching INSSA profile to persist before saving the test session.",
      timeout: 30_000
    }).toBe(true);
    await context.storageState({ path: statePath });
  } finally {
    await context?.close().catch(() => {});
  }
}

export function hasCompleteInssaSession(entries: Array<{ name: string; value: string }>): boolean {
  try {
    const profile = JSON.parse(entries.find((entry) => entry.name === "userProfile")?.value ?? "null");
    const uid = profile?.state?.userProfile?.uid;
    return typeof uid === "string" && uid.length > 0 && entries.some((entry) =>
      entry.name.startsWith("firebase:authUser:") && JSON.parse(entry.value)?.uid === uid
    );
  } catch {
    return false;
  }
}

async function withInssaAuthStateLock(statePath: string, run: () => Promise<void>): Promise<void> {
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + INSSA_AUTH_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") {
        throw error;
      }

      if (Date.now() > deadline) {
        throw new Error("Timed out while waiting for the INSSA auth session lock.");
      }

      await delay(INSSA_AUTH_LOCK_RETRY_MS);
    }
  }

  try {
    await run();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
}

async function getAuthStateAgeMs(statePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(statePath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
