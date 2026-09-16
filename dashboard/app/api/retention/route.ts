import { createRetentionPreview } from "../../../lib/inssa-ops/retention-confirmation";
import { readRetentionHealth } from "../../../lib/inssa-ops/retention-service";
import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { evaluateRetention } from "../../../lib/inssa-ops/retention";
import { createRetentionReader, readRetentionSnapshot } from "../../../lib/inssa-ops/retention-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "admin");
  if (auth.response) return auth.response;
  try {
    const plan = evaluateRetention(await readRetentionSnapshot(createRetentionReader()), new Date().toISOString());
    let executionPreview = null;
    try { executionPreview = createRetentionPreview(plan, auth.user.id); } catch { /* Planning stays read-only when execution cannot be certified. */ }
    return NextResponse.json({ ...plan, executionPreview, maintenance: await readRetentionHealth() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Retention metadata is unavailable. No eligibility decision can be made; refresh to retry." },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}
