import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateCleanupGate } from "./cleanup-ledger";
import type { InssaRunStore } from "./run-store";
import type { InssaAuthenticatedUser } from "./security";
import { getRepoRoot, getRunOutputRoot } from "./paths";
import type {
  InssaCommandDefinition,
  InssaLiveExecutionContext,
  InssaLiveExecutionMode,
  ResolvedInssaLifecycleArtifactSelection
} from "./types";

export const LIVE_MUTATION_CONFIRMATION_PHRASE = "RUN STAGING MUTATION";
export const LIVE_MUTATION_ACKNOWLEDGEMENTS = [
  "modifies_staging",
  "target_verified",
  "cleanup_understood",
  "evidence_review_required"
] as const;
export const IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT = "no_automatic_final_action_retry";

export type LiveCampaignApprovalRequest = {
  acknowledgements?: unknown;
  confirmationPhrase?: unknown;
  executionMode?: unknown;
  resumeArtifactPath?: unknown;
};

export function parseLiveCampaignApprovalRequest(value: unknown): LiveCampaignApprovalRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const approval = value as Record<string, unknown>;
  return {
    acknowledgements: approval.acknowledgements,
    confirmationPhrase: approval.confirmationPhrase,
    executionMode: approval.executionMode,
    resumeArtifactPath: approval.resumeArtifactPath
  };
}

export type LiveCampaignPreflightCheck = {
  detail: string;
  id: string;
  passed: boolean;
};

export type LiveCampaignPreflightResult =
  | { checks: LiveCampaignPreflightCheck[]; error: string; ok: false; status: 400 | 409 | 503 }
  | { checks: LiveCampaignPreflightCheck[]; context: InssaLiveExecutionContext; ok: true };

type PreflightDependencies = {
  activeRunId: string | null;
  environment?: Record<string, string | undefined>;
  now?: Date;
  repoRoot?: string;
  store?: InssaRunStore;
  workerHealthy: boolean;
};

export function isGovernedLiveCampaign(command: InssaCommandDefinition | null | undefined) {
  return Boolean(command?.phase1Enabled && command.mutatesStaging && command.adminOnly && command.approvalRequired);
}

export async function validateLiveCampaignPreflight(
  command: InssaCommandDefinition,
  approval: LiveCampaignApprovalRequest | null | undefined,
  user: InssaAuthenticatedUser,
  dependencies: PreflightDependencies
): Promise<LiveCampaignPreflightResult> {
  const checks: LiveCampaignPreflightCheck[] = [];
  const fail = (id: string, error: string, status: 400 | 409 | 503 = 400): LiveCampaignPreflightResult => {
    checks.push({ detail: error, id, passed: false });
    return { checks, error, ok: false, status };
  };
  const pass = (id: string, detail: string) => checks.push({ detail, id, passed: true });

  if (!isGovernedLiveCampaign(command)) return fail("governed-command", "The selected command is not a governed live campaign.");
  pass("governed-command", "Governed campaign wrapper selected.");

  if (user.role !== "admin") return fail("admin-role", "Admin role is required for live staging mutation.");
  pass("admin-role", "Authenticated admin role confirmed.");

  const envFile = readEnvFile(dependencies.repoRoot ?? getRepoRoot());
  if (envFile.invalidLines.length) {
    return fail(
      "environment-file",
      `.env.inssa.live-staging contains invalid non-assignment content on line(s): ${envFile.invalidLines.join(", ")}.`,
      503
    );
  }
  const env = { ...envFile.values, ...(dependencies.environment ?? process.env) };
  const target = env.INSSA_URL?.trim();
  if (!target || !isExactStagingTarget(target)) {
    return fail("staging-target", "INSSA_URL must be exactly https://staging.inssa.us for live mutation execution.");
  }
  pass("staging-target", "Target locked to staging.inssa.us; browser overrides are ignored.");

  if (!dependencies.workerHealthy) return fail("worker-health", "Execution worker is not healthy under the dashboard supervisor.", 503);
  pass("worker-health", "Dashboard supervisor and worker execution path are available.");

  if (dependencies.activeRunId) {
    return fail("active-run", `Another execution is active: ${dependencies.activeRunId}`, 409);
  }
  pass("active-run", "No conflicting durable execution job is active.");

  const cleanupGate = await evaluateCleanupGate({
    environment: env,
    now: dependencies.now,
    repoRoot: dependencies.repoRoot ?? getRepoRoot(),
    requiresSecondaryAccount: command.requiresSecondaryAccount,
    store: dependencies.store
  });
  if (!cleanupGate.ok) return fail(cleanupGate.id, cleanupGate.error, 409);
  pass(
    "cleanup-ledger",
    cleanupGate.unresolved.length
      ? `${cleanupGate.unresolved.length} unresolved staging object(s) are identified, QA-owned, sanitized, and deferred within policy limits.`
      : "No unresolved cleanup object blocks staging mutation."
  );

  const acknowledgements = normalizeAcknowledgements(approval?.acknowledgements);
  const requiredAcknowledgements = [
    ...LIVE_MUTATION_ACKNOWLEDGEMENTS,
    IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT
  ];
  const missingAcknowledgement = requiredAcknowledgements.find((item) => !acknowledgements.includes(item));
  if (missingAcknowledgement) return fail("approval", `Required live campaign acknowledgement is missing: ${missingAcknowledgement}`);
  if (approval?.confirmationPhrase !== LIVE_MUTATION_CONFIRMATION_PHRASE) {
    return fail("approval", `Type ${LIVE_MUTATION_CONFIRMATION_PHRASE} exactly to approve staging mutation.`);
  }
  pass("approval", "All mutation acknowledgements and confirmation phrase were verified.");

  const executionMode = normalizeExecutionMode(approval?.executionMode);
  let resumeArtifact: ResolvedInssaLifecycleArtifactSelection | null = null;
  if (command.supportsExecutionModes) {
    if (!executionMode) return fail("execution-mode", "Choose Create new test artifact or Resume existing approved artifact.");
    if (executionMode === "resume") {
      const resolved = await validateRevealLaterArtifact(dependencies.repoRoot ?? getRepoRoot(), approval?.resumeArtifactPath);
      if ("error" in resolved) return fail("resume-artifact", resolved.error);
      resumeArtifact = resolved.artifact;
      pass("resume-artifact", `Approved staging reveal-later artifact selected: ${resumeArtifact.filePath}`);
    } else {
      pass("execution-mode", "Create mode selected; a new run-owned staging artifact will be created.");
    }
  } else if (executionMode || approval?.resumeArtifactPath) {
    return fail("execution-mode", "Create/resume parameters are only accepted by reveal-later campaigns.");
  }

  const requiredEnvironment = requiredEnvironmentFor(command.key);
  const missing = requiredEnvironment.filter((name) => !env[name]?.trim());
  if (missing.length) return fail("prerequisites", `Missing required campaign configuration: ${missing.join(", ")}`);
  const disabledFlag = requiredEnvironment
    .filter((name) => name.startsWith("INSSA_ENABLE_") || name === "INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED")
    .find((name) => env[name] !== "1");
  if (disabledFlag) return fail("prerequisites", `${disabledFlag}=1 is required for this governed live campaign.`);
  pass("prerequisites", `${requiredEnvironment.length} required configuration values are present.`);

  if (command.requiresSecondaryAccount) {
    if (env.INSSA_TEST_EMAIL?.trim().toLowerCase() === env.INSSA_SECONDARY_TEST_EMAIL?.trim().toLowerCase()) {
      return fail("account-separation", "Primary and secondary QA accounts must be distinct.");
    }
    pass("account-separation", "Primary and secondary QA accounts are present and distinct.");
  }

  const repoRoot = dependencies.repoRoot ?? getRepoRoot();
  if (command.key === "test_inssa_campaign_video") {
    const videoPath = env.INSSA_TEST_VIDEO_FIXTURE_PATH?.trim()
      ? path.resolve(repoRoot, env.INSSA_TEST_VIDEO_FIXTURE_PATH)
      : path.join(repoRoot, "tests", "fixtures", "media", "sample-video.mp4");
    const videoCheck = await validateMediaFile(videoPath, [".mp4"], 25 * 1024 * 1024);
    if (!videoCheck.ok) return fail("video-fixture", videoCheck.error);
    pass("video-fixture", `Approved MP4 fixture is readable (${videoCheck.size} bytes).`);
  }

  if (command.key === "test_inssa_campaign_media") {
    const configuredImage = env.INSSA_TEST_MEDIA_FIXTURE_PATH?.trim();
    if (configuredImage) {
      const imageCheck = await validateMediaFile(path.resolve(repoRoot, configuredImage), [".jpeg", ".jpg", ".png"], 10 * 1024 * 1024);
      if (!imageCheck.ok) return fail("media-fixture", imageCheck.error);
      pass("media-fixture", `Approved image fixture is readable (${imageCheck.size} bytes).`);
    } else {
      pass("media-fixture", "Campaign's deterministic generated PNG fixture strategy is available.");
    }
  }

  try {
    await fs.mkdir(path.dirname(getRunOutputRoot("preflight-probe")), { recursive: true });
    await fs.access(path.dirname(getRunOutputRoot("preflight-probe")), fs.constants.W_OK);
  } catch {
    return fail("output-storage", "Immutable run output directory is not writable.", 503);
  }
  pass("output-storage", "Immutable output and local evidence fallback are writable.");
  pass("cleanup", "Manual cleanup ownership is recorded for the requesting admin.");

  return {
    checks,
    context: {
      approvalAcknowledgements: acknowledgements,
      approvalConfirmedAt: new Date().toISOString(),
      approvedBy: user.email || user.id,
      cleanupPolicy: cleanupGate.policy,
      executionMode: command.supportsExecutionModes ? executionMode : null,
      irreversibleFinalAction: true,
      resumeArtifact,
      schemaVersion: 1,
      targetHost: "staging.inssa.us"
    },
    ok: true
  };
}

export function requiredEnvironmentFor(campaignKey: string) {
  const common = [
    "INSSA_URL",
    "INSSA_ENABLE_LIVE_CAPSULE_TESTS",
    "INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED",
    "INSSA_DEFERRED_CLEANUP_MODE",
    "INSSA_TEST_ACCOUNT_IS_DEDICATED_QA",
    "INSSA_TEST_EMAIL",
    "INSSA_TEST_PASSWORD"
  ];
  if (campaignKey === "test_inssa_campaign_text") return [...common, "INSSA_SECONDARY_TEST_EMAIL"];
  if (campaignKey === "test_inssa_campaign_media") return [...common, "INSSA_ENABLE_MEDIA_CAPSULE_TESTS", "INSSA_US_MARKET_LOCATION"];
  if (campaignKey === "test_inssa_campaign_video") return [...common, "INSSA_ENABLE_VIDEO_CAPSULE_TESTS", "INSSA_US_MARKET_LOCATION"];
  if (campaignKey === "test_inssa_campaign_reveal_later") return [...common, "INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS"];
  if (campaignKey === "test_inssa_campaign_cross_user") {
    return [...common, "INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA", "INSSA_SECONDARY_TEST_EMAIL", "INSSA_SECONDARY_TEST_PASSWORD"];
  }
  if (campaignKey === "test_inssa_campaign_reveal_later_security") {
    return [
      ...common,
      "INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS",
      "INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA",
      "INSSA_SECONDARY_TEST_EMAIL",
      "INSSA_SECONDARY_TEST_PASSWORD"
    ];
  }
  return common;
}

export async function findPendingCleanupBlocker(repoRoot = getRepoRoot()) {
  const outputRoot = path.join(repoRoot, "run-output");
  let entries: string[];
  try {
    entries = await fs.readdir(outputRoot);
  } catch {
    return null;
  }

  for (const entry of entries.sort()) {
    const manifestPath = path.join(outputRoot, entry, "cleanup-manifest.json");
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        createdCapsuleIds?: unknown;
        runId?: unknown;
        status?: unknown;
      };
      if (manifest.status !== "pending" && manifest.status !== "failed") continue;
      return {
        capsuleIds: Array.isArray(manifest.createdCapsuleIds)
          ? manifest.createdCapsuleIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          : [],
        manifestPath,
        runId: typeof manifest.runId === "string" && manifest.runId ? manifest.runId : entry,
        status: manifest.status
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return { capsuleIds: [], manifestPath, runId: entry, status: "invalid" as const };
    }
  }
  return null;
}

export async function dashboardWorkerIsHealthy(repoRoot = getRepoRoot()) {
  try {
    const owner = JSON.parse(
      await fs.readFile(path.join(repoRoot, "dashboard", ".data", "dashboard-runtime.lock", "owner.json"), "utf8")
    ) as { mode?: unknown; pid?: unknown };
    if ((owner.mode !== "dev" && owner.mode !== "start") || !Number.isInteger(owner.pid)) return false;
    process.kill(owner.pid as number, 0);
    return true;
  } catch {
    return false;
  }
}

function isExactStagingTarget(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "staging.inssa.us" && (url.pathname === "/" || url.pathname === "");
  } catch {
    return false;
  }
}

function normalizeAcknowledgements(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === "string"))).sort() : [];
}

function normalizeExecutionMode(value: unknown): InssaLiveExecutionMode | null {
  return value === "create" || value === "resume" ? value : null;
}

async function validateRevealLaterArtifact(
  repoRoot: string,
  value: unknown
): Promise<{ error: string } | { artifact: ResolvedInssaLifecycleArtifactSelection }> {
  if (typeof value !== "string" || !value.trim()) return { error: "Resume mode requires an approved reveal-later artifact path." };
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("..") || !normalized.startsWith("lifecycle-artifacts/") || !normalized.endsWith(".json")) {
    return { error: "Resume artifact must be a repository lifecycle-artifacts JSON path." };
  }
  try {
    const artifact = JSON.parse(await fs.readFile(path.join(repoRoot, normalized), "utf8")) as Record<string, unknown>;
    const revealSchedule = isRecord(artifact.revealLaterSchedule) ? artifact.revealLaterSchedule : null;
    const owner = firstString(artifact.maskedTestEmail, artifact.maskedOwnerEmail);
    const scheduledAtIso = firstString(artifact.scheduledAtIso, revealSchedule?.scheduledAtIso);
    const lifecycleState = firstString(artifact.revealLaterFlowClassification, artifact.lifecycleClassification);
    if (
      artifact.environment !== "staging" ||
      artifact.observedCreateSuccess !== true ||
      artifact.revealTiming !== "reveal-later" ||
      artifact.buryClicked !== true ||
      !owner ||
      !scheduledAtIso ||
      !lifecycleState
    ) {
      return { error: "Selected artifact is not a successful staging reveal-later artifact." };
    }
    return {
      artifact: {
        artifactId: firstString(artifact.possibleFinalCapsuleId, artifact.draftIdBeforeCreate, artifact.runId),
        artifactType: "reveal-later",
        filePath: normalized,
        lifecycleState,
        owner,
        scheduledAtIso,
        timestamp: typeof artifact.createdAt === "string" ? artifact.createdAt : new Date().toISOString()
      }
    };
  } catch {
    return { error: "Selected reveal-later artifact does not exist or is not readable JSON." };
  }
}

async function validateMediaFile(filePath: string, extensions: string[], maxBytes: number) {
  try {
    const extension = path.extname(filePath).toLowerCase();
    if (!extensions.includes(extension)) return { error: `Fixture MIME/extension is not approved: ${extension || "unknown"}`, ok: false as const };
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return { error: "Fixture is empty, oversized, or not a regular file.", ok: false as const };
    return { ok: true as const, size: stat.size };
  } catch {
    return { error: `Required fixture is unavailable: ${path.basename(filePath)}`, ok: false as const };
  }
}

function readEnvFile(repoRoot: string) {
  const values: Record<string, string> = {};
  const invalidLines: number[] = [];
  try {
    const body = readFileSync(path.join(repoRoot, ".env.inssa.live-staging"), "utf8");
    for (const [index, line] of body.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) {
        invalidLines.push(index + 1);
        continue;
      }
      values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // The process environment remains the only source when the optional local file is absent.
  }
  return { invalidLines, values };
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
