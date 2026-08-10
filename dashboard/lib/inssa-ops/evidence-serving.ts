import fs from "node:fs/promises";
import path from "node:path";
import type { InssaArtifactRecord, InssaEvidenceItemRecord } from "./types";
import { getRepoRoot } from "./paths";

export const PLAYWRIGHT_REPORT_ROOT = "playwright-report";

export class InssaEvidenceServingError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "InssaEvidenceServingError";
  }
}

export type ResolvedEvidenceBundleFile = {
  absolutePath: string;
  bundleRoot: string;
  contentType: string;
  evidenceItemPath: string;
  fileName: string;
  relativePath: string;
};

export type ResolvedEvidenceBundlePath = Omit<ResolvedEvidenceBundleFile, "absolutePath" | "bundleRoot">;

const EVIDENCE_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".trace": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".zip": "application/zip"
};

export function isPlaywrightReportArtifact(artifact: InssaArtifactRecord) {
  const normalizedPath = artifact.filePath.split(path.sep).join("/");
  return artifact.artifactType === "Playwright Report" && !artifact.sensitive &&
    (normalizedPath === `${PLAYWRIGHT_REPORT_ROOT}/index.html` ||
      normalizedPath.endsWith(`/${PLAYWRIGHT_REPORT_ROOT}/index.html`));
}

export async function resolvePlaywrightEvidenceBundleFile(
  artifact: InssaArtifactRecord,
  relativePathSegments?: string[]
): Promise<ResolvedEvidenceBundleFile> {
  const logical = resolvePlaywrightEvidenceBundlePath(artifact, relativePathSegments);
  const repoRoot = getRepoRoot();
  const artifactPath = path.resolve(repoRoot, artifact.filePath);
  assertInsideRepo(repoRoot, artifactPath);
  const bundleRoot = path.dirname(artifactPath);
  const absolutePath = path.resolve(bundleRoot, logical.relativePath);
  const relativeToBundle = path.relative(bundleRoot, absolutePath);

  if (relativeToBundle.startsWith("..") || path.isAbsolute(relativeToBundle)) {
    throw new InssaEvidenceServingError("Evidence bundle path traversal is blocked.", 403);
  }

  const canonical = await resolveCanonicalFileWithinRoot(repoRoot, bundleRoot, absolutePath);

  return {
    ...logical,
    absolutePath: canonical.absolutePath,
    bundleRoot: canonical.allowedRoot
  };
}

export function resolvePlaywrightEvidenceBundlePath(
  artifact: InssaArtifactRecord,
  relativePathSegments?: string[]
): ResolvedEvidenceBundlePath {
  const relativePath = normalizeBundleRelativePath(relativePathSegments);
  const normalizedArtifactPath = artifact.filePath.split(path.sep).join("/");
  const runPrefix = `run-output/${artifact.runId}/`;
  const expectedIndexPath = normalizedArtifactPath.startsWith(runPrefix)
    ? `${runPrefix}${PLAYWRIGHT_REPORT_ROOT}/index.html`
    : `${PLAYWRIGHT_REPORT_ROOT}/index.html`;
  if (normalizedArtifactPath !== expectedIndexPath) {
    throw new InssaEvidenceServingError("Playwright evidence metadata does not identify a valid bundle root.", 403);
  }

  return {
    contentType: contentTypeForEvidencePath(relativePath),
    evidenceItemPath: path.posix.join(path.posix.dirname(normalizedArtifactPath), relativePath),
    fileName: path.posix.basename(relativePath),
    relativePath
  };
}

export function findUploadedEvidenceItem(
  items: InssaEvidenceItemRecord[],
  relativePath: string
): InssaEvidenceItemRecord | null {
  const normalizedPath = relativePath.split(path.sep).join("/");
  return items.find((item) =>
    item.relativePath.split(path.sep).join("/") === normalizedPath &&
    item.storageBackend === "supabase-storage" &&
    item.uploadStatus === "uploaded" &&
    Boolean(item.storageKey)
  ) ?? null;
}

export async function resolveCanonicalFileWithinRoot(repoRoot: string, allowedRoot: string, targetPath: string) {
  const [canonicalRepoRoot, canonicalAllowedRoot, canonicalTarget] = await Promise.all([
    fs.realpath(repoRoot),
    fs.realpath(allowedRoot),
    fs.realpath(targetPath)
  ]);
  assertInsideCanonicalRoot(canonicalRepoRoot, canonicalAllowedRoot, "Evidence allowlist root escapes the repository.");
  assertInsideCanonicalRoot(canonicalAllowedRoot, canonicalTarget, "Evidence path escapes its canonical allowlist root.");
  return {
    absolutePath: canonicalTarget,
    allowedRoot: canonicalAllowedRoot,
    repoRoot: canonicalRepoRoot
  };
}

export function logicalArtifactPath(artifact: InssaArtifactRecord) {
  const normalized = artifact.filePath.split(path.sep).join("/");
  const runPrefix = `run-output/${artifact.runId}/`;
  return normalized.startsWith(runPrefix) ? normalized.slice(runPrefix.length) : normalized;
}

export function contentTypeForEvidencePath(filePath: string) {
  return EVIDENCE_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function safeEvidenceFileName(fileName: string) {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180) || "evidence";
}

function normalizeBundleRelativePath(relativePathSegments?: string[]) {
  const joined = relativePathSegments?.length ? relativePathSegments.join("/") : "index.html";
  const unixPath = joined.replaceAll("\\", "/");

  if (!unixPath.trim() || unixPath.includes("\0") || unixPath.startsWith("/")) {
    throw new InssaEvidenceServingError("Invalid evidence bundle path.", 400);
  }

  const normalized = path.posix.normalize(unixPath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new InssaEvidenceServingError("Evidence bundle path traversal is blocked.", 403);
  }

  return normalized;
}

function assertInsideRepo(repoRoot: string, absolutePath: string) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new InssaEvidenceServingError("Evidence bundle path escapes the repository.", 403);
  }
}

function assertInsideCanonicalRoot(root: string, target: string, message: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new InssaEvidenceServingError(message, 403);
  }
}
