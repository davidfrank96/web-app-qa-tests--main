import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../lib/inssa-ops/api-guard";
import { getInssaRunStore } from "../../../../../lib/inssa-ops/run-store";
import { readUuid, requestErrorResponse } from "../../../../../lib/inssa-ops/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  let id: string;
  try { id = readUuid((await context.params).id, "run id"); } catch (error) { return requestErrorResponse(error); }
  const store = getInssaRunStore();
  const run = await store.getRun(id);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${id}` }, { status: 404 });
  }

  const allArtifacts = await store.getArtifacts(id);
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : allArtifacts.length;
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("cursor")) || 0);
  const artifacts = allArtifacts.slice(offset, offset + limit);
  const nextOffset = offset + artifacts.length;
  return NextResponse.json({
    artifacts,
    pagination: {
      hasMore: nextOffset < allArtifacts.length,
      limit,
      nextCursor: nextOffset < allArtifacts.length ? String(nextOffset) : null,
      total: allArtifacts.length
    }
  });
}
