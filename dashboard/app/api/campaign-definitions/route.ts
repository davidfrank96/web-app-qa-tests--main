import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { listInssaPhase1Commands } from "../../../lib/inssa-ops/command-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  return NextResponse.json({
    campaignDefinitions: listInssaPhase1Commands()
  });
}
