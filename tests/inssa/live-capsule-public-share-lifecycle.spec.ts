import { promises as fs, readFileSync } from "fs";
import path from "path";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { ensureInssaAuthStorageState } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { resolveInssaLiveCapsuleArtifactPath } from "../../utils/inssa-live-artifacts";
import { INSSA_CAPSULE_SHARE_LINK_PATTERN, INSSA_GENERIC_JS_SHELL_PATTERN } from "../../utils/inssa-test-data";

const ARTIFACT_PATH = resolveInssaLiveCapsuleArtifactPath();
const ARTIFACT_HAS_SHAREABLE_LINK = ARTIFACT_PATH ? artifactPathHasShareableCapsuleLink(ARTIFACT_PATH) : false;
const STAGING_HOSTNAME = "staging.inssa.us";
const PUBLIC_LIFECYCLE_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
const NAVIGATION_TIMEOUT_MS = 25_000;

type LiveCapsuleArtifactInput = {
  finalShareLink?: string | null;
  finalUrl?: string | null;
  message?: string;
  possibleFinalCapsuleId?: string | null;
  possibleShareToken?: string | null;
  runId?: string;
  subject?: string;
};

type PublicShareAccessMode = "authenticated" | "clean" | "logged-out" | "tokenless-clean";

type PublicShareProbe = {
  accessMode: PublicShareAccessMode;
  authRedirected: boolean;
  error?: string;
  finalUrl: string;
  foundMessage: boolean;
  foundSubject: boolean;
  genericShellVisible: boolean;
  httpStatus: number | null;
  screenshotPath: string | null;
  status: "failed" | "passed";
  targetUrl: string;
  tokenPresent: boolean;
  visibleTextSample: string;
};

type PublicShareLifecycleArtifact = {
  artifactPath: string;
  cleanupInstruction: string;
  cleanAccessVisible: boolean;
  environment: "staging";
  finalShareLink: string;
  lifecycleStatus: "blocked" | "passed";
  loggedOutAccessVisible: boolean;
  message: string;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  probes: PublicShareProbe[];
  runId: string | null;
  subject: string;
  tokenlessAccessClassification: "content-hidden" | "content-visible" | "not-probed";
  tokenlessAccessExpectedPrivate: boolean;
  validatedAt: string;
};

test.describe("INSSA live capsule public share lifecycle", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(
    !ARTIFACT_PATH,
    "Requires INSSA_LIVE_CAPSULE_ARTIFACT_PATH=<artifact.json> from a successful live capsule run, or INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1."
  );
  test.skip(
    Boolean(ARTIFACT_PATH) && !ARTIFACT_HAS_SHAREABLE_LINK,
    `Artifact at "${ARTIFACT_PATH}" is a finalized lifecycle artifact, but it does not include finalShareLink, possibleFinalCapsuleId, or a /capsule/ finalUrl. Public share lifecycle cannot run until share-link evidence is captured.`
  );
  test.setTimeout(180_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA live capsule public share lifecycle is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("validates tokenized share access across clean, logged-out, and authenticated contexts", async ({
    browser
  }, testInfo) => {
    const configuredUrl = assertValidInssaUrl();
    const artifact = await readArtifact(ARTIFACT_PATH);
    validateArtifact(artifact);

    if (!hasShareableCapsuleLink(artifact)) {
      test.skip(
        true,
        `Artifact at "${ARTIFACT_PATH}" is a finalized lifecycle artifact, but it does not include finalShareLink, possibleFinalCapsuleId, or a /capsule/ finalUrl. Public share lifecycle cannot run until share-link evidence is captured.`
      );
    }

    const shareLink = resolveShareLink(configuredUrl, artifact);
    assertStagingShareLink(shareLink);

    const storageStatePath = await ensureInssaAuthStorageState(browser);
    const probes: PublicShareProbe[] = [];
    probes.push(
      await probeShareAccess({
        accessMode: "clean",
        browser,
        configuredUrl,
        expectedMessage: artifact.message,
        expectedSubject: artifact.subject,
        targetUrl: shareLink,
        testInfo
      })
    );
    probes.push(
      await probeShareAccess({
        accessMode: "logged-out",
        browser,
        configuredUrl,
        expectedMessage: artifact.message,
        expectedSubject: artifact.subject,
        targetUrl: shareLink,
        testInfo,
        warmupPath: "/"
      })
    );
    probes.push(
      await probeShareAccess({
        accessMode: "authenticated",
        browser,
        configuredUrl,
        expectedMessage: artifact.message,
        expectedSubject: artifact.subject,
        storageStatePath,
        targetUrl: shareLink,
        testInfo
      })
    );

    const tokenlessUrl = buildTokenlessUrl(shareLink);
    if (tokenlessUrl && tokenlessUrl !== shareLink) {
      probes.push(
        await probeShareAccess({
          accessMode: "tokenless-clean",
          browser,
          configuredUrl,
          expectedMessage: artifact.message,
          expectedSubject: artifact.subject,
          targetUrl: tokenlessUrl,
          testInfo
        })
      );
    }

    const cleanProbe = getRequiredProbe(probes, "clean");
    const loggedOutProbe = getRequiredProbe(probes, "logged-out");
    const authenticatedProbe = getRequiredProbe(probes, "authenticated");
    const tokenlessProbe = probes.find((probe) => probe.accessMode === "tokenless-clean") ?? null;
    const tokenlessAccessClassification = tokenlessProbe
      ? tokenlessProbe.foundSubject || tokenlessProbe.foundMessage
        ? "content-visible"
        : "content-hidden"
      : "not-probed";

    const lifecycleArtifact: PublicShareLifecycleArtifact = {
      artifactPath: path.resolve(ARTIFACT_PATH),
      cleanupInstruction: "No automated cleanup was attempted. Development team should delete this QA live capsule from staging after verification.",
      cleanAccessVisible: cleanProbe.foundSubject && cleanProbe.foundMessage,
      environment: "staging",
      finalShareLink: shareLink,
      lifecycleStatus: "passed",
      loggedOutAccessVisible: loggedOutProbe.foundSubject && loggedOutProbe.foundMessage,
      message: artifact.message,
      possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? extractCapsuleId(shareLink),
      possibleShareToken: artifact.possibleShareToken ?? extractShareToken(shareLink),
      probes,
      runId: artifact.runId ?? null,
      subject: artifact.subject,
      tokenlessAccessClassification,
      tokenlessAccessExpectedPrivate: Boolean(extractShareToken(shareLink)),
      validatedAt: new Date().toISOString()
    };

    await fs.mkdir(PUBLIC_LIFECYCLE_ARTIFACT_DIR, { recursive: true });
    const lifecycleArtifactPath = path.join(
      PUBLIC_LIFECYCLE_ARTIFACT_DIR,
      `${artifact.runId ?? "unknown"}-public-share-lifecycle.json`
    );
    await fs.writeFile(lifecycleArtifactPath, JSON.stringify(lifecycleArtifact, null, 2), "utf8");
    await testInfo.attach("inssa-live-capsule-public-share-lifecycle.json", {
      body: JSON.stringify(lifecycleArtifact, null, 2),
      contentType: "application/json"
    });

    expectNoProbeFailures(probes);
    expectVisibleCapsuleContent(cleanProbe, "clean tokenized share access");
    expectVisibleCapsuleContent(loggedOutProbe, "logged-out tokenized share access");
    expectVisibleCapsuleContent(authenticatedProbe, "authenticated tokenized share access");
    expect(
      cleanProbe.authRedirected || loggedOutProbe.authRedirected,
      `Expected tokenized share links to avoid auth redirects. Probes:\n${formatProbes(probes)}`
    ).toBe(false);

    if (tokenlessProbe && extractShareToken(shareLink)) {
      testInfo.annotations.push({
        type: "inssa-tokenless-capsule-access",
        description:
          tokenlessProbe.foundSubject && tokenlessProbe.foundMessage
            ? "Tokenless capsule URL exposed exact QA content; recorded as product behavior, not a tokenized public-share retrieval failure."
            : "Tokenless capsule URL did not expose both exact QA subject and message."
      });
    }
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

async function probeShareAccess(input: {
  accessMode: PublicShareAccessMode;
  browser: Browser;
  configuredUrl: string;
  expectedMessage: string;
  expectedSubject: string;
  storageStatePath?: string;
  targetUrl: string;
  testInfo: TestInfo;
  warmupPath?: string;
}): Promise<PublicShareProbe> {
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const screenshotPath = path.join(
    PUBLIC_LIFECYCLE_ARTIFACT_DIR,
    `${sanitizeForPath(input.testInfo.title)}-${input.accessMode}.png`
  );

  try {
    context = await input.browser.newContext({
      baseURL: input.configuredUrl,
      storageState: input.storageStatePath ?? { cookies: [], origins: [] }
    });
    page = await context.newPage();

    if (input.warmupPath) {
      await page.goto(input.warmupPath, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    }

    const response = await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await expectPageNotBlank(page);
    const bodyText = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
    const genericShellVisible = INSSA_GENERIC_JS_SHELL_PATTERN.test(bodyText);
    await fs.mkdir(PUBLIC_LIFECYCLE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ fullPage: true, path: screenshotPath });
    await input.testInfo.attach(`public-share-lifecycle-${input.accessMode}.png`, {
      path: screenshotPath,
      contentType: "image/png"
    });

    return {
      accessMode: input.accessMode,
      authRedirected: isAuthRoute(page.url()),
      finalUrl: page.url(),
      foundMessage: bodyText.includes(normalizeText(input.expectedMessage)),
      foundSubject: bodyText.includes(normalizeText(input.expectedSubject)),
      genericShellVisible,
      httpStatus: response?.status() ?? null,
      screenshotPath,
      status: "passed",
      targetUrl: input.targetUrl,
      tokenPresent: Boolean(extractShareToken(input.targetUrl)),
      visibleTextSample: bodyText.slice(0, 2_000)
    };
  } catch (error) {
    await fs.mkdir(PUBLIC_LIFECYCLE_ARTIFACT_DIR, { recursive: true });
    if (page) {
      await page.screenshot({ fullPage: true, path: screenshotPath }).catch(() => {});
    }

    return {
      accessMode: input.accessMode,
      authRedirected: page ? isAuthRoute(page.url()) : false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: page?.url() || "about:blank",
      foundMessage: false,
      foundSubject: false,
      genericShellVisible: false,
      httpStatus: null,
      screenshotPath: page ? screenshotPath : null,
      status: "failed",
      targetUrl: input.targetUrl,
      tokenPresent: Boolean(extractShareToken(input.targetUrl)),
      visibleTextSample: page ? normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "").slice(0, 2_000) : ""
    };
  } finally {
    await context?.close().catch(() => {});
  }
}

function resolveShareLink(configuredUrl: string, artifact: LiveCapsuleArtifactInput): string {
  const tokenParam = artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : "";
  const rawLink =
    artifact.finalShareLink ||
    (artifact.possibleFinalCapsuleId ? `/capsule/${artifact.possibleFinalCapsuleId}${tokenParam}` : "") ||
    artifact.finalUrl ||
    "";
  const resolved = new URL(rawLink, new URL(configuredUrl).origin).toString();
  if (!INSSA_CAPSULE_SHARE_LINK_PATTERN.test(resolved)) {
    throw new Error(`Artifact link does not look like an INSSA capsule share link: ${resolved}`);
  }

  return resolved;
}

function artifactPathHasShareableCapsuleLink(artifactPath: string): boolean {
  try {
    return hasShareableCapsuleLink(JSON.parse(readFileSync(artifactPath, "utf8")) as LiveCapsuleArtifactInput);
  } catch {
    return false;
  }
}

function hasShareableCapsuleLink(artifact: LiveCapsuleArtifactInput): boolean {
  return Boolean(
    artifact.finalShareLink ||
      artifact.possibleFinalCapsuleId ||
      (artifact.finalUrl && INSSA_CAPSULE_SHARE_LINK_PATTERN.test(artifact.finalUrl))
  );
}

function buildTokenlessUrl(shareLink: string): string | null {
  const parsed = new URL(shareLink);
  const hadToken = parsed.searchParams.has("token");
  parsed.searchParams.delete("token");

  if (!hadToken) {
    return null;
  }

  return parsed.toString();
}

function assertStagingShareLink(shareLink: string): void {
  const parsed = new URL(shareLink);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to validate a non-staging INSSA share link: ${shareLink}`);
  }
}

function getRequiredProbe(probes: PublicShareProbe[], accessMode: PublicShareAccessMode): PublicShareProbe {
  const probe = probes.find((candidate) => candidate.accessMode === accessMode);
  if (!probe) {
    throw new Error(`Missing required public share lifecycle probe: ${accessMode}`);
  }

  return probe;
}

function expectNoProbeFailures(probes: PublicShareProbe[]): void {
  const failures = probes.filter(
    (probe) => probe.status === "failed" || (probe.httpStatus ?? 0) >= 500 || isUnrenderedGenericShell(probe)
  );
  expect(
    failures,
    failures.length === 0 ? "Expected public share lifecycle probes to avoid fatal failures." : formatProbes(failures)
  ).toEqual([]);
}

function isUnrenderedGenericShell(probe: PublicShareProbe): boolean {
  return probe.genericShellVisible && !(probe.foundSubject && probe.foundMessage);
}

function expectVisibleCapsuleContent(probe: PublicShareProbe, label: string): void {
  expect(
    probe.foundSubject && probe.foundMessage,
    `Expected ${label} to show exact QA subject and message. Probe:\n${JSON.stringify(probe, null, 2)}`
  ).toBe(true);
}

function formatProbes(probes: PublicShareProbe[]): string {
  return probes
    .map(
      (probe) =>
        `- ${probe.accessMode}: status=${probe.status}, http=${probe.httpStatus ?? "none"}, authRedirected=${
          probe.authRedirected
        }, foundSubject=${probe.foundSubject}, foundMessage=${probe.foundMessage}, finalUrl=${probe.finalUrl}${
          probe.error ? `, error=${probe.error}` : ""
        }`
    )
    .join("\n");
}

function isAuthRoute(candidate: string): boolean {
  try {
    return /^\/(?:sign-in|signin|login)(?:\/)?$|^\/(?:auth|onboarding|onboard|start)(?:\/|$)/i.test(
      new URL(candidate).pathname
    );
  } catch {
    return /\/(?:sign-in|signin|login|auth|onboarding|onboard|start)(?:\/|$)/i.test(candidate);
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "public-share-lifecycle";
}

function extractCapsuleId(candidate: string): string | null {
  return candidate.match(/\/capsule\/([A-Za-z0-9_-]{6,})/i)?.[1] ?? null;
}

function extractShareToken(candidate: string): string | null {
  return candidate.match(/[?&]token=([^&\s]+)/i)?.[1] ?? null;
}
