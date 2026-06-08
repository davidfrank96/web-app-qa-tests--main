#!/usr/bin/env node

const { createHash } = require("crypto");
const { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("@playwright/test");

const ROOT = process.cwd();
const STAGING_HOSTNAME = "staging.inssa.us";
const PROJECT = "inssa-chrome";
const ENV_FILE = path.resolve(ROOT, ".env.inssa.live-staging");
const LIFECYCLE_ARTIFACT_DIR = path.resolve(ROOT, "lifecycle-artifacts");
const OUTPUT_DIR = path.resolve(ROOT, "security-campaigns", "reveal-later");
const REPORT_DIR = path.resolve(ROOT, "reports", "security");
const CREATE_SPEC = "tests/inssa/live-capsule-reveal-later-create.spec.ts";
const NAVIGATION_TIMEOUT_MS = 25_000;
const RESUME_ARTIFACT_ENV = "INSSA_REVEAL_LATER_SECURITY_ARTIFACT_PATH";
const WAIT_MAX_ENV = "INSSA_REVEAL_LATER_WAIT_MAX_MS";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  loadLiveStagingEnv();
  const baseUrl = assertRevealLaterEnvironment();
  const startedAtMs = Date.now();

  console.log("\nINSSA reveal-later security campaign");
  const resumeArtifactPath = process.env[RESUME_ARTIFACT_ENV]?.trim();
  const createResult = resumeArtifactPath ? { code: 0, resumed: true } : await runCreatePhaseWithLog();
  const artifactMatch = resumeArtifactPath ? resolveRevealLaterArtifact(resumeArtifactPath) : findNewestRevealLaterArtifact(startedAtMs);
  if (!artifactMatch) {
    throw new Error(`No usable reveal-later artifact was found in ${LIFECYCLE_ARTIFACT_DIR}.`);
  }

  console.log(`ARTIFACT: ${artifactMatch.path}`);
  const summary = await verifyRevealLaterAccess(baseUrl, artifactMatch, createResult);
  writeOutputs(summary);
  printSummary(summary);

  if (summary.hardFailure) {
    process.exitCode = 1;
  }
}

async function runCreatePhaseWithLog() {
  console.log(`CREATE: ${CREATE_SPEC}`);
  const createResult = await runCreatePhase();
  if (createResult.code !== 0) {
    throw new Error(`Reveal-later create phase failed with exit code ${createResult.code}. Pre-reveal probes were not run.`);
  }
  return createResult;
}

function loadLiveStagingEnv() {
  if (existsSync(ENV_FILE)) {
    require("dotenv").config({ path: ENV_FILE, quiet: true });
  }
}

function assertRevealLaterEnvironment() {
  const configuredUrl = requiredEnv("INSSA_URL");
  const parsed = new URL(configuredUrl);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Reveal-later security campaign is hard-blocked outside ${STAGING_HOSTNAME}. Current host: ${parsed.hostname}`);
  }

  for (const flag of [
    "INSSA_ENABLE_LIVE_CAPSULE_TESTS",
    "INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED",
    "INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS"
  ]) {
    if (process.env[flag] !== "1") {
      throw new Error(`Reveal-later security campaign requires ${flag}=1.`);
    }
  }

  requiredEnv("INSSA_TEST_EMAIL");
  requiredEnv("INSSA_TEST_PASSWORD");
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
        INSSA_TEST_EMAIL: process.env.INSSA_TEST_EMAIL,
        INSSA_TEST_PASSWORD: process.env.INSSA_TEST_PASSWORD
      },
      stdio: "inherit"
    });
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal }));
  });
}

async function verifyRevealLaterAccess(baseUrl, artifactMatch, createResult) {
  const artifact = artifactMatch.artifact;
  const urls = resolveCapsuleUrls(baseUrl, artifact);
  const schedule = getRevealSchedule(artifact);
  const beforeTime = buildScheduleTiming(schedule);
  const waitDecision = await maybeWaitForReveal(schedule);
  const primaryStorageStatePath = await ensureStorageState(baseUrl, "INSSA_TEST_EMAIL", "INSSA_TEST_PASSWORD");
  const secondaryStorageStatePath =
    process.env.INSSA_SECONDARY_TEST_EMAIL && process.env.INSSA_SECONDARY_TEST_PASSWORD
      ? await ensureStorageState(baseUrl, "INSSA_SECONDARY_TEST_EMAIL", "INSSA_SECONDARY_TEST_PASSWORD")
      : null;
  const browser = await chromium.launch({ headless: true });

  try {
    const cleanContext = await browser.newContext({ baseURL: baseUrl, storageState: { cookies: [], origins: [] } });
    const primaryContext = await browser.newContext({ baseURL: baseUrl, storageState: primaryStorageStatePath });
    const secondaryContext = secondaryStorageStatePath
      ? await browser.newContext({ baseURL: baseUrl, storageState: secondaryStorageStatePath })
      : null;

    const beforeReveal = await runAccessProbeSet({
      artifact,
      cleanContext,
      primaryContext,
      secondaryContext,
      urls
    });

    let afterReveal = null;
    if (Date.now() >= (schedule?.scheduledAtMs ?? Number.POSITIVE_INFINITY)) {
      afterReveal = await runAccessProbeSet({
        artifact,
        cleanContext,
        primaryContext,
        secondaryContext,
        urls
      });
    } else {
      afterReveal = {
        skipped: true,
        reason:
          waitDecision.status === "not-waited"
            ? `Reveal time is still in the future and ${WAIT_MAX_ENV} does not permit waiting ${beforeTime.timeRemainingMs}ms.`
            : `Reveal time is still in the future: ${schedule?.scheduledAtIso ?? "unknown"}.`,
        scheduleTiming: buildScheduleTiming(schedule)
      };
    }

    await cleanContext.close().catch(() => {});
    await primaryContext.close().catch(() => {});
    await secondaryContext?.close().catch(() => {});

    const allProbes = [
      ...Object.values(beforeReveal.routeProbes),
      ...beforeReveal.primarySurfaces,
      ...beforeReveal.secondarySurfaces
    ];
    const visibleProbes = allProbes.filter((probe) => probe.contentVisible);
    const tokenBehavior = classifyTokenBehavior(beforeReveal.routeProbes);
    const scheduleState = schedule?.state ?? "unknown";
    const securityClassification = classifyRevealLaterSecurity(visibleProbes, tokenBehavior, scheduleState);
    const riskLevel = classifyRisk(securityClassification, beforeReveal);

    return {
      accessControlReportPath: path.join(REPORT_DIR, "reveal-later-access-control.html"),
      campaign: "reveal-later-security",
      cleanupInstruction: artifact.cleanupInstruction ?? "Development team should delete this QA reveal-later capsule from staging after verification.",
      createdAt: new Date().toISOString(),
      environment: "staging",
      generatedAt: new Date().toISOString(),
      hardFailure: ["reveal-accessible-early", "reveal-bypass-risk", "reveal-schedule-unknown-with-visible-content"].includes(
        securityClassification
      ),
      lifecycle: {
        artifactPath: artifactMatch.path,
        commandStatus: createResult.code === 0 ? "passed" : "failed",
        finalShareLink: artifact.finalShareLink ?? null,
        possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? null,
        possibleShareToken: artifact.possibleShareToken ?? null,
        revealLaterFlowClassification: artifact.revealLaterFlowClassification ?? null,
        revealLaterSchedule: artifact.revealLaterSchedule ?? null,
        revealScheduleState: scheduleState,
        resolvedUrls: {
          directCapsuleUrl: redactUrl(urls.directCapsuleUrl),
          tokenizedUrl: redactUrl(urls.tokenizedUrl),
          tokenlessUrl: redactUrl(urls.tokenlessUrl)
        },
        revealTiming: artifact.revealTiming ?? null,
        runId: artifact.runId,
        subject: artifact.subject
      },
      afterRevealVisibility: afterReveal,
      beforeRevealVisibility: {
        ...beforeReveal,
        visibleProbeCount: visibleProbes.length,
        visibleProbes
      },
      crossUserVisibility: classifyCrossUserVisibility(beforeReveal),
      riskLevel,
      scheduleTiming: {
        before: beforeTime,
        after: buildScheduleTiming(schedule),
        waitDecision
      },
      securityClassification,
      tokenBehavior
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runAccessProbeSet(input) {
  const { artifact, cleanContext, primaryContext, secondaryContext, urls } = input;
  const routeProbes = {
    authenticatedDirect: urls.directCapsuleUrl
      ? await probePage(primaryContext, urls.directCapsuleUrl, artifact, "primary-authenticated-direct")
      : skippedProbe("primary-authenticated-direct", "direct capsule URL not available"),
    cleanTokenized: urls.tokenizedUrl
      ? await probePage(cleanContext, urls.tokenizedUrl, artifact, "clean-tokenized")
      : skippedProbe("clean-tokenized", "tokenized URL not captured"),
    cleanTokenless: urls.tokenlessUrl
      ? await probePage(cleanContext, urls.tokenlessUrl, artifact, "clean-tokenless")
      : skippedProbe("clean-tokenless", "tokenless URL not available"),
    primaryAuthenticatedTokenized: urls.tokenizedUrl
      ? await probePage(primaryContext, urls.tokenizedUrl, artifact, "primary-authenticated-tokenized")
      : skippedProbe("primary-authenticated-tokenized", "tokenized URL not captured"),
    primaryAuthenticatedTokenless: urls.tokenlessUrl
      ? await probePage(primaryContext, urls.tokenlessUrl, artifact, "primary-authenticated-tokenless")
      : skippedProbe("primary-authenticated-tokenless", "tokenless URL not available"),
    secondaryAuthenticatedDirect:
      secondaryContext && urls.directCapsuleUrl
        ? await probePage(secondaryContext, urls.directCapsuleUrl, artifact, "secondary-authenticated-direct")
        : skippedProbe("secondary-authenticated-direct", "secondary user or direct capsule URL not available"),
    secondaryAuthenticatedTokenized:
      secondaryContext && urls.tokenizedUrl
        ? await probePage(secondaryContext, urls.tokenizedUrl, artifact, "secondary-authenticated-tokenized")
        : skippedProbe("secondary-authenticated-tokenized", "secondary user or tokenized URL not available"),
    secondaryAuthenticatedTokenless:
      secondaryContext && urls.tokenlessUrl
        ? await probePage(secondaryContext, urls.tokenlessUrl, artifact, "secondary-authenticated-tokenless")
        : skippedProbe("secondary-authenticated-tokenless", "secondary user or tokenless URL not available")
  };

  const primarySurfaces = [];
  const secondarySurfaces = [];
  for (const surface of buildSurfaceTargets()) {
    primarySurfaces.push(await probeSurface(primaryContext, surface, artifact, "primary"));
    if (secondaryContext) {
      secondarySurfaces.push(await probeSurface(secondaryContext, surface, artifact, "secondary"));
    }
  }

  return {
    primarySurfaces,
    routeProbes,
    secondaryConfigured: Boolean(secondaryContext),
    secondarySurfaces
  };
}

function findNewestRevealLaterArtifact(startedAtMs) {
  if (!existsSync(LIFECYCLE_ARTIFACT_DIR)) return null;
  return readdirSync(LIFECYCLE_ARTIFACT_DIR)
    .filter((fileName) => fileName.endsWith("-reveal-later.json"))
    .map((fileName) => {
      const artifactPath = path.join(LIFECYCLE_ARTIFACT_DIR, fileName);
      const artifact = readJson(artifactPath);
      if (!isUsablePendingRevealLaterArtifact(artifact)) return null;
      const mtimeMs = statSync(artifactPath).mtimeMs;
      if (mtimeMs < startedAtMs - 1_000) return null;
      return { artifact, mtimeMs, path: artifactPath };
    })
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null;
}

function resolveRevealLaterArtifact(artifactPath) {
  const resolvedPath = path.resolve(artifactPath);
  const artifact = readJson(resolvedPath);
  if (!isUsablePendingRevealLaterArtifact(artifact)) {
    throw new Error(`Reveal-later artifact is not usable for Phase 7 probing: ${resolvedPath}`);
  }

  return {
    artifact,
    mtimeMs: statSync(resolvedPath).mtimeMs,
    path: resolvedPath
  };
}

function isUsablePendingRevealLaterArtifact(artifact) {
  return (
    artifact &&
    artifact.environment === "staging" &&
    artifact.observedCreateSuccess === true &&
    artifact.buryClicked === true &&
    artifact.revealSettingsOpened === true &&
    artifact.revealSettingsContinueClicked === true &&
    artifact.revealTiming === "reveal-later" &&
    typeof artifact.runId === "string" &&
    typeof artifact.subject === "string" &&
    typeof artifact.message === "string"
  );
}

async function ensureStorageState(baseUrl, emailEnv, passwordEnv) {
  const email = requiredEnv(emailEnv);
  const password = requiredEnv(passwordEnv);
  const statePath = getStorageStatePath(baseUrl, email);
  mkdirSync(path.dirname(statePath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    if (await storageStateLooksUsable(browser, baseUrl, statePath)) {
      return statePath;
    }

    const context = await browser.newContext({ baseURL: baseUrl, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/signin", { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.locator("input[type='email'], input[autocomplete='email'], input[name*='email' i], input[placeholder*='email' i]").first().fill(email);
    await page.locator("input[type='password'], input[autocomplete='current-password'], input[name*='password' i], input[placeholder*='password' i]").first().fill(password);
    await page.getByRole("button", { name: /^sign in$|^log in$|^continue$/i }).first().click();
    await waitForAuthenticatedTransition(page);
    await context.storageState({ path: statePath });
    await context.close().catch(() => {});
    return statePath;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function storageStateLooksUsable(browser, baseUrl, statePath) {
  if (!existsSync(statePath)) return false;
  const context = await browser.newContext({ baseURL: baseUrl, storageState: statePath });
  const page = await context.newPage();
  try {
    await page.goto("/me", { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
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

async function waitForAuthenticatedTransition(page) {
  const deadline = Date.now() + 20_000;
  while (Date.now() <= deadline) {
    if (!/\/signin\/?$/i.test(new URL(page.url()).pathname)) return;
    await page.waitForTimeout(300);
  }
  throw new Error("INSSA login did not transition away from the sign-in surface.");
}

async function probePage(context, targetUrl, artifact, label) {
  assertStagingUrl(targetUrl);
  const page = await context.newPage();
  try {
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(750);
    return buildProbe(page, artifact, label, response?.status() ?? null, targetUrl);
  } catch (error) {
    return {
      label,
      contentVisible: false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: redactUrl(page.url()),
      foundMessage: false,
      foundSubject: false,
      httpStatus: null,
      targetUrl: redactUrl(targetUrl),
      visibleTextSample: ""
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function probeSurface(context, surface, artifact, actor) {
  const page = await context.newPage();
  try {
    const response = await page.goto(surface.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    if (surface.search) {
      const searchInput = page.locator("input[type='search'], input[placeholder*='search' i], input[aria-label*='search' i], input[name*='search' i]").first();
      if (await searchInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await searchInput.fill(artifact.subject);
        await page.keyboard.press("Enter").catch(() => {});
        await page.waitForTimeout(1_000);
      }
    }
    return buildProbe(page, artifact, `${actor}-${surface.label}`, response?.status() ?? null, surface.url);
  } catch (error) {
    return {
      label: `${actor}-${surface.label}`,
      contentVisible: false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: redactUrl(page.url()),
      foundMessage: false,
      foundSubject: false,
      httpStatus: null,
      targetUrl: surface.url,
      visibleTextSample: ""
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function buildProbe(page, artifact, label, httpStatus, targetUrl) {
  const bodyText = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
  const foundSubject = bodyText.includes(normalizeText(artifact.subject));
  const foundMessage = bodyText.includes(normalizeText(artifact.message));
  return {
    label,
    contentVisible: foundSubject || foundMessage,
    error: null,
    finalUrl: redactUrl(page.url()),
    foundMessage,
    foundSubject,
    httpStatus,
    targetUrl: redactUrl(targetUrl),
    visibilityState: classifyProbeVisibility({ bodyText, finalUrl: page.url(), foundMessage, foundSubject, httpStatus }),
    visibleTextSample: redactText(bodyText.slice(0, 1_200))
  };
}

function buildSurfaceTargets() {
  return [
    { label: "messages", url: "/messages" },
    { label: "feed", url: "/" },
    { label: "search", url: "/", search: true },
    { label: "profile-history", url: "/me" }
  ];
}

function resolveCapsuleUrls(baseUrl, artifact) {
  const networkEvidence = extractCapsuleRouteEvidence(artifact);
  const capsuleId = artifact.possibleFinalCapsuleId || networkEvidence.capsuleId || extractCapsuleId(artifact.finalShareLink || artifact.finalUrl || "");
  const token = artifact.possibleShareToken || networkEvidence.token || extractShareToken(artifact.finalShareLink || artifact.finalUrl || "");
  const directCapsuleUrl = capsuleId ? `${baseUrl}/capsule/${capsuleId}` : null;
  const tokenizedUrl =
    artifact.finalShareLink ||
    networkEvidence.shareUrl ||
    (capsuleId && token ? `${baseUrl}/capsule/${capsuleId}?token=${encodeURIComponent(token)}` : null);
  const tokenlessUrl = tokenizedUrl ? buildTokenlessUrl(tokenizedUrl) : directCapsuleUrl;
  return { directCapsuleUrl, tokenizedUrl, tokenlessUrl };
}

function extractCapsuleRouteEvidence(artifact) {
  const text = collectArtifactNetworkEvidenceText(artifact);
  const shareUrl =
    matchDecoded(text, /"shareUrl"\s*:\s*\{\s*"stringValue"\s*:\s*"([^"]+)"/i) ??
    matchDecoded(text, /https:\/\/staging\.inssa\.us\/capsule\/[^"'\s\\]+/i);
  const capsuleId =
    matchDecoded(text, /"capsuleId"\s*:\s*\{\s*"stringValue"\s*:\s*"([^"]+)"/i) ??
    extractCapsuleId(shareUrl ?? "") ??
    matchDecoded(text, /\/documents\/timeCapsules\/([^"\\/?&]+)/i);
  const token =
    matchDecoded(text, /"shareToken"\s*:\s*\{\s*"stringValue"\s*:\s*"([^"]+)"/i) ??
    extractShareToken(shareUrl ?? "");

  return { capsuleId, shareUrl, token };
}

function collectArtifactNetworkEvidenceText(artifact) {
  const pieces = [JSON.stringify(artifact.writesObserved ?? [])];
  for (const observation of artifact.writesObserved ?? []) {
    for (const value of [observation.requestUrl, observation.requestPostData, observation.responseBodySnippet]) {
      if (!value) continue;
      pieces.push(String(value));
      try {
        const params = new URLSearchParams(String(value));
        for (const [, payload] of params.entries()) {
          pieces.push(payload);
        }
      } catch {
        // Opaque network snippets still remain in raw form above.
      }
    }
  }

  return pieces.join("\n");
}

function matchDecoded(text, pattern) {
  const raw = String(text ?? "");
  const rawMatch = raw.match(pattern);
  if (rawMatch) return rawMatch[1] ?? rawMatch[0];
  try {
    const decoded = decodeURIComponent(raw);
    const decodedMatch = decoded.match(pattern);
    return decodedMatch ? decodedMatch[1] ?? decodedMatch[0] : null;
  } catch {
    return null;
  }
}

function classifyTokenBehavior(routeProbes) {
  const tokenizedVisible = Boolean(routeProbes.cleanTokenized?.contentVisible);
  const tokenlessVisible = Boolean(routeProbes.cleanTokenless?.contentVisible);
  if (tokenizedVisible && tokenlessVisible) return "public-by-id";
  if (tokenizedVisible && !tokenlessVisible) return "token-required";
  if (!tokenizedVisible && tokenlessVisible) return "token-optional";
  return "isolated";
}

function classifyCrossUserVisibility(probeSet) {
  const secondaryProbes = [
    probeSet.routeProbes.secondaryAuthenticatedDirect,
    probeSet.routeProbes.secondaryAuthenticatedTokenized,
    probeSet.routeProbes.secondaryAuthenticatedTokenless,
    ...probeSet.secondarySurfaces
  ].filter(Boolean);
  const visible = secondaryProbes.filter((probe) => probe.contentVisible);
  if (visible.some((probe) => /tokenless|direct/i.test(probe.label))) return "cross-user-visible";
  if (visible.some((probe) => /tokenized/i.test(probe.label))) return "expected-share-access";
  if (visible.length > 0) return "unexpected-indexing";
  return "isolated";
}

function classifyProbeVisibility(input) {
  const { bodyText, finalUrl, foundMessage, foundSubject, httpStatus } = input;
  if (foundMessage && foundSubject) return "fully-visible";
  if (foundMessage || foundSubject) return "partially-visible";
  if (/\/signin\/?$/i.test(new URL(finalUrl, "https://staging.inssa.us").pathname)) return "redirected";
  if (httpStatus && httpStatus >= 300 && httpStatus < 400) return "redirected";
  if (/not found|unavailable|not available|private|permission|unauthorized|forbidden|sign in|log in/i.test(bodyText)) return "blocked";
  return "hidden";
}

function classifyRevealLaterSecurity(visibleProbes, tokenBehavior, scheduleState) {
  if (scheduleState !== "pending") {
    return visibleProbes.length > 0 ? "reveal-schedule-unknown-with-visible-content" : "reveal-schedule-unknown";
  }

  if (visibleProbes.length === 0) return "reveal-protected";
  if (tokenBehavior === "public-by-id" || tokenBehavior === "token-optional") return "reveal-accessible-early";
  return "reveal-bypass-risk";
}

function classifyRisk(securityClassification, probeSet) {
  if (securityClassification === "reveal-protected") return "Informational";
  if (securityClassification === "reveal-schedule-unknown") return "Warning";
  if (probeSet.routeProbes.cleanTokenless?.contentVisible) return "High";
  if (probeSet.routeProbes.cleanTokenized?.contentVisible) return "Critical";
  return "Medium";
}

function classifyRevealScheduleState(artifact) {
  return getRevealSchedule(artifact)?.state ?? "unknown";
}

function getRevealSchedule(artifact) {
  const scheduledAtIso =
    artifact.revealLaterSchedule?.scheduledAtIso ??
    artifact.scheduledAtIso ??
    artifact.revealTimestampEvidence?.scheduledAtIso ??
    null;
  if (!scheduledAtIso) return null;
  const scheduledAtMs = Date.parse(scheduledAtIso);
  if (!Number.isFinite(scheduledAtMs)) return null;
  return {
    scheduledAtIso,
    scheduledAtMs,
    state: Date.now() < scheduledAtMs ? "pending" : "elapsed"
  };
}

function buildScheduleTiming(schedule) {
  const currentTimeIso = new Date().toISOString();
  if (!schedule) {
    return {
      currentTimeIso,
      scheduledAtIso: null,
      timeRemainingMs: null,
      state: "unknown"
    };
  }

  return {
    currentTimeIso,
    scheduledAtIso: schedule.scheduledAtIso,
    timeRemainingMs: schedule.scheduledAtMs - Date.now(),
    state: schedule.state
  };
}

async function maybeWaitForReveal(schedule) {
  if (!schedule) return { status: "not-waited", reason: "schedule unknown" };
  const remainingMs = schedule.scheduledAtMs - Date.now();
  if (remainingMs <= 0) return { status: "not-needed", reason: "scheduled time already elapsed" };
  const maxWaitMs = Number(process.env[WAIT_MAX_ENV] ?? "0");
  if (!Number.isFinite(maxWaitMs) || maxWaitMs <= 0 || remainingMs > maxWaitMs) {
    return { status: "not-waited", reason: `remaining ${remainingMs}ms exceeds ${WAIT_MAX_ENV || "default"}=${maxWaitMs}` };
  }

  await new Promise((resolve) => setTimeout(resolve, remainingMs + 1000));
  return { status: "waited", waitedMs: remainingMs + 1000 };
}

function writeOutputs(summary) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, "latest-reveal-later-security.json");
  const runOutputPath = path.join(OUTPUT_DIR, `${summary.lifecycle.runId}-reveal-later-security.json`);
  const reportPath = path.join(REPORT_DIR, "reveal-later-security.html");
  const accessControlReportPath = path.join(REPORT_DIR, "reveal-later-access-control.html");
  summary.outputPath = outputPath;
  summary.runOutputPath = runOutputPath;
  summary.reportPath = reportPath;
  summary.accessControlReportPath = accessControlReportPath;
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(runOutputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const html = renderHtml(summary);
  writeFileSync(reportPath, html, "utf8");
  writeFileSync(accessControlReportPath, html, "utf8");
}

function renderHtml(summary) {
  const routeRows = Object.values(summary.beforeRevealVisibility.routeProbes)
    .map((probe) => resultRow(probe.label, probe.visibilityState ?? (probe.contentVisible ? "content-visible" : "content-hidden"), probe.contentVisible ? "High" : "Informational", probe.finalUrl))
    .join("\n");
  const primaryRows = summary.beforeRevealVisibility.primarySurfaces
    .map((probe) => resultRow(probe.label, probe.visibilityState ?? (probe.contentVisible ? "content-visible" : "content-hidden"), probe.contentVisible ? "Medium" : "Informational", probe.finalUrl))
    .join("\n");
  const secondaryRows = summary.beforeRevealVisibility.secondarySurfaces
    .map((probe) => resultRow(probe.label, probe.visibilityState ?? (probe.contentVisible ? "content-visible" : "content-hidden"), probe.contentVisible ? "Medium" : "Informational", probe.finalUrl))
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>INSSA Reveal-Later Security</title>
<style>body{color:#172026;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45;margin:32px}h1,h2{color:#0f2e2e}code{background:#eef3f1;border-radius:4px;padding:2px 5px}table{border-collapse:collapse;margin:16px 0 28px;width:100%}th,td{border-bottom:1px solid #d8e3df;padding:8px;text-align:left;vertical-align:top}th{background:#eef6f2}</style></head>
<body><h1>INSSA Reveal-Later Security Campaign</h1>
<p><strong>Generated:</strong> ${escapeHtml(summary.createdAt)}</p>
<p><strong>Classification:</strong> <code>${escapeHtml(summary.securityClassification)}</code></p>
<p><strong>Risk:</strong> <code>${escapeHtml(summary.riskLevel)}</code></p>
<p><strong>Run ID:</strong> <code>${escapeHtml(summary.lifecycle.runId)}</code></p>
<p><strong>Subject:</strong> <code>${escapeHtml(summary.lifecycle.subject)}</code></p>
<p><strong>Reveal timestamp:</strong> <code>${escapeHtml(summary.lifecycle.revealLaterSchedule?.scheduledAtIso ?? "unknown")}</code></p>
<p><strong>Current time:</strong> <code>${escapeHtml(summary.scheduleTiming.before.currentTimeIso)}</code></p>
<p><strong>Time remaining:</strong> <code>${escapeHtml(String(summary.scheduleTiming.before.timeRemainingMs ?? "unknown"))}ms</code></p>
<p><strong>Token behavior:</strong> <code>${escapeHtml(summary.tokenBehavior)}</code></p>
<p><strong>Cross-user visibility:</strong> <code>${escapeHtml(summary.crossUserVisibility)}</code></p>
<h2>Route Probes</h2><table><tr><th>Probe</th><th>Result</th><th>Risk</th><th>Final URL</th></tr>${routeRows}</table>
<h2>Primary Authenticated Surfaces</h2><table><tr><th>Probe</th><th>Result</th><th>Risk</th><th>Final URL</th></tr>${primaryRows}</table>
<h2>Secondary Authenticated Surfaces</h2><table><tr><th>Probe</th><th>Result</th><th>Risk</th><th>Final URL</th></tr>${secondaryRows || "<tr><td colspan=\"4\">Secondary QA account not configured.</td></tr>"}</table>
<h2>After Reveal</h2><p>${escapeHtml(summary.afterRevealVisibility?.skipped ? summary.afterRevealVisibility.reason : "After-reveal probes were executed; see JSON for details.")}</p>
<h2>Cleanup</h2><p>${escapeHtml(summary.cleanupInstruction)}</p></body></html>\n`;
}

function resultRow(name, classification, risk, target) {
  return `<tr><td>${escapeHtml(name)}</td><td><code>${escapeHtml(classification)}</code></td><td>${escapeHtml(risk)}</td><td><code>${escapeHtml(target ?? "")}</code></td></tr>`;
}

function printSummary(summary) {
  console.log("\nINSSA reveal-later security campaign complete.");
  console.log(`- output: ${summary.outputPath}`);
  console.log(`- report: ${summary.accessControlReportPath}`);
  console.log(`- runId: ${summary.lifecycle.runId}`);
  console.log(`- subject: ${summary.lifecycle.subject}`);
  console.log(`- reveal timestamp: ${summary.lifecycle.revealLaterSchedule?.scheduledAtIso ?? "unknown"}`);
  console.log(`- current time: ${summary.scheduleTiming.before.currentTimeIso}`);
  console.log(`- time remaining ms: ${summary.scheduleTiming.before.timeRemainingMs ?? "unknown"}`);
  console.log(`- classification: ${summary.securityClassification}`);
  console.log(`- token behavior: ${summary.tokenBehavior}`);
  console.log(`- cross-user visibility: ${summary.crossUserVisibility}`);
  console.log(`- risk: ${summary.riskLevel}`);
  console.log(`- cleanup: ${summary.cleanupInstruction}`);
}

function skippedProbe(label, reason) {
  return {
    label,
    contentVisible: false,
    error: reason,
    finalUrl: null,
    foundMessage: false,
    foundSubject: false,
    httpStatus: null,
    targetUrl: null,
    visibleTextSample: ""
  };
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

function assertStagingUrl(url) {
  if (!url) return;
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to probe non-staging URL: ${redactUrl(url)}`);
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
    throw new Error(`${name} is required for the INSSA reveal-later security campaign.`);
  }
  return value.trim();
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
