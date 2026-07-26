import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../lib/inssa-ops/api-guard";
import { getSchedulerStore } from "../../../../lib/monitoring/scheduler-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  try {
    const intervalMs = readPositiveInteger(process.env.INSSA_SCHEDULER_INTERVAL_MS, 60_000);
    const scheduler = await getSchedulerStore().getStatus(Math.max(intervalMs * 3, 180_000));
    return NextResponse.json({ scheduler });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : fallback;
}
