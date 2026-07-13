import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../lib/inssa-ops/api-guard";
import { getInssaRunStore } from "../../../../../lib/inssa-ops/run-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const store = getInssaRunStore();
  const run = await store.getRun(id);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${id}` }, { status: 404 });
  }

  const evidence = await store.getEvidence(id);
  return NextResponse.json(evidence);
}
