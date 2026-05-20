import { promises as fs } from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { expectPageNotBlank } from "../../utils/assertions";
import { assertValidInssaUrl } from "../../utils/env";
import { INSSA_CAPSULE_SHARE_LINK_PATTERN, INSSA_GENERIC_JS_SHELL_PATTERN } from "../../utils/inssa-test-data";

const ARTIFACT_PATH = process.env.INSSA_LIVE_CAPSULE_ARTIFACT_PATH?.trim() ?? "";
const STAGING_HOSTNAME = "staging.inssa.us";
const VALIDATION_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");

type LiveArtifactInput = {
  finalShareLink?: string | null;
  finalUrl?: string;
  message?: string;
  possibleFinalCapsuleId?: string | null;
  possibleShareToken?: string | null;
  runId?: string;
  subject?: string;
};

type ShareLinkValidationArtifact = {
  artifactPath: string;
  environment: "staging";
  finalRoute: string;
  finalShareLink: string;
  httpStatus: number | null;
  messageVisible: boolean;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  runId: string | null;
  screenshotPath: string;
  subject: string;
  subjectVisible: boolean;
  validatedAt: string;
  visibleCapsuleText: string;
};

test.describe("INSSA live capsule share-link validation", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ARTIFACT_PATH, "Requires INSSA_LIVE_CAPSULE_ARTIFACT_PATH=<artifact.json> from a successful live capsule run.");
  test.setTimeout(120_000);

  test.beforeAll(() => {
    const configuredUrl = assertValidInssaUrl();
    const hostname = new URL(configuredUrl).hostname.toLowerCase();

    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(
        `INSSA live capsule share-link validation is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
      );
    }
  });

  test("opens a previously generated share link in a clean public context", async ({ browser }, testInfo) => {
    const configuredUrl = assertValidInssaUrl();
    const artifact = await readArtifact(ARTIFACT_PATH);
    const shareLink = resolveShareLink(configuredUrl, artifact);

    if (!artifact.subject || !artifact.message) {
      throw new Error(`Artifact at "${ARTIFACT_PATH}" must include both "subject" and "message".`);
    }

    assertStagingShareLink(shareLink);

    const screenshotPath = path.join(
      VALIDATION_ARTIFACT_DIR,
      `${artifact.runId ?? "unknown"}-share-link-validation.png`
    );
    const validationArtifactPath = path.join(
      VALIDATION_ARTIFACT_DIR,
      `${artifact.runId ?? "unknown"}-share-link-validation.json`
    );

    const context = await browser.newContext({
      baseURL: configuredUrl,
      storageState: { cookies: [], origins: [] }
    });
    const page = await context.newPage();

    try {
      const response = await page.goto(shareLink, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await expectPageNotBlank(page);
      await expect(page.locator("body")).not.toContainText(INSSA_GENERIC_JS_SHELL_PATTERN);

      const bodyText = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
      const subjectVisible = bodyText.includes(normalizeText(artifact.subject));
      const messageVisible = bodyText.includes(normalizeText(artifact.message));

      await fs.mkdir(VALIDATION_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ fullPage: true, path: screenshotPath });

      const validationArtifact: ShareLinkValidationArtifact = {
        artifactPath: path.resolve(ARTIFACT_PATH),
        environment: "staging",
        finalRoute: page.url(),
        finalShareLink: shareLink,
        httpStatus: response?.status() ?? null,
        messageVisible,
        possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? extractCapsuleId(shareLink),
        possibleShareToken: artifact.possibleShareToken ?? extractShareToken(shareLink),
        runId: artifact.runId ?? null,
        screenshotPath,
        subject: artifact.subject,
        subjectVisible,
        validatedAt: new Date().toISOString(),
        visibleCapsuleText: bodyText.slice(0, 2_000)
      };

      await fs.writeFile(validationArtifactPath, JSON.stringify(validationArtifact, null, 2), "utf8");
      await testInfo.attach("inssa-live-capsule-share-link-validation.json", {
        body: JSON.stringify(validationArtifact, null, 2),
        contentType: "application/json"
      });
      await testInfo.attach("inssa-live-capsule-share-link-validation.png", {
        path: screenshotPath,
        contentType: "image/png"
      });

      expect(response?.status(), `Expected share link to load below HTTP 400. Final URL: ${page.url()}.`).toBeLessThan(400);
      expect(subjectVisible, `Expected public share link to show exact QA subject "${artifact.subject}".`).toBe(true);
      expect(messageVisible, "Expected public share link to show exact QA message from the artifact.").toBe(true);
    } finally {
      await context.close().catch(() => {});
    }
  });
});

async function readArtifact(artifactPath: string): Promise<LiveArtifactInput> {
  const absolutePath = path.resolve(artifactPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw) as LiveArtifactInput;
}

function resolveShareLink(configuredUrl: string, artifact: LiveArtifactInput): string {
  const rawLink = artifact.finalShareLink || artifact.finalUrl || "";
  if (!rawLink) {
    throw new Error(`Artifact at "${ARTIFACT_PATH}" must include "finalShareLink" or a capsule "finalUrl".`);
  }

  const resolved = new URL(rawLink, new URL(configuredUrl).origin).toString();
  if (!INSSA_CAPSULE_SHARE_LINK_PATTERN.test(resolved)) {
    throw new Error(`Artifact link does not look like an INSSA capsule share link: ${resolved}`);
  }

  return resolved;
}

function assertStagingShareLink(shareLink: string): void {
  const parsed = new URL(shareLink);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to validate a non-staging INSSA share link: ${shareLink}`);
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractCapsuleId(candidate: string): string | null {
  return candidate.match(/\/capsule\/([A-Za-z0-9_-]{6,})/i)?.[1] ?? null;
}

function extractShareToken(candidate: string): string | null {
  return candidate.match(/[?&]token=([^&\s]+)/i)?.[1] ?? null;
}
