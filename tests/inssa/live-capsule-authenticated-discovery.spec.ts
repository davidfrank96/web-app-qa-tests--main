import { promises as fs } from "fs";
import path from "path";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { ensureInssaAuthStorageState } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { INSSA_GENERIC_JS_SHELL_PATTERN } from "../../utils/inssa-test-data";

const ARTIFACT_PATH = process.env.INSSA_LIVE_CAPSULE_ARTIFACT_PATH?.trim() ?? "";
const STAGING_HOSTNAME = "staging.inssa.us";
const DISCOVERY_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
const DISCOVERY_TIMEOUT_MS = 20_000;

type LiveCapsuleArtifactInput = {
  finalShareLink?: string | null;
  finalUrl?: string | null;
  message?: string;
  possibleFinalCapsuleId?: string | null;
  possibleShareToken?: string | null;
  runId?: string;
  subject?: string;
};

type DiscoveryCheck = {
  error?: string;
  finalUrl: string;
  foundMessage: boolean;
  foundSubject: boolean;
  httpStatus: number | null;
  label: string;
  screenshotPath: string | null;
  searchApplied: boolean;
  status: "passed" | "failed";
  target: string;
  visibleTextSample: string;
};

type AuthenticatedDiscoveryArtifact = {
  artifactPath: string;
  cleanupInstruction: string;
  discovered: boolean;
  discoveredSurface: string | null;
  environment: "staging";
  finalShareLink: string | null;
  message: string;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  runId: string | null;
  subject: string;
  validatedAt: string;
  checks: DiscoveryCheck[];
};

test.describe("INSSA live capsule authenticated discovery", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ARTIFACT_PATH, "Requires INSSA_LIVE_CAPSULE_ARTIFACT_PATH=<artifact.json> from a successful live capsule run.");
  test.setTimeout(180_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA live capsule authenticated discovery is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("finds a previously created QA capsule through authenticated app surfaces", async ({ browser }, testInfo) => {
    const configuredUrl = assertValidInssaUrl();
    const artifact = await readArtifact(ARTIFACT_PATH);
    validateArtifact(artifact);

    const storageStatePath = await ensureInssaAuthStorageState(browser);
    const checks = await runAuthenticatedDiscovery({
      artifact,
      browser,
      configuredUrl,
      storageStatePath,
      testInfo
    });

    const discoveredCheck = checks.find((check) => check.foundSubject && check.foundMessage) ?? null;
    const discoveryArtifact: AuthenticatedDiscoveryArtifact = {
      artifactPath: path.resolve(ARTIFACT_PATH),
      cleanupInstruction: "No automated cleanup was attempted. Development team should delete this QA live capsule from staging after verification.",
      discovered: Boolean(discoveredCheck),
      discoveredSurface: discoveredCheck?.label ?? null,
      environment: "staging",
      finalShareLink: artifact.finalShareLink ?? null,
      message: artifact.message!,
      possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? extractCapsuleId(artifact.finalShareLink ?? artifact.finalUrl ?? ""),
      possibleShareToken: artifact.possibleShareToken ?? extractShareToken(artifact.finalShareLink ?? artifact.finalUrl ?? ""),
      runId: artifact.runId ?? null,
      subject: artifact.subject!,
      validatedAt: new Date().toISOString(),
      checks
    };

    await fs.mkdir(DISCOVERY_ARTIFACT_DIR, { recursive: true });
    const discoveryArtifactPath = path.join(
      DISCOVERY_ARTIFACT_DIR,
      `${artifact.runId ?? "unknown"}-authenticated-discovery.json`
    );
    await fs.writeFile(discoveryArtifactPath, JSON.stringify(discoveryArtifact, null, 2), "utf8");

    await testInfo.attach("inssa-live-capsule-authenticated-discovery.json", {
      body: JSON.stringify(discoveryArtifact, null, 2),
      contentType: "application/json"
    });

    expect(
      discoveredCheck,
      `Expected authenticated INSSA surfaces to expose the exact QA subject and message from "${ARTIFACT_PATH}". Checks:\n${formatChecks(checks)}`
    ).not.toBeNull();
  });
});

async function readArtifact(artifactPath: string): Promise<LiveCapsuleArtifactInput> {
  const absolutePath = path.resolve(artifactPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw) as LiveCapsuleArtifactInput;
}

function validateArtifact(artifact: LiveCapsuleArtifactInput): asserts artifact is LiveCapsuleArtifactInput & {
  message: string;
  subject: string;
} {
  if (!artifact.subject || !artifact.message) {
    throw new Error(`Artifact at "${ARTIFACT_PATH}" must include both "subject" and "message".`);
  }

  if (!artifact.finalShareLink && !artifact.finalUrl && !artifact.possibleFinalCapsuleId) {
    throw new Error(
      `Artifact at "${ARTIFACT_PATH}" must include finalShareLink, finalUrl, or possibleFinalCapsuleId for authenticated discovery.`
    );
  }
}

async function runAuthenticatedDiscovery(input: {
  artifact: LiveCapsuleArtifactInput & { message: string; subject: string };
  browser: Browser;
  configuredUrl: string;
  storageStatePath: string;
  testInfo: TestInfo;
}): Promise<DiscoveryCheck[]> {
  const context = await input.browser.newContext({
    baseURL: input.configuredUrl,
    storageState: input.storageStatePath
  });
  const page = await context.newPage();

  try {
    const targets = buildDiscoveryTargets(input.configuredUrl, input.artifact);
    const checks: DiscoveryCheck[] = [];

    for (const target of targets) {
      const check = await probeDiscoveryTarget(page, input.artifact, target);
      checks.push(check);
      if (check.screenshotPath) {
        await input.testInfo.attach(`authenticated-discovery-${target.label}.png`, {
          path: check.screenshotPath,
          contentType: "image/png"
        });
      }

      if (check.foundSubject && check.foundMessage) {
        break;
      }
    }

    return checks;
  } finally {
    await context.close().catch(() => {});
  }
}

function buildDiscoveryTargets(
  configuredUrl: string,
  artifact: LiveCapsuleArtifactInput
): Array<{ label: string; searchSubject?: boolean; url: string }> {
  const origin = new URL(configuredUrl).origin;
  const targets = new Map<string, { label: string; searchSubject?: boolean; url: string }>();

  addTarget(targets, "artifact-share-link", artifact.finalShareLink, origin);
  addTarget(targets, "artifact-final-url", artifact.finalUrl, origin);

  if (artifact.possibleFinalCapsuleId) {
    const tokenParam = artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : "";
    addTarget(targets, "artifact-capsule-id", `/capsule/${artifact.possibleFinalCapsuleId}${tokenParam}`, origin);
  }

  addTarget(targets, "home-feed", "/", origin);
  addTarget(targets, "home-search-subject", "/", origin, true);
  addTarget(targets, "profile-history", "/me", origin);
  addTarget(targets, "messages", "/messages", origin);
  addTarget(targets, "messages-tab-0", "/messages?tab=0", origin);
  addTarget(targets, "messages-tab-1", "/messages?tab=1", origin);

  return [...targets.values()];
}

function addTarget(
  targets: Map<string, { label: string; searchSubject?: boolean; url: string }>,
  label: string,
  rawUrl: string | null | undefined,
  origin: string,
  searchSubject = false
): void {
  if (!rawUrl) {
    return;
  }

  const resolved = new URL(rawUrl, origin);
  if (resolved.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to probe non-staging INSSA discovery target for "${label}": ${resolved.toString()}`);
  }

  const key = `${label}:${resolved.toString()}:${searchSubject ? "search" : "direct"}`;
  targets.set(key, {
    label,
    searchSubject,
    url: resolved.toString()
  });
}

async function probeDiscoveryTarget(
  page: Page,
  artifact: LiveCapsuleArtifactInput & { message: string; subject: string },
  target: { label: string; searchSubject?: boolean; url: string }
): Promise<DiscoveryCheck> {
  const screenshotPath = path.join(
    DISCOVERY_ARTIFACT_DIR,
    `${artifact.runId ?? "unknown"}-authenticated-discovery-${sanitizeForPath(target.label)}.png`
  );

  try {
    const response = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: DISCOVERY_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await expectPageNotBlank(page);
    await expect(page.locator("body")).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);

    let searchApplied = false;
    if (target.searchSubject) {
      searchApplied = await applySubjectSearchIfExposed(page, artifact.subject);
    }

    const bodyText = await visibleBodyText(page);
    await fs.mkdir(DISCOVERY_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ fullPage: true, path: screenshotPath });

    return {
      finalUrl: page.url(),
      foundMessage: normalizeText(bodyText).includes(normalizeText(artifact.message)),
      foundSubject: normalizeText(bodyText).includes(normalizeText(artifact.subject)),
      httpStatus: response?.status() ?? null,
      label: target.label,
      screenshotPath,
      searchApplied,
      status: "passed",
      target: target.url,
      visibleTextSample: normalizeText(bodyText).slice(0, 2_000)
    };
  } catch (error) {
    await fs.mkdir(DISCOVERY_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ fullPage: true, path: screenshotPath }).catch(() => {});

    return {
      error: error instanceof Error ? error.message : String(error),
      finalUrl: page.url() || "about:blank",
      foundMessage: false,
      foundSubject: false,
      httpStatus: null,
      label: target.label,
      screenshotPath,
      searchApplied: Boolean(target.searchSubject),
      status: "failed",
      target: target.url,
      visibleTextSample: normalizeText(await visibleBodyText(page).catch(() => "")).slice(0, 2_000)
    };
  }
}

async function applySubjectSearchIfExposed(page: Page, subject: string): Promise<boolean> {
  const searchInput = page.locator(
    [
      "input[type='search']",
      "input[placeholder*='search' i]",
      "input[aria-label*='search' i]",
      "textarea[placeholder*='search' i]"
    ].join(", ")
  );

  const total = await searchInput.count();
  for (let index = 0; index < total; index += 1) {
    const candidate = searchInput.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    await candidate.fill(subject);
    await candidate.press("Enter").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    return true;
  }

  return false;
}

async function visibleBodyText(page: Page): Promise<string> {
  return (await page.locator("body").textContent().catch(() => "")) ?? "";
}

function formatChecks(checks: DiscoveryCheck[]): string {
  return checks
    .map(
      (check) =>
        `- ${check.label}: status=${check.status}, foundSubject=${check.foundSubject}, foundMessage=${check.foundMessage}, finalUrl=${check.finalUrl}, screenshot=${check.screenshotPath ?? "none"}${check.error ? `, error=${check.error}` : ""}`
    )
    .join("\n");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "surface";
}

function extractCapsuleId(candidate: string): string | null {
  return candidate.match(/\/capsule\/([A-Za-z0-9_-]{6,})/i)?.[1] ?? null;
}

function extractShareToken(candidate: string): string | null {
  return candidate.match(/[?&]token=([^&\s]+)/i)?.[1] ?? null;
}
