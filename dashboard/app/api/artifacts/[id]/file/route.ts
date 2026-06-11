import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../lib/inssa-ops/api-guard";
import { getRepoRoot } from "../../../../../lib/inssa-ops/paths";
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
  const artifact = await getInssaRunStore().getArtifact(id);
  if (!artifact) {
    return NextResponse.json({ error: `Artifact not found: ${id}` }, { status: 404 });
  }

  const normalizedPath = artifact.filePath.split(path.sep).join("/");
  if (!SERVABLE_ARTIFACT_TYPES.has(artifact.artifactType) || artifact.sensitive) {
    return NextResponse.json({ error: "Artifact file serving is not enabled for this artifact type." }, { status: 403 });
  }

  if (!SERVABLE_ROOTS.some((root) => normalizedPath.startsWith(root))) {
    return NextResponse.json({ error: "Artifact path is outside the report allowlist." }, { status: 403 });
  }

  const repoRoot = getRepoRoot();
  const absolutePath = path.resolve(repoRoot, normalizedPath);
  const relativeToRoot = path.relative(repoRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return NextResponse.json({ error: "Artifact path traversal is blocked." }, { status: 403 });
  }

  let body: Buffer;
  try {
    body = await fs.readFile(absolutePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return NextResponse.json({ error: "Artifact file no longer exists on disk." }, { status: 404 });
    }
    throw error;
  }

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": artifact.contentType
  });

  if (artifact.artifactType === "SIEM Export") {
    headers.set("content-disposition", `attachment; filename="${path.basename(normalizedPath)}"`);
  } else {
    headers.set("content-disposition", `inline; filename="${path.basename(normalizedPath)}"`);
  }

  return new NextResponse(new Uint8Array(body), { headers });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
