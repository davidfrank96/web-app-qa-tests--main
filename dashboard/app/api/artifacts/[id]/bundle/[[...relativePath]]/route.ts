import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../../lib/inssa-ops/api-guard";
import {
  InssaEvidenceServingError,
  isPlaywrightReportArtifact,
  resolvePlaywrightEvidenceBundleFile,
  safeEvidenceFileName
} from "../../../../../../lib/inssa-ops/evidence-serving";
import { getInssaRunStore } from "../../../../../../lib/inssa-ops/run-store";
import { isRedactableContentType, redactInssaTextOutput } from "../../../../../../lib/inssa-ops/redaction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; relativePath?: string[] }> }
) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const { id, relativePath } = await context.params;
  const artifact = await getInssaRunStore().getArtifact(id);
  if (!artifact) {
    return NextResponse.json({ error: `Artifact not found: ${id}` }, { status: 404 });
  }

  if (!isPlaywrightReportArtifact(artifact)) {
    return NextResponse.json({ error: "Bundle serving is only enabled for Playwright report artifacts." }, { status: 403 });
  }

  let resolved;
  try {
    resolved = await resolvePlaywrightEvidenceBundleFile(artifact, relativePath);
  } catch (error) {
    if (error instanceof InssaEvidenceServingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  let file;
  try {
    file = await fs.readFile(resolved.absolutePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return NextResponse.json({ error: "Evidence bundle file no longer exists on disk." }, { status: 404 });
    }
    if (isNodeError(error) && error.code === "EISDIR") {
      return NextResponse.json({ error: "Evidence bundle directory listing is not enabled." }, { status: 403 });
    }
    throw error;
  }

  if (isRedactableContentType(resolved.contentType)) {
    file = Buffer.from(redactInssaTextOutput(file), "utf8");
  }

  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-disposition": `inline; filename="${safeEvidenceFileName(resolved.fileName)}"`,
    "content-type": resolved.contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });

  const range = parseByteRange(request.headers.get("range"), file.byteLength);
  if (range === "invalid") {
    headers.set("content-range", `bytes */${file.byteLength}`);
    return new NextResponse(null, { headers, status: 416 });
  }

  if (range) {
    headers.set("content-length", String(range.end - range.start + 1));
    headers.set("content-range", `bytes ${range.start}-${range.end}/${file.byteLength}`);
    return new NextResponse(new Uint8Array(file.subarray(range.start, range.end + 1)), {
      headers,
      status: 206
    });
  }

  headers.set("content-length", String(file.byteLength));
  return new NextResponse(new Uint8Array(file), { headers });
}

function parseByteRange(rangeHeader: string | null, fileSize: number) {
  if (!rangeHeader) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return "invalid" as const;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "invalid" as const;

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid" as const;
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : fileSize - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
    return "invalid" as const;
  }

  return {
    end: Math.min(end, fileSize - 1),
    start
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
