#!/usr/bin/env node

const { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { renderLifecycleReport } = require("./render-campaign-report");

const STAGING_HOSTNAME = "staging.inssa.us";
const PROJECT = "inssa-chrome";
const ARTIFACT_DIR = path.resolve(process.cwd(), "lifecycle-artifacts");
const CAMPAIGN_RESULT_DIR = path.resolve(process.cwd(), "lifecycle-campaigns");
const DISCOVERY_ARTIFACT_DIR = path.resolve(process.cwd(), "test-results", "inssa-live-capsule-artifacts");
const ENV_FILE = path.resolve(process.cwd(), ".env.inssa.live-staging");

const CAMPAIGNS = {
  text: {
    createSpec: "tests/inssa/live-capsule-create.spec.ts",
    label: "text",
    requiredFlags: [],
    subjectPrefix: "QA_LIVE_CAPSULE_"
  },
  media: {
    createSpec: "tests/inssa/live-capsule-media-create.spec.ts",
    label: "media",
    requiredFlags: ["INSSA_ENABLE_MEDIA_CAPSULE_TESTS"],
    requiredValues: ["INSSA_US_MARKET_LOCATION"],
    subjectPrefix: "QA_LIVE_MEDIA_CAPSULE_"
  },
  video: {
    createSpec: "tests/inssa/live-capsule-video-create.spec.ts",
    label: "video",
    requiredFlags: ["INSSA_ENABLE_VIDEO_CAPSULE_TESTS"],
    requiredValues: ["INSSA_US_MARKET_LOCATION"],
    subjectPrefix: "QA_LIVE_VIDEO_CAPSULE_"
  },
  "reveal-later": {
    createSpec: "tests/inssa/live-capsule-reveal-later-create.spec.ts",
    label: "reveal-later",
    requiredFlags: ["INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS"],
    subjectPrefix: "QA_REVEAL_LATER_CAPSULE_"
  }
};

const COMMON_REQUIRED_FLAGS = [
  "INSSA_ENABLE_LIVE_CAPSULE_TESTS",
  "INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED"
];

const DISCOVERY_SPEC = "tests/inssa/live-capsule-authenticated-discovery.spec.ts";
const PUBLIC_SHARE_SPEC = "tests/inssa/live-capsule-public-share-lifecycle.spec.ts";
const WARNING_CLASSIFICATIONS = new Set([
  "authenticated-surface-undiscoverable",
  "delayed-indexing",
  "direct-access-without-indexing",
  "share-link-only-visibility",
  "tokenized-only-access"
]);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  loadLiveStagingEnv();

  const campaignName = process.argv[2];
  const campaign = CAMPAIGNS[campaignName];
  if (!campaign) {
    throw new Error(
      `Usage: node scripts/inssa/run-lifecycle-campaign.js <${Object.keys(CAMPAIGNS).join("|")}>`
    );
  }

  assertLiveStagingEnvironment(campaign);

  const summary = createBaseSummary(campaign);
  const createStartedAtMs = Date.now();

  console.log(`\nINSSA lifecycle campaign:${campaign.label}`);
  console.log(`CREATE: ${campaign.createSpec}`);
  const createResult = await runPlaywrightSpec(campaign.createSpec, process.env);
  summary.creation = summarizeCommand(createResult);
  if (createResult.code !== 0) {
    summary.status = "failed";
    summary.failurePhase = "create";
    summary.lifecycleNetworkClassification = "lifecycle-failed";
    writeCampaignSummary(summary);
    process.exitCode = createResult.code || 1;
    return;
  }

  const creationArtifact = findNewestCampaignArtifact(campaign, createStartedAtMs);
  if (!creationArtifact) {
    summary.status = "failed";
    summary.failurePhase = "create-artifact";
    summary.lifecycleNetworkClassification = "lifecycle-failed";
    summary.notes.push(
      `Create phase exited successfully, but no new ${campaign.label} creation artifact was found in ${ARTIFACT_DIR}.`
    );
    writeCampaignSummary(summary);
    process.exitCode = 1;
    return;
  }

  summary.creationArtifactPath = creationArtifact.path;
  summary.runId = creationArtifact.artifact.runId;
  summary.subject = creationArtifact.artifact.subject;
  summary.creationLifecycleClassification = creationArtifact.artifact.lifecycleClassification ?? null;
  summary.lifecycleNetworkClassification = classifyCampaignLifecycleNetwork(creationArtifact.artifact);
  summary.creationRequestFailureSummary = creationArtifact.artifact.requestFailureSummary ?? null;
  summary.creationFatalNetworkIssueCount = Array.isArray(creationArtifact.artifact.fatalNetworkIssues)
    ? creationArtifact.artifact.fatalNetworkIssues.length
    : summary.creationRequestFailureSummary?.fatal ?? 0;
  summary.creationWarningNetworkIssueCount = Array.isArray(creationArtifact.artifact.warningNetworkIssues)
    ? creationArtifact.artifact.warningNetworkIssues.length
    : summary.creationRequestFailureSummary?.warning ?? 0;
  summary.creationNetworkIssueClassifications = creationArtifact.artifact.requestFailureSummary?.classifications ?? {};
  summary.cleanupInstruction = creationArtifact.artifact.cleanupInstruction ?? null;
  summary.finalShareLink = creationArtifact.artifact.finalShareLink ?? null;
  summary.possibleFinalCapsuleId = creationArtifact.artifact.possibleFinalCapsuleId ?? null;

  if (summary.lifecycleNetworkClassification === "lifecycle-failed") {
    summary.status = "failed";
    summary.failurePhase = "create-network";
    summary.notes.push(
      `Create phase produced a lifecycle artifact, but fatal network issues were recorded: ${JSON.stringify(
        summary.creationNetworkIssueClassifications
      )}`
    );
    writeCampaignSummary(summary);
    process.exitCode = 1;
    return;
  }

  if (summary.lifecycleNetworkClassification === "lifecycle-succeeded-with-network-warnings") {
    summary.warnings.push(
      `creation network: ${summarizeNetworkIssueClassifications(summary.creationNetworkIssueClassifications)}`
    );
  }

  const downstreamEnv = {
    ...process.env,
    INSSA_LIVE_CAPSULE_ARTIFACT_PATH: creationArtifact.path,
    INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT: "0"
  };

  console.log(`\nDISCOVERY: ${DISCOVERY_SPEC}`);
  console.log(`Artifact: ${creationArtifact.path}`);
  const discoveryResult = await runPlaywrightSpec(DISCOVERY_SPEC, downstreamEnv);
  summary.discovery = summarizeCommand(discoveryResult);
  const discoveryArtifact = readDiscoveryArtifact(creationArtifact.artifact.runId);
  if (discoveryArtifact) {
    summary.discoveryArtifactPath = discoveryArtifact.path;
    summary.lifecycleVisibilityClassification = discoveryArtifact.artifact.lifecycleVisibilityClassification ?? null;
    summary.discoveryOutcomeClassification = discoveryArtifact.artifact.outcomeClassification ?? null;
    summary.authenticatedSurfaceIndexed = Boolean(discoveryArtifact.artifact.authenticatedSurfaceIndexed);
    summary.authenticatedSurfaceUndiscoverable = Boolean(discoveryArtifact.artifact.authenticatedSurfaceUndiscoverable);
    summary.directShareAccessible = Boolean(discoveryArtifact.artifact.directShareAccessible);
    summary.tokenizedAccess = Boolean(discoveryArtifact.artifact.tokenizedAccess);
    if (isWarningClassification(summary.lifecycleVisibilityClassification)) {
      summary.warnings.push(`authenticated discovery: ${summary.lifecycleVisibilityClassification}`);
    }
  }

  if (discoveryResult.code !== 0) {
    summary.status = "failed";
    summary.failurePhase = "discovery";
    writeCampaignSummary(summary);
    process.exitCode = discoveryResult.code || 1;
    return;
  }

  console.log(`\nPUBLIC SHARE: ${PUBLIC_SHARE_SPEC}`);
  const publicShareResult = await runPlaywrightSpec(PUBLIC_SHARE_SPEC, downstreamEnv);
  summary.publicShare = summarizeCommand(publicShareResult);
  const publicShareArtifact = readPublicShareArtifact(creationArtifact.artifact.runId);
  if (publicShareArtifact) {
    summary.publicShareArtifactPath = publicShareArtifact.path;
    summary.publicShareLifecycleStatus = publicShareArtifact.artifact.lifecycleStatus ?? null;
    summary.cleanAccessVisible = Boolean(publicShareArtifact.artifact.cleanAccessVisible);
    summary.loggedOutAccessVisible = Boolean(publicShareArtifact.artifact.loggedOutAccessVisible);
    summary.tokenlessAccessClassification = publicShareArtifact.artifact.tokenlessAccessClassification ?? null;
    if (summary.tokenlessAccessClassification === "content-visible") {
      summary.warnings.push("public share: tokenless capsule URL exposed exact QA content");
    }
  }

  if (publicShareResult.code !== 0) {
    summary.status = "failed";
    summary.failurePhase = "public-share";
    writeCampaignSummary(summary);
    process.exitCode = publicShareResult.code || 1;
    return;
  }

  summary.status = summary.warnings.length > 0 ? "passed-with-warnings" : "passed";
  writeCampaignSummary(summary);
  printCampaignSummary(summary);
}

function loadLiveStagingEnv() {
  if (!existsSync(ENV_FILE)) {
    console.warn(`INSSA campaign env file not found: ${ENV_FILE}. Falling back to current process environment.`);
    return;
  }

  require("dotenv").config({ path: ENV_FILE, quiet: true });
}

function assertLiveStagingEnvironment(campaign) {
  const configuredUrl = process.env.INSSA_URL;
  if (!configuredUrl) {
    throw new Error("INSSA_URL is required for lifecycle campaigns.");
  }

  const hostname = new URL(configuredUrl).hostname.toLowerCase();
  if (hostname !== STAGING_HOSTNAME) {
    throw new Error(
      `INSSA lifecycle campaigns are hard-blocked outside ${STAGING_HOSTNAME}. Current INSSA_URL host: "${hostname}".`
    );
  }

  for (const flagName of [...COMMON_REQUIRED_FLAGS, ...campaign.requiredFlags]) {
    if (process.env[flagName] !== "1") {
      throw new Error(`INSSA lifecycle campaign:${campaign.label} requires ${flagName}=1.`);
    }
  }

  for (const valueName of campaign.requiredValues ?? []) {
    if (!process.env[valueName]?.trim()) {
      throw new Error(`INSSA lifecycle campaign:${campaign.label} requires non-empty ${valueName}.`);
    }
  }
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

function findNewestCampaignArtifact(campaign, startedAtMs) {
  if (!existsSync(ARTIFACT_DIR)) {
    return null;
  }

  const candidates = readdirSync(ARTIFACT_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const artifactPath = path.join(ARTIFACT_DIR, fileName);
      const stat = statSync(artifactPath);
      const artifact = readJsonFile(artifactPath);
      if (!artifact || !isValidCreationArtifact(artifact) || !matchesCampaignArtifact(artifact, campaign)) {
        return null;
      }

      return {
        artifact,
        mtimeMs: stat.mtimeMs,
        path: artifactPath
      };
    })
    .filter(Boolean)
    .filter((candidate) => candidate.mtimeMs >= startedAtMs - 1_000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0] ?? null;
}

function matchesCampaignArtifact(artifact, campaign) {
  return typeof artifact.subject === "string" && artifact.subject.startsWith(campaign.subjectPrefix);
}

function isValidCreationArtifact(artifact) {
  return (
    artifact &&
    artifact.environment === "staging" &&
    nonEmptyString(artifact.runId) &&
    nonEmptyString(artifact.subject) &&
    nonEmptyString(artifact.message) &&
    nonEmptyString(artifact.createdAt) &&
    nonEmptyString(artifact.cleanupInstruction) &&
    artifact.buryClicked === true &&
    artifact.revealSettingsOpened === true &&
    artifact.revealSettingsContinueClicked === true &&
    artifact.observedCreateSuccess === true &&
    Array.isArray(artifact.successSignals) &&
    artifact.successSignals.length > 0
  );
}

function readDiscoveryArtifact(runId) {
  return readPhaseArtifact(path.join(DISCOVERY_ARTIFACT_DIR, `${runId}-authenticated-discovery.json`));
}

function readPublicShareArtifact(runId) {
  return readPhaseArtifact(path.join(DISCOVERY_ARTIFACT_DIR, `${runId}-public-share-lifecycle.json`));
}

function readPhaseArtifact(artifactPath) {
  const artifact = readJsonFile(artifactPath);
  if (!artifact) {
    return null;
  }

  return {
    artifact,
    path: artifactPath
  };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function createBaseSummary(campaign) {
  return {
    campaign: campaign.label,
    checkedAt: new Date().toISOString(),
    cleanupInstruction: null,
    cleanAccessVisible: false,
    creation: null,
    creationArtifactPath: null,
    creationLifecycleClassification: null,
    creationFatalNetworkIssueCount: 0,
    creationNetworkIssueClassifications: {},
    creationRequestFailureSummary: null,
    creationWarningNetworkIssueCount: 0,
    directShareAccessible: false,
    discovery: null,
    discoveryArtifactPath: null,
    discoveryOutcomeClassification: null,
    failurePhase: null,
    finalShareLink: null,
    lifecycleVisibilityClassification: null,
    lifecycleNetworkClassification: null,
    loggedOutAccessVisible: false,
    notes: [],
    possibleFinalCapsuleId: null,
    publicShare: null,
    publicShareArtifactPath: null,
    publicShareLifecycleStatus: null,
    runId: null,
    status: "running",
    subject: null,
    summaryPath: null,
    tokenizedAccess: false,
    tokenlessAccessClassification: null,
    authenticatedSurfaceIndexed: false,
    authenticatedSurfaceUndiscoverable: false,
    warnings: []
  };
}

function summarizeCommand(result) {
  return {
    exitCode: result.code,
    signal: result.signal ?? null,
    status: result.code === 0 ? "passed" : "failed"
  };
}

function writeCampaignSummary(summary) {
  mkdirSync(CAMPAIGN_RESULT_DIR, { recursive: true });
  const fileName = `${summary.runId ?? `${summary.campaign}-${Date.now()}`}-campaign-${summary.campaign}.json`;
  const summaryPath = path.join(CAMPAIGN_RESULT_DIR, fileName);
  summary.summaryPath = summaryPath;
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`\nINSSA lifecycle campaign summary written: ${summaryPath}`);
  try {
    const reports = renderLifecycleReport(summaryPath);
    console.log(`INSSA lifecycle campaign HTML report written: ${reports[0]}`);
    console.log(`INSSA latest lifecycle summary written: ${reports[1]}`);
  } catch (error) {
    console.warn(`Unable to render lifecycle campaign HTML report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printCampaignSummary(summary) {
  console.log("\nLifecycle campaign result:");
  console.log(`- campaign: ${summary.campaign}`);
  console.log(`- status: ${summary.status}`);
  console.log(`- creation: ${summary.creation?.status ?? "not-run"}`);
  console.log(`- retrieval: ${summary.directShareAccessible ? "passed" : "failed"}`);
  console.log(`- public-share: ${summary.publicShare?.status ?? "not-run"}`);
  console.log(
    `- authenticated discovery: ${
      summary.authenticatedSurfaceIndexed ? "indexed" : summary.authenticatedSurfaceUndiscoverable ? "warning" : "not-indexed"
    }`
  );
  console.log(`- classification: ${summary.lifecycleVisibilityClassification ?? "unknown"}`);
  console.log(`- lifecycle network: ${summary.lifecycleNetworkClassification ?? "unknown"}`);
  console.log(`- artifact: ${summary.creationArtifactPath ?? "none"}`);
  console.log(`- summary: ${summary.summaryPath ?? "none"}`);
  if (summary.warnings.length > 0) {
    console.log(`- warnings: ${summary.warnings.join("; ")}`);
  }
  if (summary.cleanupInstruction) {
    console.log(`- cleanup: ${summary.cleanupInstruction}`);
  }
}

function classifyCampaignLifecycleNetwork(artifact) {
  const fatalCount = Array.isArray(artifact.fatalNetworkIssues)
    ? artifact.fatalNetworkIssues.length
    : artifact.requestFailureSummary?.fatal ?? 0;
  if (fatalCount > 0 || artifact.observedCreateSuccess !== true) {
    return "lifecycle-failed";
  }

  const warningCount = Array.isArray(artifact.warningNetworkIssues)
    ? artifact.warningNetworkIssues.length
    : artifact.requestFailureSummary?.warning ?? 0;
  if (warningCount > 0 || artifact.lifecycleSucceededDespiteWarnings === true) {
    return "lifecycle-succeeded-with-network-warnings";
  }

  return "lifecycle-succeeded-cleanly";
}

function summarizeNetworkIssueClassifications(classifications) {
  const entries = Object.entries(classifications ?? {});
  if (entries.length === 0) {
    return "warning request failures recorded";
  }

  return entries.map(([classification, count]) => `${classification}=${count}`).join(", ");
}

function isWarningClassification(classification) {
  return classification ? WARNING_CLASSIFICATIONS.has(classification) : false;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
