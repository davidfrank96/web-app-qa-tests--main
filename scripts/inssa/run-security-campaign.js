#!/usr/bin/env node

const { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("@playwright/test");
const { renderSecurityReport } = require("./render-campaign-report");

const STAGING_HOSTNAME = "staging.inssa.us";
const PROJECT = "inssa-chrome";
const ARTIFACT_DIR = path.resolve(process.cwd(), "lifecycle-artifacts");
const SECURITY_RESULT_DIR = path.resolve(process.cwd(), "security-campaigns");
const PHASE_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
const ENV_FILE = path.resolve(process.cwd(), ".env.inssa.live-staging");
const OWASP_SECURITY_SPEC = "tests/inssa/security/owasp-top10.spec.ts";
const DISCOVERY_SPEC = "tests/inssa/live-capsule-authenticated-discovery.spec.ts";
const PUBLIC_SHARE_SPEC = "tests/inssa/live-capsule-public-share-lifecycle.spec.ts";
const NAVIGATION_TIMEOUT_MS = 25_000;

const LIFECYCLE_TARGETS = [
  {
    classification: "text",
    label: "text",
    subjectPrefix: "QA_LIVE_CAPSULE_"
  },
  {
    classification: "media",
    label: "media",
    subjectPrefix: "QA_LIVE_MEDIA_CAPSULE_"
  },
  {
    classification: "video",
    label: "video",
    subjectPrefix: "QA_LIVE_VIDEO_CAPSULE_"
  }
];

const REVEAL_LATER_TARGET = {
  classification: "reveal-later",
  label: "reveal-later",
  subjectPrefix: "QA_REVEAL_LATER_CAPSULE_"
};

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
  const configuredUrl = assertStagingEnvironment();
  const summary = createBaseSummary(configuredUrl);
  const owaspSpecResult = await runPlaywrightSpec(OWASP_SECURITY_SPEC, process.env);
  summary.owaspTop10Command = summarizeCommand(owaspSpecResult);
  if (owaspSpecResult.code !== 0) {
    summary.findings.push({
      lifecycleType: "owasp-top10-baseline",
      riskLevel: "critical",
      securityClassifications: [],
      status: "failed",
      summary:
        "OWASP Top 10 baseline spec failed. Inspect security-campaigns/*.json and the Playwright report for confirmed critical findings or environment errors."
    });
    addRisk(summary, "critical");
  }

  for (const target of LIFECYCLE_TARGETS) {
    const artifactMatch = findLatestArtifactBySubjectPrefix(target.subjectPrefix);
    if (!artifactMatch) {
      summary.findings.push({
        lifecycleType: target.label,
        riskLevel: "warning",
        securityClassifications: [],
        status: "skipped",
        summary: `No finalized ${target.label} lifecycle artifact was found. Run npm run test:inssa:campaign:${target.label} first.`
      });
      summary.warnings.push(`missing ${target.label} lifecycle artifact`);
      continue;
    }

    const finding = await runLifecycleSecurityChecks(target, artifactMatch);
    summary.findings.push(finding);
    mergeSecurityClassifications(summary, finding.securityClassifications);
    addRisk(summary, finding.riskLevel);
  }

  const revealLaterMatch = findLatestArtifactBySubjectPrefix(REVEAL_LATER_TARGET.subjectPrefix);
  const revealLaterFinding = revealLaterMatch
    ? await probeRevealLaterProtection(configuredUrl, revealLaterMatch)
    : {
        lifecycleType: REVEAL_LATER_TARGET.label,
        riskLevel: "warning",
        securityClassifications: [],
        status: "skipped",
        summary:
          "No finalized reveal-later lifecycle artifact was found. Run npm run test:inssa:campaign:reveal-later or npm run test:inssa:reveal-later first."
      };
  summary.findings.push(revealLaterFinding);
  mergeSecurityClassifications(summary, revealLaterFinding.securityClassifications);
  addRisk(summary, revealLaterFinding.riskLevel);

  summary.status = summary.findings.some((finding) => finding.status === "failed" || finding.riskLevel === "critical")
    ? "failed"
    : summary.findings.some((finding) => finding.riskLevel === "high-risk" || finding.riskLevel === "warning")
      ? "passed-with-findings"
      : "passed";
  summary.validatedAt = new Date().toISOString();
  writeSecuritySummary(summary);
  printSecuritySummary(summary);

  if (summary.status === "failed") {
    process.exitCode = 1;
  }
}

async function runLifecycleSecurityChecks(target, artifactMatch) {
  const artifact = artifactMatch.artifact;
  console.log(`\nSECURITY ${target.label}: ${artifactMatch.path}`);
  const downstreamEnv = {
    ...process.env,
    INSSA_LIVE_CAPSULE_ARTIFACT_PATH: artifactMatch.path,
    INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT: "0"
  };

  const publicShareResult = await runPlaywrightSpec(PUBLIC_SHARE_SPEC, downstreamEnv);
  const publicShareArtifact = readPhaseArtifact(`${artifact.runId}-public-share-lifecycle.json`);
  const discoveryResult = await runPlaywrightSpec(DISCOVERY_SPEC, downstreamEnv);
  const discoveryArtifact = readPhaseArtifact(`${artifact.runId}-authenticated-discovery.json`);
  const tokenFinding = classifyTokenAccess(publicShareArtifact?.artifact ?? null);
  const visibilityFinding = classifyAuthenticatedVisibility(discoveryArtifact?.artifact ?? null);
  const mediaAclFinding =
    target.label === "media" || target.label === "video" ? await classifyMediaAcl(target.label, artifact) : null;
  const securityClassifications = uniqueStrings([
    ...tokenFinding.classifications,
    ...visibilityFinding.classifications,
    ...(mediaAclFinding?.classifications ?? [])
  ]);
  const riskLevel = maxRisk([
    publicShareResult.code === 0 ? "info" : "critical",
    discoveryResult.code === 0 ? "info" : "critical",
    tokenFinding.riskLevel,
    visibilityFinding.riskLevel,
    mediaAclFinding?.riskLevel ?? "info"
  ]);

  return {
    artifactPath: artifactMatch.path,
    authenticatedVisibility: visibilityFinding,
    cleanupInstruction: artifact.cleanupInstruction ?? null,
    discoveryArtifactPath: discoveryArtifact?.path ?? null,
    discoveryCommand: summarizeCommand(discoveryResult),
    finalShareLink: artifact.finalShareLink ?? null,
    lifecycleType: target.label,
    mediaAcl: mediaAclFinding,
    possibleFinalCapsuleId: artifact.possibleFinalCapsuleId ?? null,
    publicShareArtifactPath: publicShareArtifact?.path ?? null,
    publicShareCommand: summarizeCommand(publicShareResult),
    riskLevel,
    runId: artifact.runId,
    securityClassifications,
    status: publicShareResult.code === 0 && discoveryResult.code === 0 ? "passed" : "failed",
    subject: artifact.subject,
    summary: buildLifecycleFindingSummary(tokenFinding, visibilityFinding, mediaAclFinding),
    tokenBehavior: tokenFinding
  };
}

function classifyTokenAccess(publicShareArtifact) {
  if (!publicShareArtifact) {
    return {
      classifications: [],
      riskLevel: "critical",
      summary: "Public-share artifact was not produced.",
      tokenizedAccess: false,
      tokenlessAccessClassification: "unknown"
    };
  }

  const tokenizedAccess = Boolean(
    publicShareArtifact.cleanAccessVisible &&
      publicShareArtifact.loggedOutAccessVisible &&
      publicShareArtifact.probes?.some((probe) => probe.accessMode === "authenticated" && probe.foundSubject && probe.foundMessage)
  );
  const tokenlessClassification = publicShareArtifact.tokenlessAccessClassification ?? "not-probed";
  const tokenlessVisible = tokenlessClassification === "content-visible";
  const classifications = [];

  if (tokenlessVisible) {
    classifications.push("token-optional", "public-by-id");
  } else if (tokenizedAccess) {
    classifications.push("token-required", "share-link-only");
  }

  return {
    classifications,
    cleanAccessVisible: Boolean(publicShareArtifact.cleanAccessVisible),
    loggedOutAccessVisible: Boolean(publicShareArtifact.loggedOutAccessVisible),
    riskLevel: tokenlessVisible ? "high-risk" : tokenizedAccess ? "info" : "critical",
    summary: tokenlessVisible
      ? "Tokenized share retrieval works, but tokenless /capsule/<id> exposes exact QA content."
      : tokenizedAccess
        ? "Tokenized share retrieval works and tokenless exact content was not observed."
        : "Tokenized share retrieval did not prove exact QA content.",
    tokenizedAccess,
    tokenlessAccessClassification: tokenlessClassification
  };
}

function classifyAuthenticatedVisibility(discoveryArtifact) {
  if (!discoveryArtifact) {
    return {
      classifications: [],
      riskLevel: "critical",
      summary: "Authenticated discovery artifact was not produced."
    };
  }

  const classifications = [];
  if (discoveryArtifact.authenticatedSurfaceIndexed) {
    classifications.push("authenticated-only");
  }
  if (discoveryArtifact.authenticatedSurfaceUndiscoverable) {
    classifications.push("share-link-only");
  }
  if (discoveryArtifact.delayedIndexingSuspected) {
    classifications.push("delayed-indexing");
  }

  return {
    authenticatedDirectRetrieval: Boolean(discoveryArtifact.authenticatedDirectRetrieval),
    authenticatedSurfaceIndexed: Boolean(discoveryArtifact.authenticatedSurfaceIndexed),
    authenticatedSurfaceUndiscoverable: Boolean(discoveryArtifact.authenticatedSurfaceUndiscoverable),
    classifications,
    lifecycleVisibilityClassification: discoveryArtifact.lifecycleVisibilityClassification ?? null,
    riskLevel: discoveryArtifact.hardFailure ? "critical" : "info",
    summary: discoveryArtifact.authenticatedSurfaceUndiscoverable
      ? "Authenticated direct retrieval works, but feed/search/messages/profile do not expose the capsule."
      : `Authenticated visibility classification: ${discoveryArtifact.lifecycleVisibilityClassification ?? "unknown"}.`
  };
}

async function classifyMediaAcl(lifecycleType, artifact) {
  const mediaUrls = extractStorageMediaUrls(artifact);
  if (mediaUrls.length === 0) {
    return {
      classifications: [],
      lifecycleType,
      probes: [],
      riskLevel: "warning",
      summary: "No Firebase Storage media URLs were present in the lifecycle artifact."
    };
  }

  const probes = [];
  for (const url of mediaUrls.slice(0, 6)) {
    const rawProbe = await probeHttpUrl(url);
    probes.push(rawProbe);
    const tokenlessUrl = buildTokenlessMediaUrl(url);
    if (tokenlessUrl && tokenlessUrl !== url) {
      probes.push(await probeHttpUrl(tokenlessUrl));
    }
  }

  const tokenlessMediaAccessible = probes.some((probe) => !probe.tokenPresent && probe.accessibleMedia);
  const tokenizedMediaAccessible = probes.some((probe) => probe.tokenPresent && probe.accessibleMedia);
  const classifications = tokenlessMediaAccessible
    ? ["media-publicly-accessible"]
    : tokenizedMediaAccessible || probes.some((probe) => !probe.tokenPresent && probe.blocked)
      ? ["media-token-protected"]
      : [];

  return {
    classifications,
    lifecycleType,
    probes,
    riskLevel: tokenlessMediaAccessible ? "high-risk" : classifications.length > 0 ? "info" : "warning",
    summary: tokenlessMediaAccessible
      ? "At least one uploaded media URL was accessible without its token."
      : "Uploaded media URLs were not observed as tokenless-accessible from the QA artifact URLs."
  };
}

async function probeRevealLaterProtection(configuredUrl, artifactMatch) {
  const artifact = artifactMatch.artifact;
  const scheduleState = classifyRevealScheduleState(artifact);
  if (scheduleState !== "pending") {
    return {
      artifactPath: artifactMatch.path,
      cleanupInstruction: artifact.cleanupInstruction ?? null,
      finalShareLink: artifact.finalShareLink ?? null,
      lifecycleType: "reveal-later",
      probes: [],
      riskLevel: "warning",
      runId: artifact.runId,
      scheduledAtIso: artifact.revealLaterSchedule?.scheduledAtIso ?? null,
      securityClassifications: [],
      status: "skipped",
      subject: artifact.subject,
      summary:
        scheduleState === "elapsed"
          ? "Reveal-later scheduled time has already elapsed; premature-access protection cannot be classified from this artifact."
          : "Reveal-later artifact does not include a scheduled reveal timestamp; premature-access protection cannot be classified."
    };
  }

  const shareLink = resolveShareLink(configuredUrl, artifact);
  const tokenlessUrl = shareLink ? buildTokenlessUrl(shareLink) : null;
  const probes = [];

  if (shareLink) {
    probes.push(await probeRenderedUrl("reveal-later-tokenized", shareLink, artifact));
  }
  if (tokenlessUrl && tokenlessUrl !== shareLink) {
    probes.push(await probeRenderedUrl("reveal-later-tokenless", tokenlessUrl, artifact));
  }

  const exposed = probes.some((probe) => probe.foundSubject || probe.foundMessage);
  const classifications = exposed ? ["reveal-bypass-risk"] : ["reveal-protected"];

  return {
    artifactPath: artifactMatch.path,
    cleanupInstruction: artifact.cleanupInstruction ?? null,
    finalShareLink: artifact.finalShareLink ?? null,
    lifecycleType: "reveal-later",
    probes,
    riskLevel: exposed ? "critical" : "info",
    runId: artifact.runId,
    securityClassifications: classifications,
    status: probes.length > 0 ? "passed" : "skipped",
    subject: artifact.subject,
    summary: exposed
      ? "Reveal-later exact QA content was visible before the scheduled reveal time."
      : "Reveal-later exact QA content was not visible through direct tokenized/tokenless probes."
  };
}

async function probeRenderedUrl(label, targetUrl, artifact) {
  let browser = null;
  let page = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: process.env.INSSA_URL,
      storageState: { cookies: [], origins: [] }
    });
    page = await context.newPage();
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const text = normalizeText((await page.locator("body").textContent().catch(() => "")) ?? "");
    await context.close().catch(() => {});

    return {
      accessible: response ? response.status() < 400 : false,
      error: null,
      finalUrl: page.url(),
      foundMessage: text.includes(normalizeText(artifact.message ?? "")),
      foundSubject: text.includes(normalizeText(artifact.subject ?? "")),
      httpStatus: response?.status() ?? null,
      label,
      targetUrl,
      tokenPresent: Boolean(extractShareToken(targetUrl)),
      visibleTextSample: text.slice(0, 1_500)
    };
  } catch (error) {
    return {
      accessible: false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: page?.url() ?? "about:blank",
      foundMessage: false,
      foundSubject: false,
      httpStatus: null,
      label,
      targetUrl,
      tokenPresent: Boolean(extractShareToken(targetUrl)),
      visibleTextSample: ""
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function probeHttpUrl(url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    const contentType = response.headers.get("content-type");
    const accessible = response.status >= 200 && response.status < 300;
    const accessibleMedia = accessible && /^(image|video)\//i.test(contentType ?? "");
    return {
      accessible,
      accessibleMedia,
      blocked: response.status === 401 || response.status === 403 || response.status === 404,
      contentLength: response.headers.get("content-length"),
      contentType,
      error: null,
      httpStatus: response.status,
      tokenPresent: Boolean(extractShareToken(url) || new URL(url).searchParams.has("token")),
      url: redactUrl(url)
    };
  } catch (error) {
    return {
      accessible: false,
      accessibleMedia: false,
      blocked: false,
      contentLength: null,
      contentType: null,
      error: error instanceof Error ? error.message : String(error),
      httpStatus: null,
      tokenPresent: Boolean(extractShareToken(url)),
      url: redactUrl(url)
    };
  }
}

function loadLiveStagingEnv() {
  if (!existsSync(ENV_FILE)) {
    console.warn(`INSSA security campaign env file not found: ${ENV_FILE}. Falling back to current process environment.`);
    return;
  }

  require("dotenv").config({ path: ENV_FILE, quiet: true });
}

function assertStagingEnvironment() {
  const configuredUrl = process.env.INSSA_URL;
  if (!configuredUrl) {
    throw new Error("INSSA_URL is required for the security campaign.");
  }

  const parsed = new URL(configuredUrl);
  if (parsed.hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(
      `INSSA security campaign is hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${parsed.hostname}".`
    );
  }

  return configuredUrl;
}

function runPlaywrightSpec(spec, env) {
  const playwrightBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "playwright.cmd" : "playwright"
  );
  const command = existsSync(playwrightBin) ? playwrightBin : process.platform === "win32" ? "npx.cmd" : "npx";
  const args = existsSync(playwrightBin)
    ? ["test", spec, "--project", PROJECT, "--workers=1", "--retries=0"]
    : ["playwright", "test", spec, "--project", PROJECT, "--workers=1", "--retries=0"];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit"
    });
    child.on("close", (code, signal) => {
      resolve({
        code: code ?? (signal ? 1 : 0),
        signal
      });
    });
  });
}

function findLatestArtifactBySubjectPrefix(subjectPrefix) {
  if (!existsSync(ARTIFACT_DIR)) {
    return null;
  }

  const matches = readdirSync(ARTIFACT_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const artifactPath = path.join(ARTIFACT_DIR, fileName);
      const artifact = readJsonFile(artifactPath);
      if (!isUsableArtifact(artifact) || !artifact.subject.startsWith(subjectPrefix)) {
        return null;
      }

      return {
        artifact,
        mtimeMs: statSync(artifactPath).mtimeMs,
        path: artifactPath
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return matches[0] ?? null;
}

function isUsableArtifact(artifact) {
  const successSignals = Array.isArray(artifact?.successSignals) ? artifact.successSignals : [];
  return (
    artifact &&
    artifact.environment === "staging" &&
    typeof artifact.runId === "string" &&
    typeof artifact.subject === "string" &&
    typeof artifact.message === "string" &&
    artifact.buryClicked === true &&
    artifact.revealSettingsOpened === true &&
    artifact.revealSettingsContinueClicked === true &&
    artifact.observedCreateSuccess === true &&
    successSignals.length > 0 &&
    (typeof artifact.finalShareLink === "string" || typeof artifact.possibleFinalCapsuleId === "string")
  );
}

function readPhaseArtifact(fileName) {
  return readOptionalArtifact(path.join(PHASE_ARTIFACT_DIR, fileName));
}

function readOptionalArtifact(filePath) {
  const artifact = readJsonFile(filePath);
  if (!artifact) {
    return null;
  }

  return {
    artifact,
    path: filePath
  };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function extractStorageMediaUrls(artifact) {
  return uniqueStrings(extractUrls(artifact).filter(isStorageMediaUrl).filter((url) => !hasRedactedToken(url)));
}

function extractUrls(value, output = []) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      output.push(value);
    }
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => extractUrls(entry, output));
    return output;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => extractUrls(entry, output));
  }

  return output;
}

function isStorageMediaUrl(url) {
  return (
    /firebasestorage\.googleapis\.com|storage\.googleapis\.com/i.test(url) &&
    /\/o\//i.test(url) &&
    /\.(?:webp|png|jpe?g|gif|mp4|mov|webm)(?:[?#]|$|%)/i.test(decodeURIComponent(url))
  );
}

function hasRedactedToken(url) {
  return /token=(?:%5Bredacted%5D|\[redacted\]|<redacted>)/i.test(url);
}

function buildTokenlessUrl(url) {
  const parsed = new URL(url);
  const hadToken = parsed.searchParams.has("token");
  parsed.searchParams.delete("token");
  return hadToken ? parsed.toString() : url;
}

function buildTokenlessMediaUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("token");
  if (!parsed.searchParams.has("alt")) {
    parsed.searchParams.set("alt", "media");
  }

  return parsed.toString();
}

function classifyRevealScheduleState(artifact) {
  const scheduledAtIso = artifact.revealLaterSchedule?.scheduledAtIso;
  if (!scheduledAtIso) {
    return "unknown";
  }

  const scheduledAtMs = Date.parse(scheduledAtIso);
  if (!Number.isFinite(scheduledAtMs)) {
    return "unknown";
  }

  return Date.now() < scheduledAtMs ? "pending" : "elapsed";
}

function resolveShareLink(configuredUrl, artifact) {
  const tokenParam = artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : "";
  const rawLink =
    artifact.finalShareLink ||
    (artifact.possibleFinalCapsuleId ? `/capsule/${artifact.possibleFinalCapsuleId}${tokenParam}` : "") ||
    artifact.finalUrl ||
    "";
  if (!rawLink) {
    return null;
  }

  const resolved = new URL(rawLink, new URL(configuredUrl).origin).toString();
  if (new URL(resolved).hostname.toLowerCase() !== STAGING_HOSTNAME) {
    throw new Error(`Refusing to probe non-staging reveal-later URL: ${resolved}`);
  }

  return resolved;
}

function extractShareToken(candidate) {
  return String(candidate).match(/[?&]token=([^&\s]+)/i)?.[1] ?? null;
}

function createBaseSummary(configuredUrl) {
  return {
    environment: "staging",
    findings: [],
    riskCounts: {
      critical: 0,
      "high-risk": 0,
      info: 0,
      warning: 0
    },
    securityClassifications: {},
    status: "running",
    summaryPath: null,
    url: configuredUrl,
    validatedAt: null,
    warnings: []
  };
}

function writeSecuritySummary(summary) {
  mkdirSync(SECURITY_RESULT_DIR, { recursive: true });
  const primaryRunId = summary.findings.find((finding) => finding.runId)?.runId ?? `security-${Date.now()}`;
  const summaryPath = path.join(SECURITY_RESULT_DIR, `${primaryRunId}-security.json`);
  const lifecycleSecurityPath = path.join(SECURITY_RESULT_DIR, "lifecycle-security.json");
  summary.summaryPath = summaryPath;
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(lifecycleSecurityPath, `${JSON.stringify(buildLifecycleSecurityArtifact(summary), null, 2)}\n`, "utf8");
  console.log(`\nINSSA security campaign summary written: ${summaryPath}`);
  console.log(`INSSA lifecycle security artifact written: ${lifecycleSecurityPath}`);
  try {
    const reports = renderSecurityReport(summaryPath);
    console.log(`INSSA security campaign HTML report written: ${reports[0]}`);
    console.log(`INSSA latest security summary written: ${reports[1]}`);
  } catch (error) {
    console.warn(`Unable to render security campaign HTML report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printSecuritySummary(summary) {
  console.log("\nINSSA lifecycle security campaign result:");
  console.log(`- status: ${summary.status}`);
  console.log(`- summary: ${summary.summaryPath ?? "none"}`);
  console.log(`- owasp baseline: ${summary.owaspTop10Command?.status ?? "not-run"}`);
  console.log(`- classifications: ${Object.entries(summary.securityClassifications).map(([key, count]) => `${key}=${count}`).join(", ") || "none"}`);
  console.log(
    `- risks: critical=${summary.riskCounts.critical}, high-risk=${summary.riskCounts["high-risk"]}, warning=${summary.riskCounts.warning}, info=${summary.riskCounts.info}`
  );
  for (const finding of summary.findings) {
    console.log(`- ${finding.lifecycleType}: ${finding.riskLevel} / ${finding.summary}`);
  }
}

function printUsage() {
  console.log(
    [
      "Usage: npm run test:inssa:campaign:security",
      "",
      "Runs the read-only INSSA OWASP Top 10 and lifecycle security/access-control campaign against staging.",
      "Requires .env.inssa.live-staging or process env with INSSA_URL=https://staging.inssa.us.",
      "Consumes existing lifecycle-artifacts/*.json; it does not create capsules.",
      "Writes security-campaigns/access-control.json, injection.json, authentication.json, security-headers.json, misconfiguration.json, and lifecycle-security.json."
    ].join("\n")
  );
}

function buildLifecycleSecurityArtifact(summary) {
  return {
    generatedAt: new Date().toISOString(),
    owaspCategories: ["A01: Broken Access Control", "A04: Insecure Design", "A09: Security Logging and Monitoring Failures"],
    status: summary.status,
    owaspTop10Command: summary.owaspTop10Command ?? null,
    lifecycleFindings: summary.findings.filter((finding) => finding.lifecycleType !== "owasp-top10-baseline"),
    securityClassifications: summary.securityClassifications,
    riskCounts: summary.riskCounts,
    cleanupResponsibility: "Manual dev cleanup. The security campaign does not delete, archive, unpublish, or mutate live capsules.",
    stagingOnly: true
  };
}

function buildLifecycleFindingSummary(tokenFinding, visibilityFinding, mediaAclFinding) {
  return [tokenFinding.summary, visibilityFinding.summary, mediaAclFinding?.summary]
    .filter(Boolean)
    .join(" ");
}

function summarizeCommand(result) {
  return {
    exitCode: result.code,
    signal: result.signal ?? null,
    status: result.code === 0 ? "passed" : "failed"
  };
}

function mergeSecurityClassifications(summary, classifications) {
  for (const classification of classifications) {
    summary.securityClassifications[classification] = (summary.securityClassifications[classification] ?? 0) + 1;
  }
}

function addRisk(summary, riskLevel) {
  if (!riskLevel) {
    return;
  }

  summary.riskCounts[riskLevel] = (summary.riskCounts[riskLevel] ?? 0) + 1;
}

function maxRisk(risks) {
  const order = ["info", "warning", "high-risk", "critical"];
  return risks.reduce((max, risk) => (order.indexOf(risk) > order.indexOf(max) ? risk : max), "info");
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of ["token", "key", "gsessionid", "SID", "RID", "AID", "zx"]) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "<redacted>");
      }
    }
    return parsed.toString();
  } catch {
    return String(url).replace(/([?&](?:token|key|gsessionid|SID|RID|AID|zx)=)[^&]+/gi, "$1<redacted>");
  }
}
