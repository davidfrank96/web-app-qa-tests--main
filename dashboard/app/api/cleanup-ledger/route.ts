import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { synchronizeConfiguredCleanupLedger } from "../../../lib/inssa-ops/cleanup-ledger";
import { getInssaRunStore } from "../../../lib/inssa-ops/run-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  try {
    const store = getInssaRunStore();
    await synchronizeConfiguredCleanupLedger(undefined, store);
    const records = await store.listCleanupLedger();
    return NextResponse.json({
      banner: "INSSA staging cleanup is deferred because direct database access is unavailable.",
      records
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), records: [] },
      { status: 500 }
    );
  }
}
