import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../lib/inssa-ops/api-guard";
import { readOperationsUsage } from "../../../../lib/inssa-ops/usage-status";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "admin");
  if (auth.response) return auth.response;
  try { return NextResponse.json(await readOperationsUsage(), { headers: { "cache-control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Usage metrics unavailable; no quota decision can be made." }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
