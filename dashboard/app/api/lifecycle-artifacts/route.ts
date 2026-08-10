import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { listInssaLifecycleArtifactOptions } from "../../../lib/inssa-ops/lifecycle-artifact-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  return NextResponse.json({
    artifacts: await listInssaLifecycleArtifactOptions()
  });
}
