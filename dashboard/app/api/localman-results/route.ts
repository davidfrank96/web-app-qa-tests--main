import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { getLocalManDashboardPayload } from "../../../lib/localman-dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const payload = await getLocalManDashboardPayload();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
