import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../lib/inssa-ops/api-guard";
import {
  findUploadedEvidenceItem,
  InssaEvidenceServingError,
  isPlaywrightReportArtifact,
  logicalArtifactPath,
  resolveCanonicalFileWithinRoot,
  safeEvidenceFileName
} from "../../../../../lib/inssa-ops/evidence-serving";
import { downloadEvidenceItemFromDurableStorage } from "../../../../../lib/inssa-ops/evidence-storage";
import { getRepoRoot } from "../../../../../lib/inssa-ops/paths";
import { isRedactableContentType, redactInssaTextOutput } from "../../../../../lib/inssa-ops/redaction";
import { getInssaRunStore } from "../../../../../lib/inssa-ops/run-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVABLE_ROOTS = [
  "playwright-report/",
  "reports/security/",
  "reports/lifecycle/",
  "reports/siem/"
];

const SERVABLE_ARTIFACT_TYPES = new Set([
  "Lifecycle Report",
  "Playwright Report",
  "Security Report",
  "SIEM Export"
]);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const store = getInssaRunStore();
  const artifact = await store.getArtifact(id);
  if (!artifact) {
    return NextResponse.json({ error: `Artifact not found: ${id}` }, { status: 404 });
  }

  if (isPlaywrightReportArtifact(artifact)) {
    return new NextResponse(null, {
      headers: {
        location: `/api/artifacts/${id}/bundle/index.html`
      },
      status: 307
    });
  }

  const normalizedPath = artifact.filePath.split(path.sep).join("/");
  const allowlistPath = logicalArtifactPath(artifact);
  if (!SERVABLE_ARTIFACT_TYPES.has(artifact.artifactType) || artifact.sensitive) {
    return NextResponse.json({ error: "Artifact file serving is not enabled for this artifact type." }, { status: 403 });
  }

  const matchedRoot = SERVABLE_ROOTS.find((root) => allowlistPath.startsWith(root));
  if (!matchedRoot || allowlistPath.split("/").includes("..")) {
    return NextResponse.json({ error: "Artifact path is outside the report allowlist." }, { status: 403 });
  }

  const repoRoot = getRepoRoot();
  const absolutePath = path.resolve(repoRoot, normalizedPath);
  const runPrefix = `run-output/${artifact.runId}/`;
  const allowlistRoot = normalizedPath.startsWith(runPrefix)
    ? path.resolve(repoRoot, runPrefix, matchedRoot)
    : path.resolve(repoRoot, matchedRoot);
  const relativeToRoot = path.relative(allowlistRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return NextResponse.json({ error: "Artifact path traversal is blocked." }, { status: 403 });
  }

  let body: Buffer;
  try {
    const canonical = await resolveCanonicalFileWithinRoot(repoRoot, allowlistRoot, absolutePath);
    body = await fs.readFile(canonical.absolutePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      const evidence = await store.getEvidence(artifact.runId);
      const item = findUploadedEvidenceItem(evidence.items, normalizedPath);
      if (!item || item.artifactId !== artifact.id || item.sensitive) {
        return NextResponse.json({ error: "Artifact file is unavailable locally and in durable storage." }, { status: 404 });
      }
      try {
        body = await downloadEvidenceItemFromDurableStorage(item);
      } catch {
        return NextResponse.json({ error: "Durable evidence retrieval or integrity verification failed." }, { status: 502 });
      }
    } else if (error instanceof InssaEvidenceServingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    } else {
      throw error;
    }
  }

  if (isRedactableContentType(artifact.contentType)) {
    body = Buffer.from(redactInssaTextOutput(body), "utf8");
  }

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": artifact.contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
  const downloadName = safeEvidenceFileName(path.basename(normalizedPath));

  if (artifact.artifactType === "SIEM Export") {
    headers.set("content-disposition", `attachment; filename="${downloadName}"`);
  } else {
    headers.set("content-disposition", `inline; filename="${downloadName}"`);
  }

  return new NextResponse(new Uint8Array(body), { headers });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
