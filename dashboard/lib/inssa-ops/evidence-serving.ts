import path from "node:path";
import type { InssaArtifactRecord } from "./types";
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
  fileName: string;
  relativePath: string;
};

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
  return artifact.artifactType === "Playwright Report" && !artifact.sensitive && normalizedPath === `${PLAYWRIGHT_REPORT_ROOT}/index.html`;
}

export function resolvePlaywrightEvidenceBundleFile(relativePathSegments?: string[]): ResolvedEvidenceBundleFile {
  const relativePath = normalizeBundleRelativePath(relativePathSegments);
  const repoRoot = getRepoRoot();
  const bundleRoot = path.resolve(repoRoot, PLAYWRIGHT_REPORT_ROOT);
  const absolutePath = path.resolve(bundleRoot, relativePath);
  const relativeToBundle = path.relative(bundleRoot, absolutePath);

  if (relativeToBundle.startsWith("..") || path.isAbsolute(relativeToBundle)) {
    throw new InssaEvidenceServingError("Evidence bundle path traversal is blocked.", 403);
  }

  return {
    absolutePath,
    bundleRoot,
    contentType: contentTypeForEvidencePath(relativePath),
    fileName: path.basename(relativePath),
    relativePath
  };
}

export function contentTypeForEvidencePath(filePath: string) {
  return EVIDENCE_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
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
