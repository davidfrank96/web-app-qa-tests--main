import fs from "node:fs/promises";
import path from "node:path";
import { getRepoRoot } from "./paths";
import type {
  InssaLifecycleArtifactSelection,
  ResolvedInssaLifecycleArtifactSelection
} from "./types";

export type InssaLifecycleArtifactOption = {
  artifactType: string;
  createdAt: string | null;
  filePath: string;
  fileSize: number;
  artifactValidationReady: boolean;
  modifiedAt: string;
  observedCreateSuccess: boolean;
  runId: string | null;
  subject: string | null;
  timestamp: string;
};

const LIFECYCLE_ARTIFACT_ROOT = "lifecycle-artifacts";

export async function listInssaLifecycleArtifactOptions(): Promise<InssaLifecycleArtifactOption[]> {
  const repoRoot = getRepoRoot();
  const artifactRoot = path.join(repoRoot, LIFECYCLE_ARTIFACT_ROOT);
  let entries: string[];
  try {
    entries = await fs.readdir(artifactRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const options = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => readArtifactOption(repoRoot, artifactRoot, entry))
  );

  return options
    .filter((option): option is InssaLifecycleArtifactOption => Boolean(option))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export async function resolveInssaLifecycleArtifactSelection(
  selection: InssaLifecycleArtifactSelection | null | undefined
): Promise<{ error: string; status: 400 | 404 } | { artifact: ResolvedInssaLifecycleArtifactSelection }> {
  const options = await listInssaLifecycleArtifactOptions();
  const usableOptions = options.filter((option) => option.artifactValidationReady);

  if (!selection || (selection.mode !== "explicit" && selection.mode !== "latest")) {
    return {
      error: "Artifact Validation requires explicit lifecycle artifact selection or latest-artifact mode.",
      status: 400
    };
  }

  if (selection.mode === "latest") {
    const latest = usableOptions[0];
    if (!latest) {
      return {
        error: "No usable lifecycle artifact is available for latest-artifact mode.",
        status: 404
      };
    }
    return { artifact: toResolvedSelection(latest) };
  }

  const requestedPath = normalizeArtifactPath(selection.path ?? "");
  if (!requestedPath) {
    return {
      error: "Explicit artifact selection requires a lifecycle artifact path.",
      status: 400
    };
  }

  const match = usableOptions.find((option) => option.filePath === requestedPath);
  if (!match) {
    return {
      error: `Selected artifact is not available or is not a successful lifecycle artifact: ${requestedPath}`,
      status: 404
    };
  }

  return { artifact: toResolvedSelection(match) };
}

function toResolvedSelection(option: InssaLifecycleArtifactOption): ResolvedInssaLifecycleArtifactSelection {
  return {
    artifactType: option.artifactType,
    filePath: option.filePath,
    timestamp: option.timestamp
  };
}

async function readArtifactOption(repoRoot: string, artifactRoot: string, entry: string) {
  const absolutePath = path.join(artifactRoot, entry);
  const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join("/");
  if (!relativePath.startsWith(`${LIFECYCLE_ARTIFACT_ROOT}/`) || relativePath.includes("..")) return null;

  try {
    const [stat, body] = await Promise.all([fs.stat(absolutePath), fs.readFile(absolutePath, "utf8")]);
    const artifact = JSON.parse(body) as Record<string, unknown>;
    const modifiedAt = new Date(stat.mtimeMs).toISOString();
    const createdAt = typeof artifact.createdAt === "string" ? artifact.createdAt : null;
    return {
      artifactType: classifyLifecycleArtifact(entry, artifact),
      artifactValidationReady: isArtifactValidationReady(artifact),
      createdAt,
      filePath: relativePath,
      fileSize: stat.size,
      modifiedAt,
      observedCreateSuccess: artifact.observedCreateSuccess === true,
      runId: typeof artifact.runId === "string" ? artifact.runId : null,
      subject: typeof artifact.subject === "string" ? artifact.subject : null,
      timestamp: createdAt ?? modifiedAt
    };
  } catch {
    return null;
  }
}

function isArtifactValidationReady(artifact: Record<string, unknown>) {
  return (
    artifact.observedCreateSuccess === true &&
    (typeof artifact.finalShareLink === "string" ||
      typeof artifact.possibleFinalCapsuleId === "string" ||
      typeof artifact.possibleShareToken === "string")
  );
}

function classifyLifecycleArtifact(fileName: string, artifact: Record<string, unknown>) {
  const subject = typeof artifact.subject === "string" ? artifact.subject : "";
  if (fileName.includes("reveal-later") || subject.startsWith("QA_REVEAL_LATER_CAPSULE_")) return "reveal-later";
  if (fileName.includes("video") || subject.startsWith("QA_LIVE_VIDEO_CAPSULE_")) return "video";
  if (fileName.includes("media") || subject.startsWith("QA_LIVE_MEDIA_CAPSULE_")) return "media";
  if (fileName.includes("contact-share")) return "contact-share";
  return "text";
}

function normalizeArtifactPath(input: string) {
  const normalized = input.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) return "";
  if (!normalized.startsWith(`${LIFECYCLE_ARTIFACT_ROOT}/`) || !normalized.endsWith(".json")) return "";
  return normalized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
