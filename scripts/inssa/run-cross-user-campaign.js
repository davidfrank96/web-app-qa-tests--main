#!/usr/bin/env node

const { createHash } = require("crypto");
const { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("@playwright/test");
const {
  requireCrossUserCapsuleIdentity,
  resolveCrossUserCapsuleIdentity
} = require("./cross-user-identity");

const ROOT = process.cwd();
const STAGING_HOSTNAME = "staging.inssa.us";
const PROJECT = "inssa-chrome";
const ENV_FILE = path.resolve(ROOT, ".env.inssa.live-staging");
const LIFECYCLE_ARTIFACT_DIR = path.resolve(ROOT, "lifecycle-artifacts");
const CROSS_USER_DIR = path.resolve(ROOT, "security-campaigns", "cross-user");
const REPORT_DIR = path.resolve(ROOT, "reports", "security");
const CREATE_SPEC = "tests/inssa/contact-share-state-machine.spec.ts";
const NAVIGATION_TIMEOUT_MS = 25_000;

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  loadLiveStagingEnv();
  const baseUrl = assertCrossUserEnvironment();
  const startedAtMs = Date.now();

  console.log("\nINSSA cross-user access-control campaign");
  console.log(`PHASE 1: User A creates one QA-tagged capsule via ${CREATE_SPEC}`);
  const createResult = await runCreatePhase();
  if (createResult.code !== 0) {
    throw new Error(`User A create phase failed with exit code ${createResult.code}. Cross-user probes were not run.`);
  }

  const artifactMatch = findNewestPrimaryCreationArtifact(startedAtMs);
  if (!artifactMatch) {
    throw new Error(`Create phase passed, but no new lifecycle artifact was found in ${LIFECYCLE_ARTIFACT_DIR}.`);
  }

  const capsuleId = requireCrossUserCapsuleIdentity(artifactMatch.artifact);

  console.log(`PHASE 1 artifact: ${artifactMatch.path}`);
  const secondaryStorageStatePath = await ensureSecondaryStorageState(baseUrl);

  console.log("PHASE 2: User B attempts capsule and surface access.");
  const accessVerification = await verifySecondaryAccess(baseUrl, artifactMatch.artifact, secondaryStorageStatePath);

  console.log("PHASE 3: User B media access verification.");
  const mediaVerification = await verifySecondaryMediaAccess(artifactMatch.artifact);

  const summary = buildSummary({
    accessVerification,
    artifactMatch,
    baseUrl,
    capsuleId,
    createResult,
    mediaVerification,
    secondaryStorageStatePath,
    startedAtMs
  });

  mkdirSync(CROSS_USER_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = path.join(CROSS_USER_DIR, "latest-cross-user-verification.json");
  const runOutputPath = path.join(CROSS_USER_DIR, `${summary.runId}-cross-user-verification.json`);
  const reportPath = path.join(REPORT_DIR, "cross-user-security.html");
  summary.outputPath = outputPath;
  summary.runOutputPath = runOutputPath;
  summary.reportPath = reportPath;
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(runOutputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderHtml(summary), "utf8");

  printSummary(summary);

  if (summary.hardFailure) {
    process.exitCode = 1;
  }
}

function loadLiveStagingEnv() {
  if (existsSync(ENV_FILE)) {
    require("dotenv").config({ path: ENV_FILE, quiet: true });
  }
}

function assertCrossUserEnvironment() {
  const configuredUrl = requiredEnv("INSSA_URL");
  const parsed = new URL(configuredUrl);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Cross-user campaign is hard-blocked outside ${STAGING_HOSTNAME}. Current host: ${parsed.hostname}`);
  }

  for (const flag of ["INSSA_ENABLE_LIVE_CAPSULE_TESTS", "INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED"]) {
    if (process.env[flag] !== "1") {
      throw new Error(`Cross-user campaign requires ${flag}=1 because phase 1 creates one staging capsule.`);
    }
  }

  requiredEnv("INSSA_TEST_EMAIL");
  requiredEnv("INSSA_TEST_PASSWORD");
  requiredEnv("INSSA_SECONDARY_TEST_EMAIL");
  requiredEnv("INSSA_SECONDARY_TEST_PASSWORD");
  return parsed.origin;
}

function runCreatePhase() {
  const playwrightBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "playwright.cmd" : "playwright"
  );
  const command = existsSync(playwrightBin) ? playwrightBin : process.platform === "win32" ? "npx.cmd" : "npx";
  const args = existsSync(playwrightBin)
    ? ["test", CREATE_SPEC, "--project", PROJECT, "--workers=1", "--retries=0"]
    : ["playwright", "test", CREATE_SPEC, "--project", PROJECT, "--workers=1", "--retries=0"];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        INSSA_ENABLE_CONTACT_SHARE_DIAGNOSTIC: "1",
        INSSA_CONTACT_SHARE_TARGET_EMAIL: process.env.INSSA_SECONDARY_TEST_EMAIL,
        INSSA_TEST_EMAIL: process.env.INSSA_TEST_EMAIL,
        INSSA_TEST_PASSWORD: process.env.INSSA_TEST_PASSWORD
      },
      stdio: "inherit"
    });
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal }));
  });
}

function findNewestPrimaryCreationArtifact(startedAtMs) {
  if (!existsSync(LIFECYCLE_ARTIFACT_DIR)) return null;
  const primaryEmail = process.env.INSSA_TEST_EMAIL;
  const matches = readdirSync(LIFECYCLE_ARTIFACT_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const artifactPath = path.join(LIFECYCLE_ARTIFACT_DIR, fileName);
      const artifact = readJson(artifactPath);
      if (!isUsableCreationArtifact(artifact)) return null;
      if (!String(artifact.subject).startsWith("QA_LIVE_CAPSULE_")) return null;
      if (artifact.maskedTestEmail && primaryEmail && artifact.maskedTestEmail !== maskEmail(primaryEmail)) return null;
      const mtimeMs = statSync(artifactPath).mtimeMs;
      if (mtimeMs < startedAtMs - 1_000) return null;
      return { artifact, mtimeMs, path: artifactPath };
    })
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return matches[0] ?? null;
}

async function ensureSecondaryStorageState(baseUrl) {
  const email = requiredEnv("INSSA_SECONDARY_TEST_EMAIL");
  const password = requiredEnv("INSSA_SECONDARY_TEST_PASSWORD");
  const statePath = getStorageStatePath(baseUrl, email);
  mkdirSync(path.dirname(statePath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    if (await storageStateLooksUsable(browser, statePath)) {
      return statePath;
    }

    const context = await browser.newContext({ baseURL: baseUrl, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/signin", { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    const emailField = await expectAuthField(page, "email");
    const passwordField = await expectAuthField(page, "password");
    await emailField.fill(email);
    await passwordField.fill(password);
    await page.getByRole("button", { name: /^sign in$|^log in$|^continue$/i }).first().click();
    await waitForAuthenticatedTransition(page);
    await context.storageState({ path: statePath });
    await context.close().catch(() => {});
    return statePath;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function storageStateLooksUsable(browser, statePath) {
  if (!existsSync(statePath)) return false;
  const context = await browser.newContext({ baseURL: process.env.INSSA_URL, storageState: statePath });
  const page = await context.newPage();
  try {
    await page.goto("/me", { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const profileVisible = await page
      .locator("button, a[href]")
      .filter({ hasText: /sign out|edit profile|my contacts|requests|alerts|following|loved/i })
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
    return profileVisible;
  } finally {
    await context.close().catch(() => {});
  }
}

async function verifySecondaryAccess(baseUrl, artifact, storageStatePath) {
  const urls = resolveCapsuleUrls(baseUrl, artifact);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: baseUrl, storageState: storageStatePath });
    const directRouteProbe = urls.directCapsuleUrl
      ? await probePage(context, urls.directCapsuleUrl, artifact, "direct-capsule-route")
      : null;
    const tokenizedProbe = urls.tokenizedUrl
      ? await probePage(context, urls.tokenizedUrl, artifact, "tokenized-route")
      : null;
    const tokenlessProbe = urls.tokenlessUrl
      ? await probePage(context, urls.tokenlessUrl, artifact, "tokenless-route")
      : null;
    const surfaceProbes = [];
    for (const surface of buildSurfaceTargets(artifact)) {
      surfaceProbes.push(await probeSurface(context, surface, artifact));
    }
    await context.close().catch(() => {});

    const routeClassification = classifyRouteAccess({ directRouteProbe, tokenizedProbe, tokenlessProbe });
    const targetMatchesSecondary = artifact.selectedContactTarget === maskEmail(process.env.INSSA_SECONDARY_TEST_EMAIL);
    const surfaceClassification = classifySurfaceAccess(surfaceProbes, { targetMatchesSecondary });
    const isolationClassification = classifyIsolation(routeClassification, surfaceClassification, {
      targetMatchesSecondary
    });

    return {
      classification: isolationClassification,
      directRouteProbe,
      routeClassification,
      targetMatchesSecondary,
      surfaceClassification,
      surfaceProbes,
      tokenizedProbe,
      tokenlessProbe
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function verifySecondaryMediaAccess(artifact) {
  const mediaUrls = extractMediaUrls(artifact);
  if (mediaUrls.length === 0) {
    return {
      classification: "media-not-observed",
      mediaUrlCount: 0,
      probes: [],
      summary: "No image/video storage URLs were found in the created text-only artifact."
    };
  }

  const probes = [];
  for (const url of mediaUrls.slice(0, 8)) {
    probes.push(await probeMediaUrl(url, "tokenized-media-url"));
    const tokenlessUrl = buildTokenlessUrl(url);
    if (tokenlessUrl !== url) {
      probes.push(await probeMediaUrl(tokenlessUrl, "tokenless-media-url"));
    }
  }

  const classification = classifyMediaAccess(probes);
  return {
    classification,
    mediaUrlCount: mediaUrls.length,
    probes,
    summary: describeMediaClassification(classification)
  };
}

async function probePage(context, targetUrl, artifact, label) {
  assertStagingUrl(targetUrl);
  const page = await context.newPage();
  try {
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(750);
    const bodyText = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
    const buttons = await page
      .getByRole("button")
      .evaluateAll((entries) => entries.map((entry) => (entry.textContent ?? "").trim()).filter(Boolean))
      .catch(() => []);
    return {
      label,
      authRedirected: isAuthRoute(page.url()),
      contentVisible: bodyText.includes(normalizeText(artifact.subject)) || bodyText.includes(normalizeText(artifact.message)),
      error: null,
      finalUrl: redactUrl(page.url()),
      foundMessage: bodyText.includes(normalizeText(artifact.message)),
      foundSubject: bodyText.includes(normalizeText(artifact.subject)),
      httpStatus: response?.status() ?? null,
      targetUrl: redactUrl(targetUrl),
      visibleButtons: buttons.slice(0, 12),
      visibleTextSample: redactText(bodyText.slice(0, 1_200))
    };
  } catch (error) {
    return {
      label,
      authRedirected: false,
      contentVisible: false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: redactUrl(page.url()),
      foundMessage: false,
      foundSubject: false,
      httpStatus: null,
      targetUrl: redactUrl(targetUrl),
      visibleButtons: [],
      visibleTextSample: ""
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function probeSurface(context, surface, artifact) {
  const page = await context.newPage();
  try {
    const response = await page.goto(surface.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    if (surface.search) {
      const searchInput = page
        .locator("input[type='search'], input[placeholder*='search' i], input[aria-label*='search' i], input[name*='search' i]")
        .first();
      if (await searchInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await searchInput.fill(artifact.subject);
        await page.keyboard.press("Enter").catch(() => {});
        await page.waitForTimeout(1_000);
      }
    }
    const bodyText = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
    return {
      label: surface.label,
      contentVisible: bodyText.includes(normalizeText(artifact.subject)) || bodyText.includes(normalizeText(artifact.message)),
      error: null,
      finalUrl: redactUrl(page.url()),
      foundMessage: bodyText.includes(normalizeText(artifact.message)),
      foundSubject: bodyText.includes(normalizeText(artifact.subject)),
      httpStatus: response?.status() ?? null,
      route: surface.url,
      visibleTextSample: redactText(bodyText.slice(0, 1_200))
    };
  } catch (error) {
    return {
      label: surface.label,
      contentVisible: false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: redactUrl(page.url()),
      foundMessage: false,
      foundSubject: false,
      httpStatus: null,
      route: surface.url,
      visibleTextSample: ""
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function probeMediaUrl(url, label) {
  assertStorageUrl(url);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    const contentType = response.headers.get("content-type");
    const accessible = response.status >= 200 && response.status < 300;
    return {
      label,
      accessible,
      accessibleMedia: accessible && /^(image|video)\//i.test(contentType ?? ""),
      contentLength: response.headers.get("content-length"),
      contentType,
      durationMs: Date.now() - startedAt,
      error: null,
      httpStatus: response.status,
      tokenPresent: new URL(url).searchParams.has("token"),
      url: redactUrl(url)
    };
  } catch (error) {
    return {
      label,
      accessible: false,
      accessibleMedia: false,
      contentLength: null,
      contentType: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      httpStatus: null,
      tokenPresent: new URL(url).searchParams.has("token"),
      url: redactUrl(url)
    };
  }
}

function buildSummary(input) {
  const artifact = input.artifactMatch.artifact;
  const access = input.accessVerification;
  const media = input.mediaVerification;
  const hardFailure =
    access.classification === "unauthorized-visible" ||
    access.classification === "unexpected-authenticated-access" ||
    media.classification === "media-publicly-accessible";
  const riskLevel = hardFailure ? "High" : access.classification === "public-by-design" ? "Medium" : "Informational";
  return {
    campaign: "cross-user-access-control",
    createdAt: new Date().toISOString(),
    environment: "staging",
    runId: artifact.runId,
    primaryUser: maskEmail(process.env.INSSA_TEST_EMAIL),
    secondaryUser: maskEmail(process.env.INSSA_SECONDARY_TEST_EMAIL),
    primaryCreate: {
      commandStatus: input.createResult.code === 0 ? "passed" : "failed",
      artifactPath: input.artifactMatch.path,
      capsuleId: input.capsuleId,
      tokenizedUrl: redactUrl(resolveCapsuleUrls(input.baseUrl, artifact).tokenizedUrl),
      tokenlessUrl: redactUrl(resolveCapsuleUrls(input.baseUrl, artifact).tokenlessUrl),
      subject: artifact.subject
    },
    secondaryAccess: access,
    mediaVerification: media,
    classifications: {
      isolation: access.classification,
      routeAccess: access.routeClassification,
      surfaceAccess: access.surfaceClassification,
      media: media.classification
    },
    riskLevel,
    hardFailure,
    securityPosture: hardFailure ? "cross-user-access-control-risk-confirmed" : "cross-user-access-control-verified",
    cleanupInstruction: artifact.cleanupInstruction ?? "Development team should delete this QA live capsule from staging after verification."
  };
}

function classifyRouteAccess({ directRouteProbe, tokenizedProbe, tokenlessProbe }) {
  const tokenizedVisible = Boolean(tokenizedProbe?.contentVisible);
  const tokenlessVisible = Boolean(tokenlessProbe?.contentVisible);
  const directVisible = Boolean(directRouteProbe?.contentVisible);
  if (tokenlessVisible || directVisible) return tokenizedVisible ? "public-by-id" : "token-optional";
  if (tokenizedVisible) return "token-required";
  return "isolated";
}

function classifySurfaceAccess(surfaceProbes, input = {}) {
  const visible = surfaceProbes.some((probe) => probe.contentVisible);
  if (!visible) return "authenticated-surface-hidden";
  return input.targetMatchesSecondary ? "targeted-contact-surface-visible" : "authenticated-surface-visible";
}

function classifyIsolation(routeClassification, surfaceClassification, input = {}) {
  if (surfaceClassification === "targeted-contact-surface-visible" && input.targetMatchesSecondary) {
    return "expected-share-access";
  }
  if (surfaceClassification === "authenticated-surface-visible") return "unauthorized-visible";
  if (routeClassification === "public-by-id" || routeClassification === "token-optional") return "public-by-design";
  if (routeClassification === "token-required") return "expected-share-access";
  return "isolated";
}

function classifyMediaAccess(probes) {
  const tokenlessVisible = probes.some((probe) => !probe.tokenPresent && probe.accessibleMedia);
  const tokenizedVisible = probes.some((probe) => probe.tokenPresent && probe.accessibleMedia);
  if (tokenlessVisible) return "media-publicly-accessible";
  if (tokenizedVisible) return "media-authenticated-only";
  return "media-isolated";
}

function describeMediaClassification(classification) {
  return {
    "media-isolated": "Secondary probes did not retrieve media content.",
    "media-publicly-accessible": "Secondary probes retrieved media content without a token.",
    "media-authenticated-only": "Secondary probes retrieved media content only through a tokenized media URL."
  }[classification] ?? classification;
}

function buildSurfaceTargets(artifact) {
  return [
    { label: "feed", url: "/" },
    { label: "search", url: "/", search: true },
    { label: "profile-history", url: "/me" },
    { label: "messages", url: "/messages" },
    { label: "messages-drafts-tab", url: "/messages?tab=1" },
    { label: "profile-connections", url: "/profile/connections" }
  ].map((surface) => ({ ...surface, expectedSubject: artifact.subject }));
}

function resolveCapsuleUrls(baseUrl, artifact) {
  const capsuleId = resolveCrossUserCapsuleIdentity(artifact);
  const token = artifact.possibleShareToken || extractShareToken(artifact.finalShareLink || artifact.finalUrl || "");
  const directCapsuleUrl = capsuleId ? `${baseUrl}/capsule/${capsuleId}` : null;
  const tokenizedUrl =
    artifact.finalShareLink ||
    (capsuleId && token ? `${baseUrl}/capsule/${capsuleId}?token=${encodeURIComponent(token)}` : null);
  const tokenlessUrl = tokenizedUrl ? buildTokenlessUrl(tokenizedUrl) : directCapsuleUrl;
  return { directCapsuleUrl, tokenizedUrl, tokenlessUrl };
}

function extractMediaUrls(value, output = []) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(value)) {
      output.push(value);
    }
    return uniqueStrings(output);
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => extractMediaUrls(entry, output));
    return uniqueStrings(output);
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => extractMediaUrls(entry, output));
  }
  return uniqueStrings(output);
}

function isUsableCreationArtifact(artifact) {
  const successSignals = Array.isArray(artifact?.successSignals) ? artifact.successSignals : [];
  const contactShareArtifact =
    artifact?.finalBuryThenChooseClicked === true &&
    artifact?.contactSelection?.afterSnapshot?.selectedContactsCount === 1 &&
    (artifact?.shareLinkGeneratedAfterContactSelection === true || successSignals.length > 0);

  return (
    artifact &&
    artifact.environment === "staging" &&
    artifact.observedCreateSuccess === true &&
    artifact.buryClicked === true &&
    artifact.revealSettingsOpened === true &&
    artifact.revealSettingsContinueClicked === true &&
    typeof artifact.runId === "string" &&
    typeof artifact.subject === "string" &&
    typeof artifact.message === "string" &&
    (typeof artifact.finalShareLink === "string" ||
      typeof artifact.possibleFinalCapsuleId === "string" ||
      contactShareArtifact)
  );
}

async function expectAuthField(page, kind) {
  const selector =
    kind === "email"
      ? "input[type='email'], input[autocomplete='email'], input[name*='email' i], input[placeholder*='email' i]"
      : "input[type='password'], input[autocomplete='current-password'], input[name*='password' i], input[placeholder*='password' i]";
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  return locator;
}

async function waitForAuthenticatedTransition(page) {
  const deadline = Date.now() + 20_000;
  while (Date.now() <= deadline) {
    if (!/\/signin\/?$/i.test(new URL(page.url()).pathname)) return;
    const authenticatedSignal = await page
      .locator("a[href='/me'], a[href^='/u/'], a[href*='/profile']")
      .first()
      .isVisible()
      .catch(() => false);
    if (authenticatedSignal) return;
    await page.waitForTimeout(300);
  }
  throw new Error("Secondary INSSA login did not transition away from the sign-in surface.");
}

function getStorageStatePath(baseUrl, email) {
  const key = createHash("sha256").update(`${baseUrl}\n${email}`).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), "web-app-qa-tests", "inssa-auth", key, "storage-state.json");
}

function buildTokenlessUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("token");
  return parsed.toString();
}

function assertStagingUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to probe non-staging URL: ${redactUrl(url)}`);
  }
}

function assertStorageUrl(url) {
  const parsed = new URL(url);
  if (!/firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(parsed.hostname)) {
    throw new Error(`Refusing to probe non-storage media URL: ${redactUrl(url)}`);
  }
}

function extractCapsuleId(url) {
  try {
    return new URL(url).pathname.match(/\/capsule\/([^/?#]+)/i)?.[1] ?? null;
  } catch {
    return String(url).match(/\/capsule\/([^/?#]+)/i)?.[1] ?? null;
  }
}

function extractShareToken(url) {
  try {
    return new URL(url).searchParams.get("token");
  } catch {
    return null;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required for the INSSA cross-user campaign.`);
  }
  return value.trim();
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function isAuthRoute(candidate) {
  try {
    const pathname = new URL(candidate).pathname;
    return /^\/(?:sign-in|signin|login)(?:\/)?$|^\/(?:auth|onboarding|onboard|start)(?:\/|$)/i.test(pathname);
  } catch {
    return /\/(?:sign-in|signin|login|auth|onboarding|onboard|start)(?:\/|$)/i.test(candidate);
  }
}

function redactUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    for (const key of ["token", "access_token", "id_token", "refresh_token", "auth", "code"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return redactText(url);
  }
}

function redactText(text) {
  return String(text ?? "")
    .replace(/([?&](?:token|access_token|id_token|refresh_token|auth|code)=)[^&#\s"']+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/g, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) => maskEmail(email));
}

function maskEmail(email) {
  const [local, domain] = String(email ?? "").split("@");
  if (!local || !domain) return "[redacted-email]";
  return `${local[0]}***@${domain}`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function renderHtml(summary) {
  const routeRows = [
    summary.secondaryAccess.directRouteProbe,
    summary.secondaryAccess.tokenizedProbe,
    summary.secondaryAccess.tokenlessProbe
  ]
    .filter(Boolean)
    .map((probe) => resultRow(probe.label, probe.contentVisible ? "content-visible" : "content-hidden", probe.contentVisible ? "High" : "Informational", probe.finalUrl))
    .join("\n");
  const surfaceRows = summary.secondaryAccess.surfaceProbes
    .map((probe) => resultRow(probe.label, probe.contentVisible ? "content-visible" : "content-hidden", probe.contentVisible ? "High" : "Informational", probe.finalUrl))
    .join("\n");
  const mediaRows = summary.mediaVerification.probes
    .map((probe) => resultRow(probe.label, probe.accessibleMedia ? "media-visible" : "media-hidden", probe.accessibleMedia && !probe.tokenPresent ? "High" : "Informational", probe.url))
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>INSSA Cross-User Access Control Campaign</title>
  <style>
    body { color: #172026; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; margin: 32px; }
    h1, h2 { color: #0f2e2e; }
    code { background: #eef3f1; border-radius: 4px; padding: 2px 5px; }
    table { border-collapse: collapse; margin: 16px 0 28px; width: 100%; }
    th, td { border-bottom: 1px solid #d8e3df; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #eef6f2; }
  </style>
</head>
<body>
  <h1>INSSA Cross-User Access Control Campaign</h1>
  <p><strong>Generated:</strong> ${escapeHtml(summary.createdAt)}</p>
  <p><strong>Risk:</strong> <code>${escapeHtml(summary.riskLevel)}</code></p>
  <p><strong>Security posture:</strong> <code>${escapeHtml(summary.securityPosture)}</code></p>
  <p><strong>User A:</strong> ${escapeHtml(summary.primaryUser)} | <strong>User B:</strong> ${escapeHtml(summary.secondaryUser)}</p>
  <h2>Access-Control Summary</h2>
  <table>
    <tr><th>Isolation</th><td><code>${escapeHtml(summary.classifications.isolation)}</code></td></tr>
    <tr><th>Route Access</th><td><code>${escapeHtml(summary.classifications.routeAccess)}</code></td></tr>
    <tr><th>Surface Access</th><td><code>${escapeHtml(summary.classifications.surfaceAccess)}</code></td></tr>
    <tr><th>Media Access</th><td><code>${escapeHtml(summary.classifications.media)}</code></td></tr>
  </table>
  <h2>Capsule Route Probes</h2>
  <table><tr><th>Probe</th><th>Classification</th><th>Risk</th><th>Final URL</th></tr>${routeRows}</table>
  <h2>Authenticated Surface Probes</h2>
  <table><tr><th>Surface</th><th>Classification</th><th>Risk</th><th>Final URL</th></tr>${surfaceRows}</table>
  <h2>Media Probes</h2>
  <table><tr><th>Probe</th><th>Classification</th><th>Risk</th><th>URL</th></tr>${mediaRows || "<tr><td colspan=\"4\">No media URLs were observed in this text capsule artifact.</td></tr>"}</table>
  <h2>Cleanup</h2>
  <p>${escapeHtml(summary.cleanupInstruction)}</p>
</body>
</html>
`;
}

function resultRow(name, classification, risk, target) {
  return `<tr><td>${escapeHtml(name)}</td><td><code>${escapeHtml(classification)}</code></td><td>${escapeHtml(risk)}</td><td><code>${escapeHtml(target ?? "")}</code></td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printSummary(summary) {
  console.log("\nINSSA cross-user access-control campaign complete.");
  console.log(`- output: ${summary.outputPath}`);
  console.log(`- report: ${summary.reportPath}`);
  console.log(`- capsule ID: ${summary.primaryCreate.capsuleId ?? "unknown"}`);
  console.log(`- isolation: ${summary.classifications.isolation}`);
  console.log(`- route access: ${summary.classifications.routeAccess}`);
  console.log(`- surface access: ${summary.classifications.surfaceAccess}`);
  console.log(`- media: ${summary.classifications.media}`);
  console.log(`- risk: ${summary.riskLevel}`);
  console.log(`- cleanup: ${summary.cleanupInstruction}`);
}

function printUsage() {
  console.log(`
Usage:
  npm run test:inssa:campaign:cross-user

Required env:
  INSSA_URL=https://staging.inssa.us
  INSSA_TEST_EMAIL
  INSSA_TEST_PASSWORD
  INSSA_SECONDARY_TEST_EMAIL
  INSSA_SECONDARY_TEST_PASSWORD
  INSSA_ENABLE_LIVE_CAPSULE_TESTS=1
  INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1

Outputs:
  security-campaigns/cross-user/latest-cross-user-verification.json
  reports/security/cross-user-security.html

This campaign creates one QA-tagged staging capsule with User A, then probes it as User B.
`);
}
