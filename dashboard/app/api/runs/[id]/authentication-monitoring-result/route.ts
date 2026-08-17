import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../lib/inssa-ops/api-guard";
import { getInssaRunStore } from "../../../../../lib/inssa-ops/run-store";
import { readUuid, requestErrorResponse } from "../../../../../lib/inssa-ops/request-security";
import { loadAuthenticationMonitoringResult } from "../../../../../lib/monitoring/authentication-result-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  let id: string;
  try { id = readUuid((await context.params).id, "run id"); } catch (error) { return requestErrorResponse(error); }
  try {
    const resolution = await loadAuthenticationMonitoringResult(getInssaRunStore(), id);
    if (!resolution) {
      return NextResponse.json({ error: `Run not found: ${id}` }, { status: 404 });
    }
    return NextResponse.json(resolution, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("is not an Authentication Monitoring run") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
