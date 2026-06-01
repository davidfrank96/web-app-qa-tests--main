import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { copyFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import type { Page } from "@playwright/test";

export const INSSA_LIVE_CAPSULE_ARTIFACT_PATH_ENV = "INSSA_LIVE_CAPSULE_ARTIFACT_PATH";
export const INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT_ENV = "INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT";

export const INSSA_LIFECYCLE_ARTIFACT_DIR = path.resolve(process.cwd(), "lifecycle-artifacts");
export const INSSA_LEGACY_LIFECYCLE_ARTIFACT_DIR = path.resolve(
  process.cwd(),
  "test-results",
  "inssa-live-capsule-artifacts"
);

type CandidateArtifact = {
  createdAtMs: number;
  path: string;
};

type ArtifactFieldSummary = {
  buryClicked: unknown;
  cleanupInstructionPresent: boolean;
  createdAtPresent: boolean;
  environment: unknown;
  finalShareLinkPresent: boolean;
  finalUrl: unknown;
  messagePresent: boolean;
  observedCreateSuccess: unknown;
  possibleFinalCapsuleIdPresent: boolean;
  possibleShareTokenPresent: boolean;
  revealSettingsContinueClicked: unknown;
  revealSettingsOpened: unknown;
  routeStayedOnTimecapsule: boolean;
  runId: unknown;
  subject: unknown;
  successSignalsCount: number;
};

type ArtifactClassification = {
  fields: ArtifactFieldSummary | null;
  parsed: Record<string, unknown> | null;
  reasons: string[];
  valid: boolean;
};

export function resolveInssaLiveCapsuleArtifactPath(): string {
  const explicitPath = process.env[INSSA_LIVE_CAPSULE_ARTIFACT_PATH_ENV]?.trim();
  if (explicitPath) {
    const resolvedPath = path.resolve(explicitPath);
    if (!isReadableFile(resolvedPath)) {
      throw new Error(
        buildMissingArtifactError({
          mode: "explicit",
          requestedPath: explicitPath,
          resolvedPath
        })
      );
    }

    const classification = classifyCreationArtifactPath(resolvedPath);
    if (!classification.valid) {
      throw new Error(buildInvalidArtifactError(resolvedPath, classification));
    }

    logAcceptedArtifact("using explicit artifact", resolvedPath, classification);
    return resolvedPath;
  }

  if (process.env[INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT_ENV] !== "1") {
    return "";
  }

  const latestPath = findLatestCreationArtifactPath();
  if (!latestPath) {
    throw new Error(
      buildMissingArtifactError({
        mode: "latest"
      })
    );
  }

  logAcceptedArtifact("selected latest creation artifact", latestPath, classifyCreationArtifactPath(latestPath));
  return latestPath;
}

export function getInssaLifecycleArtifactPath(fileName: string): string {
  return path.join(INSSA_LIFECYCLE_ARTIFACT_DIR, fileName);
}

export function getInssaLegacyLifecycleArtifactPath(fileName: string): string {
  return path.join(INSSA_LEGACY_LIFECYCLE_ARTIFACT_DIR, fileName);
}

export async function writeInssaLifecycleArtifactJson(fileName: string, artifact: unknown): Promise<string> {
  const artifactBody = typeof artifact === "string" ? artifact : JSON.stringify(artifact, null, 2);
  const primaryPath = getInssaLifecycleArtifactPath(fileName);
  const legacyPath = getInssaLegacyLifecycleArtifactPath(fileName);

  await mkdir(INSSA_LIFECYCLE_ARTIFACT_DIR, { recursive: true });
  await mkdir(INSSA_LEGACY_LIFECYCLE_ARTIFACT_DIR, { recursive: true });
  await writeFile(primaryPath, `${artifactBody.trimEnd()}\n`, "utf8");
  await writeFile(legacyPath, `${artifactBody.trimEnd()}\n`, "utf8");

  return primaryPath;
}

export async function captureInssaLifecycleArtifactScreenshot(page: Page, fileName: string): Promise<string> {
  const primaryPath = getInssaLifecycleArtifactPath(fileName);
  const legacyPath = getInssaLegacyLifecycleArtifactPath(fileName);

  await mkdir(INSSA_LIFECYCLE_ARTIFACT_DIR, { recursive: true });
  await mkdir(INSSA_LEGACY_LIFECYCLE_ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ fullPage: true, path: primaryPath });
  await copyFile(primaryPath, legacyPath);

  return primaryPath;
}

function findLatestCreationArtifactPath(): string | null {
  return (
    findLatestCreationArtifactPathInDir(INSSA_LIFECYCLE_ARTIFACT_DIR) ??
    findLatestCreationArtifactPathInDir(INSSA_LEGACY_LIFECYCLE_ARTIFACT_DIR)
  );
}

function findLatestCreationArtifactPathInDir(artifactDir: string): string | null {
  if (!existsSync(artifactDir)) {
    return null;
  }

  const candidates = readdirSync(artifactDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName): CandidateArtifact | null => {
      const artifactPath = path.join(artifactDir, fileName);
      if (!classifyCreationArtifactPath(artifactPath).valid) {
        return null;
      }

      return {
        createdAtMs: statSync(artifactPath).mtimeMs,
        path: artifactPath
      };
    })
    .filter((candidate): candidate is CandidateArtifact => Boolean(candidate))
    .sort((left, right) => right.createdAtMs - left.createdAtMs);

  return candidates[0]?.path ?? null;
}

function looksLikeCreationArtifact(artifactPath: string): boolean {
  return classifyCreationArtifactPath(artifactPath).valid;
}

function classifyCreationArtifactPath(artifactPath: string): ArtifactClassification {
  try {
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
    if (!isRecord(parsed)) {
      return {
        fields: null,
        parsed: null,
        reasons: ["Artifact JSON must be an object."],
        valid: false
      };
    }

    return classifyCreationArtifact(parsed);
  } catch (error) {
    return {
      fields: null,
      parsed: null,
      reasons: [`Artifact JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
      valid: false
    };
  }
}

function classifyCreationArtifact(parsed: Record<string, unknown>): ArtifactClassification {
  const fields = summarizeArtifactFields(parsed);
  const reasons: string[] = [];

  if (parsed.environment !== "staging") {
    reasons.push(`Expected environment="staging"; actual=${formatUnknown(parsed.environment)}.`);
  }
  if (!nonEmptyString(parsed.runId)) {
    reasons.push("Expected non-empty runId.");
  }
  if (!nonEmptyString(parsed.subject)) {
    reasons.push("Expected non-empty subject.");
  }
  if (!nonEmptyString(parsed.message)) {
    reasons.push("Expected non-empty message.");
  }
  if (!nonEmptyString(parsed.createdAt)) {
    reasons.push("Expected non-empty createdAt.");
  }
  if (!nonEmptyString(parsed.cleanupInstruction)) {
    reasons.push("Expected non-empty cleanupInstruction.");
  }
  if (parsed.buryClicked !== true) {
    reasons.push(`Expected buryClicked=true; actual=${formatUnknown(parsed.buryClicked)}.`);
  }
  if (parsed.revealSettingsOpened !== true) {
    reasons.push(`Expected revealSettingsOpened=true; actual=${formatUnknown(parsed.revealSettingsOpened)}.`);
  }
  if (parsed.revealSettingsContinueClicked !== true) {
    reasons.push(
      `Expected revealSettingsContinueClicked=true; actual=${formatUnknown(parsed.revealSettingsContinueClicked)}.`
    );
  }
  if (parsed.observedCreateSuccess !== true) {
    reasons.push(`Expected observedCreateSuccess=true; actual=${formatUnknown(parsed.observedCreateSuccess)}.`);
  }
  if (!Array.isArray(parsed.successSignals) || parsed.successSignals.length === 0) {
    reasons.push(`Expected non-empty successSignals array; actual count=${fields.successSignalsCount}.`);
  }

  return {
    fields,
    parsed,
    reasons,
    valid: reasons.length === 0
  };
}

function summarizeArtifactFields(parsed: Record<string, unknown>): ArtifactFieldSummary {
  return {
    buryClicked: parsed.buryClicked,
    cleanupInstructionPresent: nonEmptyString(parsed.cleanupInstruction),
    createdAtPresent: nonEmptyString(parsed.createdAt),
    environment: parsed.environment,
    finalShareLinkPresent: nonEmptyString(parsed.finalShareLink),
    finalUrl: parsed.finalUrl,
    messagePresent: nonEmptyString(parsed.message),
    observedCreateSuccess: parsed.observedCreateSuccess,
    possibleFinalCapsuleIdPresent: nonEmptyString(parsed.possibleFinalCapsuleId),
    possibleShareTokenPresent: nonEmptyString(parsed.possibleShareToken),
    revealSettingsContinueClicked: parsed.revealSettingsContinueClicked,
    revealSettingsOpened: parsed.revealSettingsOpened,
    routeStayedOnTimecapsule: nonEmptyString(parsed.finalUrl) && /\/timecapsule(?:\?|$)/i.test(parsed.finalUrl),
    runId: parsed.runId,
    subject: parsed.subject,
    successSignalsCount: Array.isArray(parsed.successSignals) ? parsed.successSignals.length : 0
  };
}

function hasExtractedShareEvidence(fields: ArtifactFieldSummary | null): boolean {
  return Boolean(
    fields?.finalShareLinkPresent ||
      fields?.possibleFinalCapsuleIdPresent ||
      fields?.possibleShareTokenPresent ||
      (typeof fields?.finalUrl === "string" && /\/capsule\//i.test(fields.finalUrl))
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReadableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function buildMissingArtifactError(input: {
  mode: "explicit" | "latest";
  requestedPath?: string;
  resolvedPath?: string;
}): string {
  const availableFiles = listAvailableArtifactFiles();
  const header =
    input.mode === "explicit"
      ? "INSSA live capsule artifact path does not exist."
      : "INSSA latest live capsule artifact could not be resolved.";

  return [
    header,
    input.requestedPath ? `Requested ${INSSA_LIVE_CAPSULE_ARTIFACT_PATH_ENV}: ${input.requestedPath}` : null,
    input.resolvedPath ? `Resolved artifact path: ${input.resolvedPath}` : null,
    `cwd: ${process.cwd()}`,
    `Persistent artifact directory: ${INSSA_LIFECYCLE_ARTIFACT_DIR}`,
    `Legacy artifact directory: ${INSSA_LEGACY_LIFECYCLE_ARTIFACT_DIR}`,
    availableFiles.length > 0
      ? `Available artifact JSON files:\n${availableFiles.map((file) => `  - ${file}`).join("\n")}`
      : "Available artifact JSON files: none",
    `To select the newest valid creation artifact automatically, rerun with ${INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT_ENV}=1.`,
    `To use a specific artifact, set ${INSSA_LIVE_CAPSULE_ARTIFACT_PATH_ENV}=lifecycle-artifacts/<runId>.json.`,
    "Discovery and public-share lifecycle tests are read-only and do not create capsules."
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function buildInvalidArtifactError(artifactPath: string, classification: ArtifactClassification): string {
  return [
    "INSSA live capsule artifact is not a usable creation artifact.",
    `Artifact path: ${artifactPath}`,
    `cwd: ${process.cwd()}`,
    "Expected finalized lifecycle artifact fields:",
    "  - environment=\"staging\"",
    "  - non-empty runId, subject, message, createdAt, cleanupInstruction",
    "  - buryClicked=true",
    "  - revealSettingsOpened=true",
    "  - revealSettingsContinueClicked=true",
    "  - observedCreateSuccess=true",
    "  - non-empty successSignals",
    `Actual fields: ${JSON.stringify(classification.fields, null, 2)}`,
    `Rejection reasons:\n${classification.reasons.map((reason) => `  - ${reason}`).join("\n")}`,
    "Artifacts without finalized lifecycle evidence are rejected even if a partial URL is present.",
    "Discovery and public-share lifecycle tests are read-only and do not create capsules."
  ].join("\n");
}

function listAvailableArtifactFiles(): string[] {
  return [INSSA_LIFECYCLE_ARTIFACT_DIR, INSSA_LEGACY_LIFECYCLE_ARTIFACT_DIR].flatMap((artifactDir) => {
    if (!existsSync(artifactDir)) {
      return [];
    }

    return readdirSync(artifactDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => {
        const artifactPath = path.join(artifactDir, fileName);
        let descriptor = `${artifactPath}`;

        try {
          const stat = statSync(artifactPath);
          descriptor += ` (${stat.size} bytes, modified ${new Date(stat.mtimeMs).toISOString()})`;
        } catch {
          descriptor += " (stat unavailable)";
        }

        const classification = classifyCreationArtifactPath(artifactPath);
        descriptor += classification.valid
          ? ` [valid creation artifact: ${formatAcceptanceSummary(classification)}]`
          : ` [not a usable creation artifact: ${classification.reasons.join("; ")}]`;
        return descriptor;
      })
      .sort();
  });
}

function logAcceptedArtifact(action: string, artifactPath: string, classification: ArtifactClassification): void {
  const fields = classification.fields;
  const parsed = classification.parsed;
  console.log(`INSSA_LIVE_CAPSULE_ARTIFACT_PATH ${action}: ${artifactPath}`);
  console.log(
    [
      "INSSA_LIVE_CAPSULE_ARTIFACT accepted",
      `runId=${formatUnknown(parsed?.runId)}`,
      `subject=${formatUnknown(parsed?.subject)}`,
      `shareLinkExtracted=${hasExtractedShareEvidence(fields)}`,
      `routeStayedOnTimecapsule=${Boolean(fields?.routeStayedOnTimecapsule)}`,
      "discoveryWillProceed=true"
    ].join(" ")
  );
}

function formatAcceptanceSummary(classification: ArtifactClassification): string {
  const fields = classification.fields;
  return [
    `runId=${formatUnknown(classification.parsed?.runId)}`,
    `shareLinkExtracted=${hasExtractedShareEvidence(fields)}`,
    `routeStayedOnTimecapsule=${Boolean(fields?.routeStayedOnTimecapsule)}`
  ].join(", ");
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
}
