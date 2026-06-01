import { promises as fs } from "fs";
import path from "path";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { ensureInssaAuthStorageState } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { resolveInssaLiveCapsuleArtifactPath } from "../../utils/inssa-live-artifacts";
import { INSSA_GENERIC_JS_SHELL_PATTERN } from "../../utils/inssa-test-data";

const ARTIFACT_PATH = resolveInssaLiveCapsuleArtifactPath();
const STAGING_HOSTNAME = "staging.inssa.us";
const DISCOVERY_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
const DISCOVERY_TIMEOUT_MS = 20_000;
const DISCOVERY_DELAY_MS = parseDiscoveryDelayMs();

type DiscoveryProbePass = "initial" | "delayed";

type DiscoverySurfaceKind = "artifact-url" | "direct-share" | "home-feed" | "search" | "profile" | "messages";

type LifecycleVisibilityClassification =
  | "authenticated-surface-indexed"
  | "authenticated-surface-undiscoverable"
  | "delayed-indexing"
  | "direct-access-without-indexing"
  | "direct-share-accessible"
  | "finalized-and-retrievable"
  | "lifecycle-evidence-missing"
  | "lifecycle-retrieval-failed"
  | "share-link-only-visibility"
  | "tokenized-only-access";

type LiveCapsuleArtifactInput = {
  artifactStateNote?: string | null;
  createdAt?: string | null;
  environment?: string;
  finalShareEvidence?: unknown;
  finalShareLink?: string | null;
  finalUrl?: string | null;
  message?: string;
  observedCreateSuccess?: boolean;
  possibleFinalCapsuleId?: string | null;
  possibleShareToken?: string | null;
  revealAudience?: string | null;
  revealTiming?: string | null;
  runId?: string;
  subject?: string;
  successSignals?: string[];
  writesObserved?: unknown[];
};

type DiscoveryTarget = {
  label: string;
  searchSubject?: boolean;
  surfaceKind: DiscoverySurfaceKind;
  url: string;
};

type DiscoveryCheck = {
  bodyTextLength: number;
  capsuleLikeText: string[];
  capsuleLikeUiVisible: boolean;
  checkedAt: string;
  error?: string;
  exactMessageOccurrences: number;
  exactSubjectOccurrences: number;
  finalUrl: string;
  foundMessage: boolean;
  foundSubject: boolean;
  genericShellVisible: boolean;
  httpStatus: number | null;
  label: string;
  loadingStateText: string | null;
  probePass: DiscoveryProbePass;
  routeAfterSearch?: string;
  screenshotPath: string | null;
  searchApplied: boolean;
  status: "passed" | "failed";
  surfaceKind: DiscoverySurfaceKind;
  target: string;
  tokenPresent: boolean;
  visibleCards: string[];
  visibleTextSample: string;
};

type AuthenticatedDiscoveryArtifact = {
  artifactSummary: {
    artifactStateNote: string | null;
    createdAt: string | null;
    observedCreateSuccess: boolean | null;
    revealAudience: string | null;
    revealTiming: string | null;
    successSignals: string[];
    writesObservedCount: number | null;
  };
  artifactPath: string;
  authenticatedDirectRetrieval: boolean;
  authenticatedSurfaceDiscovered: boolean;
  authenticatedSurfaceIndexed: boolean;
  authenticatedSurfaceUndiscoverable: boolean;
  checkedSurfaceLabels: string[];
  cleanupInstruction: string;
  delayedIndexingSuspected: boolean;
  directShareAccessible: boolean;
  directShareSurface: string | null;
  discovered: boolean;
  discoveredSurface: string | null;
  discoveryDelayMs: number;
  environment: "staging";
  finalShareLink: string | null;
  hardFailure: boolean;
  lifecycleVisibilityClassification: LifecycleVisibilityClassification;
  message: string;
  outcomeClassification: string;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  runId: string | null;
  shareLinkOnlyVisibility: boolean;
  subject: string;
  tokenizedAccess: boolean;
  validatedAt: string;
  checks: DiscoveryCheck[];
};

type LifecycleVisibilityOutcome = {
  authenticatedDirectRetrieval: boolean;
  authenticatedSurfaceIndexed: boolean;
  authenticatedSurfaceUndiscoverable: boolean;
  delayedIndexingSuspected: boolean;
  directShareAccessible: boolean;
  directShareSurface: string | null;
  discoveredSurface: string | null;
  hardFailure: boolean;
  lifecycleVisibilityClassification: LifecycleVisibilityClassification;
  outcomeClassification: string;
  shareLinkOnlyVisibility: boolean;
  tokenizedAccess: boolean;
};

test.describe("INSSA live capsule authenticated discovery", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(
    !ARTIFACT_PATH,
    "Requires INSSA_LIVE_CAPSULE_ARTIFACT_PATH=<artifact.json> from a successful live capsule run, or INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1."
  );
  test.setTimeout(180_000 + DISCOVERY_DELAY_MS);

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

    const visibilityOutcome = classifyLifecycleVisibility(artifact, checks);
    const discoveryArtifact: AuthenticatedDiscoveryArtifact = {
      artifactSummary: {
        artifactStateNote: artifact.artifactStateNote ?? null,
        createdAt: artifact.createdAt ?? null,
        observedCreateSuccess:
          typeof artifact.observedCreateSuccess === "boolean" ? artifact.observedCreateSuccess : null,
        revealAudience: artifact.revealAudience ?? null,
        revealTiming: artifact.revealTiming ?? null,
        successSignals: Array.isArray(artifact.successSignals) ? artifact.successSignals : [],
        writesObservedCount: Array.isArray(artifact.writesObserved) ? artifact.writesObserved.length : null
      },
      artifactPath: path.resolve(ARTIFACT_PATH),
      authenticatedDirectRetrieval: visibilityOutcome.authenticatedDirectRetrieval,
      authenticatedSurfaceDiscovered: visibilityOutcome.authenticatedSurfaceIndexed,
      authenticatedSurfaceIndexed: visibilityOutcome.authenticatedSurfaceIndexed,
      authenticatedSurfaceUndiscoverable: visibilityOutcome.authenticatedSurfaceUndiscoverable,
      checkedSurfaceLabels: checks.map((check) => `${check.probePass}:${check.label}`),
      cleanupInstruction: "No automated cleanup was attempted. Development team should delete this QA live capsule from staging after verification.",
      delayedIndexingSuspected: visibilityOutcome.delayedIndexingSuspected,
      directShareAccessible: visibilityOutcome.directShareAccessible,
      directShareSurface: visibilityOutcome.directShareSurface,
      discovered: visibilityOutcome.authenticatedSurfaceIndexed,
      discoveredSurface: visibilityOutcome.discoveredSurface,
      discoveryDelayMs: DISCOVERY_DELAY_MS,
      environment: "staging",
      finalShareLink: artifact.finalShareLink ?? null,
      hardFailure: visibilityOutcome.hardFailure,
      lifecycleVisibilityClassification: visibilityOutcome.lifecycleVisibilityClassification,
      message: artifact.message!,
      outcomeClassification: visibilityOutcome.outcomeClassification,
      possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? extractCapsuleId(artifact.finalShareLink ?? artifact.finalUrl ?? ""),
      possibleShareToken: artifact.possibleShareToken ?? extractShareToken(artifact.finalShareLink ?? artifact.finalUrl ?? ""),
      runId: artifact.runId ?? null,
      shareLinkOnlyVisibility: visibilityOutcome.shareLinkOnlyVisibility,
      subject: artifact.subject!,
      tokenizedAccess: visibilityOutcome.tokenizedAccess,
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

    if (visibilityOutcome.authenticatedSurfaceUndiscoverable) {
      testInfo.annotations.push({
        type: "inssa-authenticated-surface-undiscoverable",
        description:
          "Direct capsule retrieval succeeded, but home/search/messages/profile did not expose the exact QA capsule. Classified as product visibility behavior, not lifecycle retrieval failure."
      });
    }

    expect(
      visibilityOutcome.hardFailure,
      [
        `Expected INSSA live capsule artifact "${ARTIFACT_PATH}" to remain directly retrievable before classifying authenticated surface visibility.`,
        `Lifecycle visibility classification: ${visibilityOutcome.lifecycleVisibilityClassification}`,
        `Outcome classification: ${visibilityOutcome.outcomeClassification}`,
        `Direct share accessible: ${visibilityOutcome.directShareAccessible}`,
        `Tokenized access: ${visibilityOutcome.tokenizedAccess}`,
        `Authenticated direct retrieval: ${visibilityOutcome.authenticatedDirectRetrieval}`,
        `Authenticated surface indexed: ${visibilityOutcome.authenticatedSurfaceIndexed}`,
        `Discovery delay: ${DISCOVERY_DELAY_MS}ms`,
        `Checks:\n${formatChecks(checks)}`
      ].join("\n")
    ).toBe(false);
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

    await runDiscoveryPass({
      artifact: input.artifact,
      checks,
      page,
      probePass: "initial",
      targets,
      testInfo: input.testInfo
    });

    if (!checks.some((check) => isAuthenticatedSurfaceCheck(check) && hasExactQaContent(check)) && DISCOVERY_DELAY_MS > 0) {
      await page.waitForTimeout(DISCOVERY_DELAY_MS);
      await runDiscoveryPass({
        artifact: input.artifact,
        checks,
        page,
        probePass: "delayed",
        targets,
        testInfo: input.testInfo
      });
    }

    return checks;
  } finally {
    await context.close().catch(() => {});
  }
}

function buildDiscoveryTargets(
  configuredUrl: string,
  artifact: LiveCapsuleArtifactInput
): DiscoveryTarget[] {
  const origin = new URL(configuredUrl).origin;
  const targets = new Map<string, DiscoveryTarget>();

  addTarget(targets, "direct-share-link", resolveShareLink(artifact, origin), origin, "direct-share");
  addTarget(targets, "artifact-final-url", artifact.finalUrl, origin, getArtifactFinalUrlSurfaceKind(artifact.finalUrl));

  if (artifact.possibleFinalCapsuleId) {
    const tokenParam = artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : "";
    addTarget(
      targets,
      "artifact-capsule-id",
      `/capsule/${artifact.possibleFinalCapsuleId}${tokenParam}`,
      origin,
      "direct-share"
    );
  }

  addTarget(targets, "home-feed", "/", origin, "home-feed");
  addTarget(targets, "home-search-subject", "/", origin, "search", true);
  addTarget(targets, "profile-history", "/me", origin, "profile");
  addTarget(targets, "messages", "/messages", origin, "messages");
  addTarget(targets, "messages-tab-0", "/messages?tab=0", origin, "messages");
  addTarget(targets, "messages-tab-1", "/messages?tab=1", origin, "messages");

  return [...targets.values()];
}

function addTarget(
  targets: Map<string, DiscoveryTarget>,
  label: string,
  rawUrl: string | null | undefined,
  origin: string,
  surfaceKind: DiscoverySurfaceKind,
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
    surfaceKind,
    url: resolved.toString()
  });
}

async function runDiscoveryPass(input: {
  artifact: LiveCapsuleArtifactInput & { message: string; subject: string };
  checks: DiscoveryCheck[];
  page: Page;
  probePass: DiscoveryProbePass;
  targets: DiscoveryTarget[];
  testInfo: TestInfo;
}): Promise<void> {
  for (const target of input.targets) {
    const check = await probeDiscoveryTarget(input.page, input.artifact, target, input.probePass);
    input.checks.push(check);
    if (check.screenshotPath) {
      await input.testInfo.attach(`authenticated-discovery-${input.probePass}-${target.label}.png`, {
        path: check.screenshotPath,
        contentType: "image/png"
      });
    }

  }
}

async function probeDiscoveryTarget(
  page: Page,
  artifact: LiveCapsuleArtifactInput & { message: string; subject: string },
  target: DiscoveryTarget,
  probePass: DiscoveryProbePass
): Promise<DiscoveryCheck> {
  const screenshotPath = path.join(
    DISCOVERY_ARTIFACT_DIR,
    `${artifact.runId ?? "unknown"}-authenticated-discovery-${sanitizeForPath(probePass)}-${sanitizeForPath(target.label)}.png`
  );

  try {
    const response = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: DISCOVERY_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await expectPageNotBlank(page);

    let searchApplied = false;
    if (target.searchSubject) {
      searchApplied = await applySubjectSearchIfExposed(page, artifact.subject);
    }

    const bodyText = await visibleBodyText(page);
    const diagnostics = await captureDiscoveryPageDiagnostics(page, bodyText);
    const exactSubjectOccurrences = countOccurrences(bodyText, artifact.subject);
    const exactMessageOccurrences = countOccurrences(bodyText, artifact.message);
    const genericShellVisible = INSSA_GENERIC_JS_SHELL_PATTERN.test(bodyText);
    await fs.mkdir(DISCOVERY_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ fullPage: true, path: screenshotPath });

    return {
      bodyTextLength: normalizeText(bodyText).length,
      capsuleLikeText: diagnostics.capsuleLikeText,
      capsuleLikeUiVisible: diagnostics.capsuleLikeUiVisible,
      checkedAt: new Date().toISOString(),
      exactMessageOccurrences,
      exactSubjectOccurrences,
      finalUrl: page.url(),
      foundMessage: exactMessageOccurrences > 0,
      foundSubject: exactSubjectOccurrences > 0,
      genericShellVisible,
      httpStatus: response?.status() ?? null,
      label: target.label,
      loadingStateText: diagnostics.loadingStateText,
      probePass,
      routeAfterSearch: searchApplied ? page.url() : undefined,
      screenshotPath,
      searchApplied,
      status: "passed",
      surfaceKind: target.surfaceKind,
      target: target.url,
      tokenPresent: Boolean(extractShareToken(target.url)),
      visibleCards: diagnostics.visibleCards,
      visibleTextSample: diagnostics.visibleTextSample
    };
  } catch (error) {
    await fs.mkdir(DISCOVERY_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ fullPage: true, path: screenshotPath }).catch(() => {});
    const bodyText = await visibleBodyText(page).catch(() => "");
    const diagnostics = await captureDiscoveryPageDiagnostics(page, bodyText).catch(() => ({
      capsuleLikeText: [],
      capsuleLikeUiVisible: false,
      loadingStateText: null,
      visibleCards: [],
      visibleTextSample: normalizeText(bodyText).slice(0, 2_000)
    }));

    return {
      bodyTextLength: normalizeText(bodyText).length,
      capsuleLikeText: diagnostics.capsuleLikeText,
      capsuleLikeUiVisible: diagnostics.capsuleLikeUiVisible,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      exactMessageOccurrences: 0,
      exactSubjectOccurrences: 0,
      finalUrl: page.url() || "about:blank",
      foundMessage: false,
      foundSubject: false,
      genericShellVisible: INSSA_GENERIC_JS_SHELL_PATTERN.test(bodyText),
      httpStatus: null,
      label: target.label,
      loadingStateText: diagnostics.loadingStateText,
      probePass,
      screenshotPath,
      searchApplied: Boolean(target.searchSubject),
      status: "failed",
      surfaceKind: target.surfaceKind,
      target: target.url,
      tokenPresent: Boolean(extractShareToken(target.url)),
      visibleCards: diagnostics.visibleCards,
      visibleTextSample: diagnostics.visibleTextSample
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

async function captureDiscoveryPageDiagnostics(
  page: Page,
  bodyText: string
): Promise<{
  capsuleLikeText: string[];
  capsuleLikeUiVisible: boolean;
  loadingStateText: string | null;
  visibleCards: string[];
  visibleTextSample: string;
}> {
  const visibleCards = await page
    .locator(
      [
        "article",
        "li",
        "[role='listitem']",
        "[data-testid*='capsule' i]",
        "[data-testid*='card' i]",
        "[class*='capsule' i]",
        "[class*='card' i]"
      ].join(", ")
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0)
        .slice(0, 15)
    )
    .catch(() => []);
  const normalizedBody = normalizeText(bodyText);
  const capsuleLikeText = extractCapsuleLikeText(normalizedBody);

  return {
    capsuleLikeText,
    capsuleLikeUiVisible: visibleCards.length > 0 || capsuleLikeText.length > 0,
    loadingStateText: extractLoadingStateText(normalizedBody),
    visibleCards,
    visibleTextSample: normalizedBody.slice(0, 2_000)
  };
}

function formatChecks(checks: DiscoveryCheck[]): string {
  return checks
    .map(
      (check) =>
        [
          `- ${check.probePass}:${check.label}`,
          `surface=${check.surfaceKind}`,
          `status=${check.status}`,
          `foundSubject=${check.foundSubject}(${check.exactSubjectOccurrences})`,
          `foundMessage=${check.foundMessage}(${check.exactMessageOccurrences})`,
          `capsuleLikeUi=${check.capsuleLikeUiVisible}`,
          `genericShell=${check.genericShellVisible}`,
          `cards=${check.visibleCards.length}`,
          `loading=${JSON.stringify(check.loadingStateText)}`,
          `finalUrl=${check.finalUrl}`,
          `screenshot=${check.screenshotPath ?? "none"}`,
          check.error ? `error=${check.error}` : null
        ]
          .filter((part): part is string => Boolean(part))
          .join(", ")
    )
    .join("\n");
}

function classifyLifecycleVisibility(
  artifact: LiveCapsuleArtifactInput,
  checks: DiscoveryCheck[]
): LifecycleVisibilityOutcome {
  const authenticatedSurfaceCheck = checks.find((check) => isAuthenticatedSurfaceCheck(check) && hasExactQaContent(check));
  const directShareCheck = checks.find((check) => isDirectShareCheck(check) && hasExactQaContent(check)) ?? null;
  const tokenizedDirectShareCheck = checks.find(
    (check) => isDirectShareCheck(check) && check.tokenPresent && hasExactQaContent(check)
  ) ?? null;
  const delayedSurfaceCheck =
    authenticatedSurfaceCheck?.probePass === "delayed" ? authenticatedSurfaceCheck : null;
  const lifecycleEvidencePresent = hasLifecycleEvidence(artifact) || Boolean(directShareCheck);
  const authenticatedSurfaceIndexed = Boolean(authenticatedSurfaceCheck);
  const directShareAccessible = Boolean(directShareCheck);
  const tokenizedAccess = Boolean(tokenizedDirectShareCheck);
  const authenticatedSurfaceUndiscoverable = directShareAccessible && !authenticatedSurfaceIndexed;
  const delayedIndexingSuspected =
    authenticatedSurfaceUndiscoverable &&
    (DISCOVERY_DELAY_MS === 0 || checks.some((check) => check.probePass === "delayed"));
  const shareLinkOnlyVisibility = directShareAccessible && !authenticatedSurfaceIndexed;
  const hardFailure = !lifecycleEvidencePresent || !directShareAccessible;
  let lifecycleVisibilityClassification: LifecycleVisibilityClassification;

  if (authenticatedSurfaceCheck) {
    lifecycleVisibilityClassification = delayedSurfaceCheck ? "delayed-indexing" : "authenticated-surface-indexed";
  } else if (directShareAccessible && tokenizedAccess) {
    lifecycleVisibilityClassification = "share-link-only-visibility";
  } else if (directShareAccessible) {
    lifecycleVisibilityClassification = "direct-access-without-indexing";
  } else if (!lifecycleEvidencePresent) {
    lifecycleVisibilityClassification = "lifecycle-evidence-missing";
  } else {
    lifecycleVisibilityClassification = "lifecycle-retrieval-failed";
  }

  const outcomeSuffix = authenticatedSurfaceCheck?.label ?? directShareCheck?.label ?? "none";

  return {
    authenticatedDirectRetrieval: directShareAccessible,
    authenticatedSurfaceIndexed,
    authenticatedSurfaceUndiscoverable,
    delayedIndexingSuspected,
    directShareAccessible,
    directShareSurface: directShareCheck?.label ?? null,
    discoveredSurface: authenticatedSurfaceCheck?.label ?? null,
    hardFailure,
    lifecycleVisibilityClassification,
    outcomeClassification: `${lifecycleVisibilityClassification}:${outcomeSuffix}`,
    shareLinkOnlyVisibility,
    tokenizedAccess
  };
}

function isAuthenticatedSurfaceCheck(check: DiscoveryCheck): boolean {
  return check.surfaceKind !== "direct-share" && check.surfaceKind !== "artifact-url";
}

function isDirectShareCheck(check: DiscoveryCheck): boolean {
  return check.surfaceKind === "direct-share";
}

function hasExactQaContent(check: DiscoveryCheck): boolean {
  return check.foundSubject && check.foundMessage;
}

function hasLifecycleEvidence(artifact: LiveCapsuleArtifactInput): boolean {
  return (
    artifact.observedCreateSuccess === true ||
    Boolean(artifact.possibleFinalCapsuleId) ||
    Boolean(artifact.finalShareLink) ||
    hasShareableArtifactLink(artifact) ||
    (Array.isArray(artifact.successSignals) && artifact.successSignals.length > 0)
  );
}

function extractCapsuleLikeText(normalizedBody: string): string[] {
  const matches = normalizedBody.match(/.{0,80}(capsule|buried|bury|memory|message|share|reveal|created|received).{0,120}/gi) ?? [];
  return uniqueStrings(matches.map(normalizeText)).slice(0, 20);
}

function extractLoadingStateText(normalizedBody: string): string | null {
  return (
    normalizedBody.match(/.{0,80}(loading|fetching|spinner|no received messages yet|no unread|nothing|empty|no [^.]{0,40}capsules?).{0,120}/i)?.[0] ??
    null
  );
}

function countOccurrences(haystack: string, needle: string): number {
  const normalizedHaystack = normalizeText(haystack).toLowerCase();
  const normalizedNeedle = normalizeText(needle).toLowerCase();
  if (!normalizedNeedle) {
    return 0;
  }

  let count = 0;
  let index = normalizedHaystack.indexOf(normalizedNeedle);
  while (index !== -1) {
    count += 1;
    index = normalizedHaystack.indexOf(normalizedNeedle, index + normalizedNeedle.length);
  }

  return count;
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

function resolveShareLink(artifact: LiveCapsuleArtifactInput, origin: string): string | null {
  if (artifact.finalShareLink) {
    return artifact.finalShareLink;
  }

  if (artifact.possibleFinalCapsuleId) {
    const tokenParam = artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : "";
    return new URL(`/capsule/${artifact.possibleFinalCapsuleId}${tokenParam}`, origin).toString();
  }

  if (artifact.finalUrl && /\/capsule\//i.test(artifact.finalUrl)) {
    return artifact.finalUrl;
  }

  return null;
}

function getArtifactFinalUrlSurfaceKind(finalUrl: string | null | undefined): DiscoverySurfaceKind {
  return finalUrl && /\/capsule\//i.test(finalUrl) ? "direct-share" : "artifact-url";
}

function hasShareableArtifactLink(artifact: LiveCapsuleArtifactInput): boolean {
  return Boolean(resolveShareLink(artifact, "https://staging.inssa.us"));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function parseDiscoveryDelayMs(): number {
  const rawValue = process.env.INSSA_DISCOVERY_DELAY_MS?.trim();
  if (!rawValue) {
    return 0;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`INSSA_DISCOVERY_DELAY_MS must be a non-negative number of milliseconds. Current value: "${rawValue}".`);
  }

  return Math.floor(parsed);
}
