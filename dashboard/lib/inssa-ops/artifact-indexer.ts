import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getRepoRoot } from "./paths";
import type { InssaArtifactRecord } from "./types";

const ARTIFACT_ROOTS = [
  "playwright-report",
  "test-results",
  "reports/security",
  "reports/lifecycle",
  "reports/siem",
  "lifecycle-artifacts",
  "lifecycle-campaigns",
  "security-campaigns"
];

type FileCandidate = {
  absolutePath: string;
  modifiedAtMs: number;
  relativePath: string;
  size: number;
};

export async function indexArtifactsForRun(input: {
  completedAtMs: number;
  outputRoot?: string;
  runId: string;
  startedAtMs: number;
}): Promise<InssaArtifactRecord[]> {
  const repoRoot = getRepoRoot();
  const sinceMs = input.startedAtMs - 2_000;
  const untilMs = input.completedAtMs + 2_000;
  const candidates: FileCandidate[] = [];

  if (input.outputRoot) {
    candidates.push(...(await collectFiles(input.outputRoot, repoRoot, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)));
  } else {
    for (const artifactRoot of ARTIFACT_ROOTS) {
      const absoluteRoot = path.join(repoRoot, artifactRoot);
      candidates.push(...(await collectFiles(absoluteRoot, repoRoot, sinceMs, untilMs)));
    }
  }

  const artifacts: InssaArtifactRecord[] = [];
  for (const candidate of dedupeByPath(candidates)) {
    const classification = classifyArtifact(candidate.relativePath, input.outputRoot);
    artifacts.push({
      artifactType: classification.artifactType,
      contentType: classification.contentType,
      createdAt: new Date(candidate.modifiedAtMs).toISOString(),
      filePath: candidate.relativePath,
      fileSize: candidate.size,
      id: crypto.randomUUID(),
      renderInline: classification.renderInline,
      runId: input.runId,
      sensitive: classification.sensitive,
      sha256: await hashFile(candidate.absolutePath)
    });
  }

  return artifacts.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function collectFiles(
  directory: string,
  repoRoot: string,
  sinceMs: number,
  untilMs: number
): Promise<FileCandidate[]> {
  let entries: Array<{
    isDirectory(): boolean;
    isFile(): boolean;
    name: string;
  }>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: FileCandidate[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, repoRoot, sinceMs, untilMs)));
      continue;
    }
    if (!entry.isFile()) continue;

    const stat = await fs.stat(absolutePath);
    if (stat.mtimeMs < sinceMs || stat.mtimeMs > untilMs) continue;

    files.push({
      absolutePath,
      modifiedAtMs: stat.mtimeMs,
      relativePath: path.relative(repoRoot, absolutePath),
      size: stat.size
    });
  }

  return files;
}

export function classifyArtifact(relativePath: string, outputRoot?: string) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  const logicalPath = outputRoot
    ? path.relative(outputRoot, path.join(getRepoRoot(), relativePath)).split(path.sep).join("/")
    : normalizedPath;
  const extension = path.extname(logicalPath).toLowerCase();
  const sensitive =
    logicalPath.startsWith("test-results/") ||
    logicalPath.startsWith("lifecycle-artifacts/") ||
    logicalPath.includes("/cross-user/") ||
    logicalPath.includes("/reveal-later/");

  if (logicalPath === "playwright-report/index.html") {
    return artifactClass("Playwright Report", "text/html", false, true);
  }
  if (logicalPath.startsWith("reports/security/") && extension === ".html") {
    return artifactClass("Security Report", "text/html", false, true);
  }
  if (logicalPath.startsWith("reports/lifecycle/") && extension === ".html") {
    return artifactClass("Lifecycle Report", "text/html", false, true);
  }
  if (logicalPath.startsWith("reports/siem/") && extension === ".json") {
    return artifactClass("SIEM Export", "application/json", false, false);
  }
  if (logicalPath.startsWith("lifecycle-campaigns/") && extension === ".json") {
    return artifactClass("Campaign Summary", "application/json", false, false);
  }
  if (logicalPath.startsWith("security-campaigns/") && extension === ".json") {
    return artifactClass("Campaign Summary", "application/json", sensitive, false);
  }
  if (isImageExtension(extension)) {
    return artifactClass("Screenshot", contentTypeForExtension(extension), sensitive, !sensitive);
  }
  if (extension === ".zip" || logicalPath.endsWith(".trace.zip")) {
    return artifactClass("Trace", "application/zip", true, false);
  }
  if ([".webm", ".mp4", ".mov"].includes(extension)) {
    return artifactClass("Video", contentTypeForExtension(extension), true, false);
  }
  if (extension === ".json") {
    return artifactClass("JSON Artifact", "application/json", sensitive, false);
  }
  if (extension === ".html") {
    return artifactClass("HTML Report", "text/html", sensitive, !sensitive);
  }
  if (extension === ".md") {
    return artifactClass("Text Artifact", "text/markdown", sensitive, false);
  }

  return artifactClass("Other Artifact", "application/octet-stream", sensitive, false);
}

function artifactClass(artifactType: string, contentType: string, sensitive: boolean, renderInline: boolean) {
  return {
    artifactType,
    contentType,
    renderInline,
    sensitive
  };
}

async function hashFile(filePath: string) {
  const body = await fs.readFile(filePath);
  return createHash("sha256").update(body).digest("hex");
}

function dedupeByPath(candidates: FileCandidate[]) {
  return [...new Map(candidates.map((candidate) => [candidate.relativePath, candidate])).values()];
}

function isImageExtension(extension: string) {
  return [".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension);
}

function contentTypeForExtension(extension: string) {
  const types: Record<string, string> = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".webm": "video/webm",
    ".webp": "image/webp"
  };
  return types[extension] ?? "application/octet-stream";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
