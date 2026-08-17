import { NextResponse } from "next/server";
import { dashboardWorkerIsHealthy } from "../../../lib/inssa-ops/live-campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supervisorHealthy = await dashboardWorkerIsHealthy();
  return NextResponse.json(
    {
      metadataBackend: process.env.INSSA_OPS_METADATA_STORE === "supabase" ? "supabase" : "local-json",
      status: supervisorHealthy ? "ok" : "unhealthy",
      supervisor: supervisorHealthy ? "running" : "unavailable",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      web: "alive"
    },
    {
      headers: { "cache-control": "no-store" },
      status: supervisorHealthy ? 200 : 503
    }
  );
}
