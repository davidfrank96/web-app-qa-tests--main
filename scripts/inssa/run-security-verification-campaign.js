#!/usr/bin/env node

const { createHash } = require("crypto");
const { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("@playwright/test");

const ROOT = process.cwd();
const STAGING_HOSTNAME = "staging.inssa.us";
const DEFAULT_INSSA_URL = "https://staging.inssa.us";
const ENV_FILE = path.resolve(ROOT, ".env.inssa.live-staging");
const LIFECYCLE_ARTIFACT_DIR = path.resolve(ROOT, "lifecycle-artifacts");
const OUTPUT_DIR = path.resolve(ROOT, "security-campaigns", "verification");
const REPORT_DIR = path.resolve(ROOT, "reports", "security");
const NAVIGATION_TIMEOUT_MS = 25_000;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  loadLiveStagingEnv();
  const baseUrl = assertStagingEnvironment();
  const runId = `security-verification-${Date.now()}`;
  const generatedAt = new Date().toISOString();
  const artifacts = loadLifecycleArtifacts();
  const usableArtifacts = artifacts.filter(isUsableLifecycleArtifact);
  const revealLaterArtifacts = artifacts.filter(isRevealLaterArtifact);
  const mediaArtifacts = usableArtifacts.filter(isMediaArtifact);

  const tokenlessVerification = await verifyTokenlessCapsules(baseUrl, usableArtifacts);
  const mediaVerification = await verifyMediaAccess(mediaArtifacts);
  const revealLaterVerification = await verifyRevealLaterAccess(baseUrl, revealLaterArtifacts);
  const crossUserVerification = await verifyCrossUserVisibility(baseUrl, usableArtifacts);

  const summary = {
    campaign: "security-verification",
    generatedAt,
    environment: "staging",
    runId,
    sourceArtifactCount: artifacts.length,
    usableArtifactCount: usableArtifacts.length,
    verificationAreas: {
      tokenlessCapsules: summarizeArea(tokenlessVerification.results),
      mediaAccess: summarizeArea(mediaVerification.results),
      revealLaterAccess: summarizeArea(revealLaterVerification.results),
      crossUserVisibility: summarizeArea(crossUserVerification.results)
    },
    confirmedFindings: collectConfirmedFindings([
      ...tokenlessVerification.results,
      ...mediaVerification.results,
      ...revealLaterVerification.results,
      ...crossUserVerification.results
    ]),
    suspectedFindings: collectSuspectedFindings([
      ...tokenlessVerification.results,
      ...mediaVerification.results,
      ...revealLaterVerification.results,
      ...crossUserVerification.results
    ]),
    finalSecurityPosture: null,
    tokenlessVerification,
    mediaVerification,
    revealLaterVerification,
    crossUserVerification
  };
  summary.finalSecurityPosture = classifyFinalSecurityPosture(summary);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, "latest-security-verification.json");
  const reportPath = path.join(REPORT_DIR, "security-verification.html");
  summary.outputPath = outputPath;
  summary.reportPath = reportPath;

  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderHtml(summary), "utf8");

  printSummary(summary);
}

async function verifyTokenlessCapsules(baseUrl, artifacts) {
  const results = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const artifact of artifacts) {
      const urls = resolveCapsuleUrls(baseUrl, artifact);
      if (!urls.tokenizedUrl && !urls.tokenlessUrl) {
        results.push(baseResult(artifact, "tokenless-capsule", "skipped", "inaccessible", "No tokenized or tokenless capsule URL could be resolved."));
        continue;
      }

      const tokenizedProbe = urls.tokenizedUrl
        ? await probeCapsuleRoute(browser, urls.tokenizedUrl, artifact, "clean-tokenized")
        : null;
      const tokenlessProbe = urls.tokenlessUrl
        ? await probeCapsuleRoute(browser, urls.tokenlessUrl, artifact, "clean-tokenless")
        : null;
      const classification = classifyTokenlessAccess(tokenizedProbe, tokenlessProbe);
      results.push({
        ...baseResult(artifact, "tokenless-capsule", "completed", classification, describeTokenlessClassification(classification)),
        severity: tokenlessSeverity(classification),
        probes: compactObject({ tokenizedProbe, tokenlessProbe }),
        tokenizedUrl: tokenizedProbe ? redactUrl(urls.tokenizedUrl) : null,
        tokenlessUrl: tokenlessProbe ? redactUrl(urls.tokenlessUrl) : null
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return {
    classificationCounts: countBy(results, (result) => result.classification),
    results
  };
}

async function verifyMediaAccess(artifacts) {
  const results = [];
  for (const artifact of artifacts) {
    const mediaUrls = extractMediaUrls(artifact);
    if (mediaUrls.length === 0) {
      results.push({
        ...baseResult(artifact, "media-access", "skipped", "media-url-not-observed", "No storage media URL was present in the lifecycle artifact."),
        severity: "warning",
        probes: []
      });
      continue;
    }

    const probes = [];
    for (const url of mediaUrls.slice(0, 8)) {
      const tokenizedProbe = await probeMediaUrl(url, "tokenized-media-url");
      probes.push(tokenizedProbe);
      const tokenlessUrl = buildTokenlessUrl(url);
      if (tokenlessUrl && tokenlessUrl !== url) {
        probes.push(await probeMediaUrl(tokenlessUrl, "tokenless-media-url"));
      }
    }

    const classification = classifyMediaAccess(probes);
    results.push({
      ...baseResult(artifact, "media-access", "completed", classification, describeMediaClassification(classification)),
      severity: mediaSeverity(classification),
      mediaUrlCount: mediaUrls.length,
      probes
    });
  }

  return {
    classificationCounts: countBy(results, (result) => result.classification),
    results
  };
}

async function verifyRevealLaterAccess(baseUrl, artifacts) {
  const results = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const artifact of artifacts) {
      const scheduleState = classifyRevealScheduleState(artifact);
      const urls = resolveCapsuleUrls(baseUrl, artifact);
      const authStorageStatePath = getPrimaryAuthStorageStatePath(baseUrl);

      if (scheduleState !== "pending") {
        results.push({
          ...baseResult(
            artifact,
            "reveal-later-access",
            "skipped",
            scheduleState === "elapsed" ? "reveal-window-elapsed" : "reveal-schedule-unknown",
            scheduleState === "elapsed"
              ? "Reveal time has elapsed; pre-reveal access protection cannot be verified from this artifact."
              : "Reveal-later artifact does not include a usable future schedule timestamp."
          ),
          scheduledAtIso: artifact.revealLaterSchedule?.scheduledAtIso ?? null,
          severity: "warning",
          probes: []
        });
        continue;
      }

      const tokenizedProbe = urls.tokenizedUrl
        ? await probeCapsuleRoute(browser, urls.tokenizedUrl, artifact, "reveal-later-clean-tokenized")
        : null;
      const tokenlessProbe = urls.tokenlessUrl
        ? await probeCapsuleRoute(browser, urls.tokenlessUrl, artifact, "reveal-later-clean-tokenless")
        : null;
      const authenticatedProbe =
        authStorageStatePath && existsSync(authStorageStatePath) && urls.tokenizedUrl
          ? await probeCapsuleRoute(browser, urls.tokenizedUrl, artifact, "reveal-later-authenticated", authStorageStatePath)
          : null;
      const classification = classifyRevealLaterAccess([tokenizedProbe, tokenlessProbe, authenticatedProbe].filter(Boolean));

      results.push({
        ...baseResult(artifact, "reveal-later-access", "completed", classification, describeRevealLaterClassification(classification)),
        scheduledAtIso: artifact.revealLaterSchedule?.scheduledAtIso ?? null,
        severity: revealLaterSeverity(classification),
        probes: compactObject({ tokenizedProbe, tokenlessProbe, authenticatedProbe })
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return {
    classificationCounts: countBy(results, (result) => result.classification),
    results
  };
}

async function verifyCrossUserVisibility(baseUrl, artifacts) {
  const secondary = getSecondaryAuthStorageStatePath(baseUrl);
  if (!secondary.email || !secondary.storageStatePath || !existsSync(secondary.storageStatePath)) {
    return {
      classificationCounts: { skipped: artifacts.length },
      results: artifacts.map((artifact) => ({
        ...baseResult(
          artifact,
          "cross-user-visibility",
          "skipped",
          "cross-user-not-configured",
          "Secondary QA user storage state was not configured or not present; cross-user retrieval was not attempted."
        ),
        severity: "informational",
        secondaryUserConfigured: Boolean(secondary.email),
        secondaryStorageStatePathPresent: Boolean(secondary.storageStatePath && existsSync(secondary.storageStatePath))
      }))
    };
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const artifact of artifacts) {
      const urls = resolveCapsuleUrls(baseUrl, artifact);
      if (!urls.tokenizedUrl) {
        results.push(baseResult(artifact, "cross-user-visibility", "skipped", "inaccessible", "No tokenized capsule URL could be resolved."));
        continue;
      }

      const tokenizedProbe = await probeCapsuleRoute(browser, urls.tokenizedUrl, artifact, "secondary-user-tokenized", secondary.storageStatePath);
      const tokenlessProbe = urls.tokenlessUrl
        ? await probeCapsuleRoute(browser, urls.tokenlessUrl, artifact, "secondary-user-tokenless", secondary.storageStatePath)
        : null;
      const classification = classifyCrossUserVisibility(tokenizedProbe, tokenlessProbe);
      results.push({
        ...baseResult(artifact, "cross-user-visibility", "completed", classification, describeCrossUserClassification(classification)),
        severity: crossUserSeverity(classification),
        secondaryEmail: maskEmail(secondary.email),
        probes: compactObject({ tokenizedProbe, tokenlessProbe })
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return {
    classificationCounts: countBy(results, (result) => result.classification),
    results
  };
}

async function probeCapsuleRoute(browser, url, artifact, label, storageStatePath = null) {
  assertAllowedProbeUrl(url);
  const context = await browser.newContext({
    baseURL: DEFAULT_INSSA_URL,
    storageState: storageStatePath ?? { cookies: [], origins: [] }
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(750);
    const visibleText = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
    const buttons = await page
      .getByRole("button")
      .evaluateAll((entries) => entries.map((entry) => (entry.textContent ?? "").trim()).filter(Boolean))
      .catch(() => []);
    return {
      accessMode: label,
      authRedirected: isAuthRoute(page.url()),
      contentVisible: visibleText.includes(normalizeText(artifact.subject ?? "")) || visibleText.includes(normalizeText(artifact.message ?? "")),
      error: null,
      finalUrl: redactUrl(page.url()),
      foundMessage: visibleText.includes(normalizeText(artifact.message ?? "")),
      foundSubject: visibleText.includes(normalizeText(artifact.subject ?? "")),
      httpStatus: response?.status() ?? null,
      targetUrl: redactUrl(url),
      tokenPresent: new URL(url).searchParams.has("token"),
      visibleButtons: buttons.slice(0, 12),
      visibleTextSample: redactText(visibleText.slice(0, 1_000))
    };
  } catch (error) {
    return {
      accessMode: label,
      authRedirected: false,
      contentVisible: false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: redactUrl(page.url()),
      foundMessage: false,
      foundSubject: false,
      httpStatus: null,
      targetUrl: redactUrl(url),
      tokenPresent: new URL(url).searchParams.has("token"),
      visibleButtons: [],
      visibleTextSample: ""
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function probeMediaUrl(url, accessMode) {
  assertAllowedMediaUrl(url);
  const tokenless = !new URL(url).searchParams.has("token");
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    const contentType = response.headers.get("content-type");
    const contentLength = response.headers.get("content-length");
    const accessible = response.status >= 200 && response.status < 300;
    const accessibleMedia = accessible && /^(image|video)\//i.test(contentType ?? "");
    return {
      accessMode,
      accessible,
      accessibleMedia,
      blocked: [401, 403, 404].includes(response.status),
      contentLength,
      contentType,
      durationMs: Date.now() - startedAt,
      error: null,
      expiredOrUnavailable: [400, 401, 403, 404, 410].includes(response.status),
      httpStatus: response.status,
      tokenPresent: !tokenless,
      url: redactUrl(url)
    };
  } catch (error) {
    return {
      accessMode,
      accessible: false,
      accessibleMedia: false,
      blocked: false,
      contentLength: null,
      contentType: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      expiredOrUnavailable: false,
      httpStatus: null,
      tokenPresent: !tokenless,
      url: redactUrl(url)
    };
  }
}

function loadLiveStagingEnv() {
  if (existsSync(ENV_FILE)) {
    require("dotenv").config({ path: ENV_FILE, quiet: true });
  }
}

function assertStagingEnvironment() {
  const configuredUrl = process.env.INSSA_URL || DEFAULT_INSSA_URL;
  const parsed = new URL(configuredUrl);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Security verification is hard-blocked outside ${STAGING_HOSTNAME}. Current host: ${parsed.hostname}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function loadLifecycleArtifacts() {
  if (!existsSync(LIFECYCLE_ARTIFACT_DIR)) return [];
  return readdirSync(LIFECYCLE_ARTIFACT_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const filePath = path.join(LIFECYCLE_ARTIFACT_DIR, fileName);
      const artifact = readJson(filePath);
      return artifact ? { ...artifact, artifactPath: filePath, artifactMtimeMs: statSync(filePath).mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));
}

function isUsableLifecycleArtifact(artifact) {
  return (
    artifact.environment === "staging" &&
    typeof artifact.runId === "string" &&
    typeof artifact.subject === "string" &&
    typeof artifact.message === "string" &&
    artifact.observedCreateSuccess === true &&
    (typeof artifact.finalShareLink === "string" || typeof artifact.possibleFinalCapsuleId === "string")
  );
}

function isMediaArtifact(artifact) {
  return /QA_LIVE_(?:MEDIA|VIDEO)_CAPSULE_/i.test(artifact.subject ?? "") || extractMediaUrls(artifact).length > 0;
}

function isRevealLaterArtifact(artifact) {
  return /QA_REVEAL_LATER_CAPSULE_/i.test(artifact.subject ?? "") || Boolean(artifact.revealLaterSchedule);
}

function resolveCapsuleUrls(baseUrl, artifact) {
  const token = artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : "";
  const tokenizedUrl =
    artifact.finalShareLink ||
    artifact.finalShareEvidence?.finalShareLink ||
    (artifact.possibleFinalCapsuleId ? `${baseUrl}/capsule/${artifact.possibleFinalCapsuleId}${token}` : null);
  const tokenlessUrl = tokenizedUrl ? buildTokenlessUrl(tokenizedUrl) : artifact.possibleFinalCapsuleId ? `${baseUrl}/capsule/${artifact.possibleFinalCapsuleId}` : null;
  return {
    tokenizedUrl,
    tokenlessUrl
  };
}

function classifyTokenlessAccess(tokenizedProbe, tokenlessProbe) {
  const tokenizedVisible = Boolean(tokenizedProbe?.contentVisible);
  const tokenlessVisible = Boolean(tokenlessProbe?.contentVisible);
  if (tokenizedVisible && tokenlessVisible) return "public-by-id";
  if (tokenizedVisible && !tokenlessVisible) return "token-required";
  if (!tokenizedVisible && tokenlessVisible) return "token-optional";
  return "inaccessible";
}

function classifyMediaAccess(probes) {
  const tokenlessAccessible = probes.some((probe) => !probe.tokenPresent && probe.accessibleMedia);
  const tokenizedAccessible = probes.some((probe) => probe.tokenPresent && probe.accessibleMedia);
  const tokenizedExpired = probes.some((probe) => probe.tokenPresent && probe.expiredOrUnavailable);
  if (tokenlessAccessible) return "media-publicly-accessible";
  if (tokenizedAccessible) return "media-token-protected";
  if (tokenizedExpired) return "media-url-expired-or-unavailable";
  return "media-authenticated-only";
}

function classifyRevealLaterAccess(probes) {
  const visibleProbes = probes.filter((probe) => probe.contentVisible);
  if (visibleProbes.length === 0) return "reveal-protected";
  if (visibleProbes.some((probe) => probe.accessMode.includes("tokenless") || probe.accessMode.includes("clean"))) {
    return "reveal-accessible-early";
  }
  return "reveal-bypass-risk";
}

function classifyCrossUserVisibility(tokenizedProbe, tokenlessProbe) {
  if (tokenlessProbe?.contentVisible) return "unauthorized-visible";
  if (tokenizedProbe?.contentVisible) return "shared";
  return "isolated";
}

function baseResult(artifact, area, status, classification, summary) {
  return {
    area,
    artifactPath: path.relative(ROOT, artifact.artifactPath),
    classification,
    createdAt: artifact.createdAt ?? null,
    possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? null,
    runId: artifact.runId ?? null,
    status,
    subject: artifact.subject ?? null,
    summary
  };
}

function extractMediaUrls(value, output = []) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && isStorageMediaUrl(value) && !hasRedactedToken(value)) {
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

function isStorageMediaUrl(url) {
  return /firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(url) && /\/o\//i.test(url);
}

function hasRedactedToken(url) {
  return /token=(?:%5Bredacted%5D|\[redacted\]|<redacted>)/i.test(url);
}

function classifyRevealScheduleState(artifact) {
  const scheduledAtIso = artifact.revealLaterSchedule?.scheduledAtIso;
  if (!scheduledAtIso) return "unknown";
  const scheduledAtMs = Date.parse(scheduledAtIso);
  if (!Number.isFinite(scheduledAtMs)) return "unknown";
  return Date.now() < scheduledAtMs ? "pending" : "elapsed";
}

function getPrimaryAuthStorageStatePath(baseUrl) {
  const email = process.env.INSSA_TEST_EMAIL;
  return email ? getStorageStatePath(baseUrl, email) : null;
}

function getSecondaryAuthStorageStatePath(baseUrl) {
  const email = process.env.INSSA_SECONDARY_TEST_EMAIL || process.env.INSSA_TEST_EMAIL_B || process.env.INSSA_CROSS_USER_TEST_EMAIL;
  return {
    email,
    storageStatePath: email ? getStorageStatePath(baseUrl, email) : null
  };
}

function getStorageStatePath(baseUrl, email) {
  const key = createHash("sha256").update(`${baseUrl}\n${email}`).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), "web-app-qa-tests", "inssa-auth", key, "storage-state.json");
}

function assertAllowedProbeUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to probe non-staging capsule URL: ${redactUrl(url)}`);
  }
}

function assertAllowedMediaUrl(url) {
  const parsed = new URL(url);
  if (!/firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(parsed.hostname)) {
    throw new Error(`Refusing to probe non-storage media URL: ${redactUrl(url)}`);
  }
}

function buildTokenlessUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("token");
  return parsed.toString();
}

function tokenlessSeverity(classification) {
  if (classification === "public-by-id" || classification === "token-optional") return "high";
  if (classification === "inaccessible") return "critical";
  return "informational";
}

function mediaSeverity(classification) {
  if (classification === "media-publicly-accessible") return "high";
  if (classification === "media-url-expired-or-unavailable") return "medium";
  return "informational";
}

function revealLaterSeverity(classification) {
  if (classification === "reveal-accessible-early") return "critical";
  if (classification === "reveal-bypass-risk") return "high";
  return "informational";
}

function crossUserSeverity(classification) {
  if (classification === "unauthorized-visible") return "high";
  return "informational";
}

function describeTokenlessClassification(classification) {
  return {
    "token-required": "Tokenized retrieval exposes exact QA content; tokenless capsule-by-id does not.",
    "token-optional": "Tokenless retrieval exposed exact QA content while tokenized retrieval did not prove content.",
    "public-by-id": "Both tokenized and tokenless capsule-by-id retrieval expose exact QA content.",
    inaccessible: "Neither tokenized nor tokenless route exposed exact QA content."
  }[classification];
}

function describeMediaClassification(classification) {
  return {
    "media-token-protected": "Tokenized media URL is accessible, but tokenless media URL is not.",
    "media-authenticated-only": "Unauthenticated media URL probes did not retrieve media content.",
    "media-publicly-accessible": "Media content is retrievable without its token.",
    "media-url-expired-or-unavailable": "Tokenized media URL appears expired or unavailable."
  }[classification];
}

function describeRevealLaterClassification(classification) {
  return {
    "reveal-protected": "Pre-reveal probes did not expose exact QA content.",
    "reveal-bypass-risk": "Authenticated pre-reveal probe exposed exact QA content.",
    "reveal-accessible-early": "Clean/tokenless pre-reveal probe exposed exact QA content."
  }[classification];
}

function describeCrossUserClassification(classification) {
  return {
    isolated: "Secondary QA user did not retrieve exact QA content.",
    shared: "Secondary QA user retrieved exact QA content through a tokenized share link.",
    "unauthorized-visible": "Secondary QA user retrieved exact QA content through tokenless capsule-by-id."
  }[classification];
}

function summarizeArea(results) {
  return {
    total: results.length,
    byClassification: countBy(results, (result) => result.classification),
    bySeverity: countBy(results, (result) => result.severity ?? "unknown"),
    byStatus: countBy(results, (result) => result.status)
  };
}

function collectConfirmedFindings(results) {
  return results
    .filter((result) =>
      [
        "public-by-id",
        "token-optional",
        "media-publicly-accessible",
        "reveal-accessible-early",
        "reveal-bypass-risk",
        "unauthorized-visible"
      ].includes(result.classification)
    )
    .map((result) => ({
      area: result.area,
      classification: result.classification,
      runId: result.runId,
      severity: result.severity,
      subject: result.subject,
      summary: result.summary
    }));
}

function collectSuspectedFindings(results) {
  return results
    .filter((result) =>
      [
        "inaccessible",
        "media-url-expired-or-unavailable",
        "media-url-not-observed",
        "reveal-window-elapsed",
        "reveal-schedule-unknown",
        "cross-user-not-configured"
      ].includes(result.classification)
    )
    .map((result) => ({
      area: result.area,
      classification: result.classification,
      runId: result.runId,
      severity: result.severity,
      subject: result.subject,
      summary: result.summary
    }));
}

function classifyFinalSecurityPosture(summary) {
  const confirmed = summary.confirmedFindings;
  const critical = confirmed.filter((entry) => entry.severity === "critical");
  const high = confirmed.filter((entry) => entry.severity === "high");
  if (critical.length > 0) {
    return "critical-confirmed-findings";
  }
  if (high.length > 0) {
    return "high-risk-confirmed-findings";
  }
  if (summary.suspectedFindings.length > 0) {
    return "verification-complete-with-unverified-areas";
  }
  return "verification-complete-no-high-risk-findings";
}

function renderHtml(summary) {
  const allResults = [
    ...summary.tokenlessVerification.results,
    ...summary.mediaVerification.results,
    ...summary.revealLaterVerification.results,
    ...summary.crossUserVerification.results
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>INSSA Security Verification Campaign</title>
  <style>
    body { color: #172026; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; margin: 32px; }
    h1, h2 { color: #0f2e2e; }
    code { background: #eef3f1; border-radius: 4px; padding: 2px 5px; }
    table { border-collapse: collapse; margin: 16px 0 28px; width: 100%; }
    th, td { border-bottom: 1px solid #d8e3df; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #eef6f2; }
    .critical { color: #a40000; font-weight: 700; }
    .high { color: #b54708; font-weight: 700; }
    .medium, .warning { color: #8a5a00; font-weight: 700; }
    .informational { color: #23615b; }
  </style>
</head>
<body>
  <h1>INSSA Security Verification Campaign</h1>
  <p><strong>Generated:</strong> ${escapeHtml(summary.generatedAt)}</p>
  <p><strong>Environment:</strong> ${escapeHtml(summary.environment)}</p>
  <p><strong>Final security posture:</strong> <code>${escapeHtml(summary.finalSecurityPosture)}</code></p>
  <h2>Executive Summary</h2>
  <table>
    <tr><th>Area</th><th>Total</th><th>Classifications</th><th>Severities</th></tr>
    ${Object.entries(summary.verificationAreas)
      .map(([area, entry]) => `<tr><td>${escapeHtml(area)}</td><td>${entry.total}</td><td><code>${escapeHtml(JSON.stringify(entry.byClassification))}</code></td><td><code>${escapeHtml(JSON.stringify(entry.bySeverity))}</code></td></tr>`)
      .join("\n")}
  </table>
  <h2>Confirmed Findings</h2>
  ${renderFindingList(summary.confirmedFindings)}
  <h2>Suspected Or Skipped Findings</h2>
  ${renderFindingList(summary.suspectedFindings)}
  <h2>Verification Results</h2>
  <table>
    <tr><th>Area</th><th>Run ID</th><th>Classification</th><th>Severity</th><th>Status</th><th>Summary</th></tr>
    ${allResults
      .map((result) => `<tr><td>${escapeHtml(result.area)}</td><td><code>${escapeHtml(result.runId ?? "unknown")}</code></td><td><code>${escapeHtml(result.classification)}</code></td><td class="${escapeHtml(result.severity ?? "")}">${escapeHtml(result.severity ?? "unknown")}</td><td>${escapeHtml(result.status)}</td><td>${escapeHtml(result.summary)}</td></tr>`)
      .join("\n")}
  </table>
  <h2>Evidence Policy</h2>
  <p>This report contains metadata and classifications only. Screenshots, videos, and traces are not embedded or uploaded by this verification campaign.</p>
</body>
</html>
`;
}

function renderFindingList(findings) {
  if (findings.length === 0) return "<p>No findings in this category.</p>";
  return `<table><tr><th>Area</th><th>Run ID</th><th>Classification</th><th>Severity</th><th>Summary</th></tr>${findings
    .map((finding) => `<tr><td>${escapeHtml(finding.area)}</td><td><code>${escapeHtml(finding.runId ?? "unknown")}</code></td><td><code>${escapeHtml(finding.classification)}</code></td><td class="${escapeHtml(finding.severity ?? "")}">${escapeHtml(finding.severity ?? "unknown")}</td><td>${escapeHtml(finding.summary)}</td></tr>`)
    .join("\n")}</table>`;
}

function printSummary(summary) {
  console.log("\nINSSA security verification campaign complete.");
  console.log(`- output: ${summary.outputPath}`);
  console.log(`- report: ${summary.reportPath}`);
  console.log(`- source artifacts: ${summary.sourceArtifactCount}`);
  console.log(`- usable artifacts: ${summary.usableArtifactCount}`);
  console.log(`- confirmed findings: ${summary.confirmedFindings.length}`);
  console.log(`- suspected/skipped findings: ${summary.suspectedFindings.length}`);
  console.log(`- final posture: ${summary.finalSecurityPosture}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function countBy(values, select) {
  const counts = {};
  for (const value of values) {
    const key = select(value) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function redactUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    for (const key of ["token", "access_token", "id_token", "refresh_token", "auth", "code"]) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
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
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return "[redacted-email]";
  return `${local[0]}***@${domain}`;
}

function isAuthRoute(candidate) {
  try {
    const pathname = new URL(candidate).pathname;
    return /^\/(?:sign-in|signin|login)(?:\/)?$|^\/(?:auth|onboarding|onboard|start)(?:\/|$)/i.test(pathname);
  } catch {
    return /\/(?:sign-in|signin|login|auth|onboarding|onboard|start)(?:\/|$)/i.test(candidate);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printUsage() {
  console.log(`
Usage:
  node scripts/inssa/run-security-verification-campaign.js

Outputs:
  security-campaigns/verification/latest-security-verification.json
  reports/security/security-verification.html

Optional cross-user env:
  INSSA_SECONDARY_TEST_EMAIL

The secondary user must already have an auth storage state generated in the standard INSSA auth cache.
`);
}
