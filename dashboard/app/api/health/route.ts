import { NextResponse } from "next/server";
import { getPlatformHealth } from "../../../lib/inssa-ops/platform-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const health = await getPlatformHealth();
  return NextResponse.json(health, {
    headers: { "cache-control": "no-store" }, status: health.status === "ok" ? 200 : 503
  });
}
