import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../../lib/inssa-ops/api-guard";
import { getInssaRunStore } from "../../../../../lib/inssa-ops/run-store";
import { redactInssaLogLine } from "../../../../../lib/inssa-ops/redaction";

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

  const allLogs = await store.getLogs(id);
  const after = Math.max(0, Number(request.nextUrl.searchParams.get("after")) || 0);
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 1_000) : allLogs.length;
  const eligible = allLogs.filter((log) => log.sequence > after);
  const logs = eligible.slice(0, limit).map((log) => ({
    ...log,
    message: redactInssaLogLine(log.message)
  }));
  const lastSequence = logs.at(-1)?.sequence ?? after;
  return NextResponse.json({
    logs,
    pagination: {
      hasMore: eligible.length > logs.length,
      limit,
      nextCursor: eligible.length > logs.length ? String(lastSequence) : null,
      total: allLogs.length
    }
  });
}
