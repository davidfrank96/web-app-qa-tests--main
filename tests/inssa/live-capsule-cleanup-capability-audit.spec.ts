import { promises as fs } from "fs";
import path from "path";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { ensureInssaAuthStorageState } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { resolveInssaLiveCapsuleArtifactPath } from "../../utils/inssa-live-artifacts";
import {
  INSSA_ARCHIVE_CAPSULE_PATTERN,
  INSSA_CAPSULE_SHARE_LINK_PATTERN,
  INSSA_DELETE_CAPSULE_PATTERN,
  INSSA_EDIT_CAPSULE_PATTERN,
  INSSA_GENERIC_JS_SHELL_PATTERN,
  INSSA_HIDE_CAPSULE_PATTERN,
  INSSA_UNPUBLISH_CAPSULE_PATTERN
} from "../../utils/inssa-test-data";
import { getInssaCleanupCapabilities, getInssaMutationReadiness } from "../../utils/inssa-mutation";

const ARTIFACT_PATH = resolveInssaLiveCapsuleArtifactPath();
const STAGING_HOSTNAME = "staging.inssa.us";
const AUDIT_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
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

type CleanupControlKey = "archive" | "delete" | "edit" | "hide" | "unpublish";

type CleanupControlMatrix = Record<
  CleanupControlKey,
  {
    detected: boolean;
    labels: string[];
    surfaces: string[];
  }
>;

type CleanupSurfaceFinding = {
  actionMenuButtonsClicked: string[];
  authRedirected: boolean;
  cleanupControls: CleanupControlMatrix;
  error?: string;
  exactMessageVisible: boolean;
  exactSubjectVisible: boolean;
  finalUrl: string;
  genericShellVisible: boolean;
  httpStatus: number | null;
  label: string;
  screenshotPath: string | null;
  status: "failed" | "passed";
  targetUrl: string;
  visibleTextSample: string;
};

type CleanupCapabilityAuditArtifact = {
  accountScopedCleanupVerified: boolean;
  artifactPath: string;
  automationSafe: boolean;
  cleanupCapabilityMatrix: CleanupControlMatrix;
  cleanupInstruction: string;
  cleanupPermissionsVerified: boolean;
  environment: "staging";
  lifecycleReady: boolean;
  mutationReadinessBlockers: string[];
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  recommendation: string;
  runId: string | null;
  subject: string;
  surfaces: CleanupSurfaceFinding[];
  validatedAt: string;
};

test.describe("INSSA live capsule cleanup capability audit", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(
    !ARTIFACT_PATH,
    "Requires INSSA_LIVE_CAPSULE_ARTIFACT_PATH=<artifact.json> from a successful live capsule run, or INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1."
  );
  test.setTimeout(180_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA live capsule cleanup capability audit is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("audits post-create cleanup controls without mutating the live capsule", async ({ browser }, testInfo) => {
    const configuredUrl = assertValidInssaUrl();
    const artifact = await readArtifact(ARTIFACT_PATH);
    validateArtifact(artifact);

    const storageStatePath = await ensureInssaAuthStorageState(browser);
    const findings = await runCleanupCapabilityAudit({
      artifact,
      browser,
      configuredUrl,
      storageStatePath,
      testInfo
    });
    const aggregateMatrix = aggregateCleanupControls(findings);
    const readiness = getInssaMutationReadiness(getInssaCleanupCapabilities());
    const anyCleanupControlDetected = Object.values(aggregateMatrix).some((entry) => entry.detected);
    const exactArtifactScopedSurface = findings.some(
      (finding) => finding.exactSubjectVisible && (finding.exactMessageVisible || Boolean(artifact.possibleFinalCapsuleId))
    );

    const auditArtifact: CleanupCapabilityAuditArtifact = {
      accountScopedCleanupVerified: false,
      artifactPath: path.resolve(ARTIFACT_PATH),
      automationSafe: false,
      cleanupCapabilityMatrix: aggregateMatrix,
      cleanupInstruction:
        "No automated cleanup was attempted. Development team should manually delete/archive this QA live capsule from staging after verification.",
      cleanupPermissionsVerified: false,
      environment: "staging",
      lifecycleReady: false,
      mutationReadinessBlockers: readiness.blockers,
      possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? extractCapsuleId(resolvePrimaryLink(configuredUrl, artifact)),
      possibleShareToken: artifact.possibleShareToken ?? extractShareToken(resolvePrimaryLink(configuredUrl, artifact)),
      recommendation:
        anyCleanupControlDetected && exactArtifactScopedSurface
          ? "Cleanup controls were detected near the QA artifact, but automation is still unsafe until confirmation dialogs and account-scoped permissions are verified without risking non-QA data."
          : "Do not automate live capsule cleanup yet. Continue manual cleanup until an exact QA-scoped delete/archive/unpublish flow is verified.",
      runId: artifact.runId ?? null,
      subject: artifact.subject,
      surfaces: findings,
      validatedAt: new Date().toISOString()
    };

    await fs.mkdir(AUDIT_ARTIFACT_DIR, { recursive: true });
    const auditArtifactPath = path.join(
      AUDIT_ARTIFACT_DIR,
      `${artifact.runId ?? "unknown"}-cleanup-capability-audit.json`
    );
    await fs.writeFile(auditArtifactPath, JSON.stringify(auditArtifact, null, 2), "utf8");
    await testInfo.attach("inssa-live-capsule-cleanup-capability-audit.json", {
      body: JSON.stringify(auditArtifact, null, 2),
      contentType: "application/json"
    });

    expect(
      findings.length,
      "Expected cleanup capability audit to inspect at least one authenticated surface."
    ).toBeGreaterThan(0);
    expect(
      findings.some((finding) => finding.status === "passed"),
      `Expected at least one cleanup audit surface to load. Findings:\n${formatFindings(findings)}`
    ).toBe(true);
    expect(
      auditArtifact.automationSafe,
      "Cleanup automation must remain disabled until scoped destructive control behavior is explicitly verified."
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

  if (!artifact.finalShareLink && !artifact.finalUrl && !artifact.possibleFinalCapsuleId) {
    throw new Error(
      `Artifact at "${ARTIFACT_PATH}" must include finalShareLink, finalUrl, or possibleFinalCapsuleId for cleanup capability auditing.`
    );
  }
}

async function runCleanupCapabilityAudit(input: {
  artifact: LiveCapsuleArtifactInput & { message: string; subject: string };
  browser: Browser;
  configuredUrl: string;
  storageStatePath: string;
  testInfo: TestInfo;
}): Promise<CleanupSurfaceFinding[]> {
  const context = await input.browser.newContext({
    baseURL: input.configuredUrl,
    storageState: input.storageStatePath
  });
  const page = await context.newPage();

  try {
    const targets = buildCleanupAuditTargets(input.configuredUrl, input.artifact);
    const findings: CleanupSurfaceFinding[] = [];

    for (const target of targets) {
      const finding = await probeCleanupSurface(page, input.artifact, target);
      findings.push(finding);
      if (finding.screenshotPath) {
        await input.testInfo.attach(`cleanup-capability-${target.label}.png`, {
          path: finding.screenshotPath,
          contentType: "image/png"
        });
      }
    }

    return findings;
  } finally {
    await context.close().catch(() => {});
  }
}

function buildCleanupAuditTargets(
  configuredUrl: string,
  artifact: LiveCapsuleArtifactInput
): Array<{ label: string; url: string }> {
  const origin = new URL(configuredUrl).origin;
  const targets = new Map<string, { label: string; url: string }>();

  addTarget(targets, "artifact-share-link", artifact.finalShareLink, origin);
  addTarget(targets, "artifact-final-url", artifact.finalUrl, origin);

  if (artifact.possibleFinalCapsuleId) {
    const tokenParam = artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : "";
    addTarget(targets, "artifact-capsule-id", `/capsule/${artifact.possibleFinalCapsuleId}${tokenParam}`, origin);
  }

  addTarget(targets, "home-feed", "/", origin);
  addTarget(targets, "profile-history", "/me", origin);
  addTarget(targets, "messages", "/messages", origin);
  addTarget(targets, "messages-tab-0", "/messages?tab=0", origin);
  addTarget(targets, "messages-tab-1", "/messages?tab=1", origin);

  return [...targets.values()];
}

function addTarget(
  targets: Map<string, { label: string; url: string }>,
  label: string,
  rawUrl: string | null | undefined,
  origin: string
): void {
  if (!rawUrl) {
    return;
  }

  const resolved = new URL(rawUrl, origin);
  if (resolved.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to probe non-staging INSSA cleanup target for "${label}": ${resolved.toString()}`);
  }

  targets.set(`${label}:${resolved.toString()}`, {
    label,
    url: resolved.toString()
  });
}

async function probeCleanupSurface(
  page: Page,
  artifact: LiveCapsuleArtifactInput & { message: string; subject: string },
  target: { label: string; url: string }
): Promise<CleanupSurfaceFinding> {
  const screenshotPath = path.join(
    AUDIT_ARTIFACT_DIR,
    `${artifact.runId ?? "unknown"}-cleanup-capability-${sanitizeForPath(target.label)}.png`
  );

  try {
    const response = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await expectPageNotBlank(page);

    const initialControls = await detectCleanupControls(page);
    const actionMenuButtonsClicked = await expandNonDestructiveActionMenus(page);
    const expandedControls = await detectCleanupControls(page);
    const cleanupControls = mergeCleanupMatrices(initialControls, expandedControls);
    const bodyText = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
    const genericShellVisible = INSSA_GENERIC_JS_SHELL_PATTERN.test(bodyText);

    await fs.mkdir(AUDIT_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ fullPage: true, path: screenshotPath });

    return {
      actionMenuButtonsClicked,
      authRedirected: isAuthRoute(page.url()),
      cleanupControls,
      exactMessageVisible: bodyText.includes(normalizeText(artifact.message)),
      exactSubjectVisible: bodyText.includes(normalizeText(artifact.subject)),
      finalUrl: page.url(),
      genericShellVisible,
      httpStatus: response?.status() ?? null,
      label: target.label,
      screenshotPath,
      status: "passed",
      targetUrl: target.url,
      visibleTextSample: bodyText.slice(0, 2_000)
    };
  } catch (error) {
    await fs.mkdir(AUDIT_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ fullPage: true, path: screenshotPath }).catch(() => {});

    return {
      actionMenuButtonsClicked: [],
      authRedirected: isAuthRoute(page.url()),
      cleanupControls: emptyCleanupMatrix(),
      error: error instanceof Error ? error.message : String(error),
      exactMessageVisible: false,
      exactSubjectVisible: false,
      finalUrl: page.url() || "about:blank",
      genericShellVisible: false,
      httpStatus: null,
      label: target.label,
      screenshotPath,
      status: "failed",
      targetUrl: target.url,
      visibleTextSample: normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "").slice(0, 2_000)
    };
  }
}

async function expandNonDestructiveActionMenus(page: Page): Promise<string[]> {
  const clickedLabels: string[] = [];
  const menuButtons = page.locator("button, [role='button']").filter({
    hasText: /more|options|actions|menu|\.\.\.|⋯|•••/i
  });
  const total = Math.min(await menuButtons.count().catch(() => 0), 3);

  for (let index = 0; index < total; index += 1) {
    const candidate = menuButtons.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const label = normalizeText((await candidate.innerText().catch(() => "")) || (await candidate.getAttribute("aria-label").catch(() => "")) || "");
    await candidate.click().catch(() => {});
    clickedLabels.push(label || `menu-${index + 1}`);
    await page.waitForTimeout(500);
  }

  return clickedLabels;
}

async function detectCleanupControls(page: Page): Promise<CleanupControlMatrix> {
  const matrix = emptyCleanupMatrix();
  const controls = page.locator("button, a[href], [role='button'], [role='menuitem']");
  const labels = await controls.evaluateAll((elements) =>
    elements
      .filter((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.innerText?.trim() ?? "";
        const aria = element.getAttribute("aria-label")?.trim() ?? "";
        const title = element.getAttribute("title")?.trim() ?? "";
        return [aria, text, title].find(Boolean) ?? "";
      })
      .filter(Boolean)
  );

  addDetectedControl(matrix, "archive", labels, INSSA_ARCHIVE_CAPSULE_PATTERN);
  addDetectedControl(matrix, "delete", labels, INSSA_DELETE_CAPSULE_PATTERN);
  addDetectedControl(matrix, "edit", labels, INSSA_EDIT_CAPSULE_PATTERN);
  addDetectedControl(matrix, "hide", labels, INSSA_HIDE_CAPSULE_PATTERN);
  addDetectedControl(matrix, "unpublish", labels, INSSA_UNPUBLISH_CAPSULE_PATTERN);

  return matrix;
}

function addDetectedControl(
  matrix: CleanupControlMatrix,
  key: CleanupControlKey,
  labels: string[],
  pattern: RegExp
): void {
  const matches = labels.filter((label) => pattern.test(label));
  matrix[key] = {
    detected: matches.length > 0,
    labels: [...new Set(matches)],
    surfaces: []
  };
}

function aggregateCleanupControls(findings: CleanupSurfaceFinding[]): CleanupControlMatrix {
  const aggregate = emptyCleanupMatrix();
  for (const finding of findings) {
    for (const key of Object.keys(aggregate) as CleanupControlKey[]) {
      const controls = finding.cleanupControls[key];
      if (!controls.detected) {
        continue;
      }

      aggregate[key].detected = true;
      aggregate[key].labels = [...new Set(aggregate[key].labels.concat(controls.labels))];
      aggregate[key].surfaces = [...new Set(aggregate[key].surfaces.concat(finding.label))];
    }
  }

  return aggregate;
}

function mergeCleanupMatrices(left: CleanupControlMatrix, right: CleanupControlMatrix): CleanupControlMatrix {
  const merged = emptyCleanupMatrix();
  for (const key of Object.keys(merged) as CleanupControlKey[]) {
    merged[key] = {
      detected: left[key].detected || right[key].detected,
      labels: [...new Set(left[key].labels.concat(right[key].labels))],
      surfaces: []
    };
  }

  return merged;
}

function emptyCleanupMatrix(): CleanupControlMatrix {
  return {
    archive: { detected: false, labels: [], surfaces: [] },
    delete: { detected: false, labels: [], surfaces: [] },
    edit: { detected: false, labels: [], surfaces: [] },
    hide: { detected: false, labels: [], surfaces: [] },
    unpublish: { detected: false, labels: [], surfaces: [] }
  };
}

function resolvePrimaryLink(configuredUrl: string, artifact: LiveCapsuleArtifactInput): string {
  const origin = new URL(configuredUrl).origin;
  const rawLink =
    artifact.finalShareLink ||
    artifact.finalUrl ||
    (artifact.possibleFinalCapsuleId ? `/capsule/${artifact.possibleFinalCapsuleId}` : "");
  const resolved = new URL(rawLink, origin).toString();

  if (!INSSA_CAPSULE_SHARE_LINK_PATTERN.test(resolved)) {
    return resolved;
  }

  return resolved;
}

function formatFindings(findings: CleanupSurfaceFinding[]): string {
  return findings
    .map(
      (finding) =>
        `- ${finding.label}: status=${finding.status}, subjectVisible=${finding.exactSubjectVisible}, messageVisible=${finding.exactMessageVisible}, controls=${JSON.stringify(
          finding.cleanupControls
        )}, finalUrl=${finding.finalUrl}${finding.error ? `, error=${finding.error}` : ""}`
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
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "cleanup-capability";
}

function extractCapsuleId(candidate: string): string | null {
  return candidate.match(/\/capsule\/([A-Za-z0-9_-]{6,})/i)?.[1] ?? null;
}

function extractShareToken(candidate: string): string | null {
  return candidate.match(/[?&]token=([^&\s]+)/i)?.[1] ?? null;
}
