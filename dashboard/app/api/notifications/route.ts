import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { getNotificationOutboxStore } from "../../../lib/inssa-ops/notification-outbox";
import type { NotificationOutboxStatus, NotificationSeverity } from "../../../lib/inssa-ops/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES = new Set<NotificationOutboxStatus>(["pending", "processing", "delivered", "failed", "dead_letter"]);
const SEVERITIES = new Set<NotificationSeverity>(["informational", "low", "medium", "high", "critical"]);

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const search = request.nextUrl.searchParams;
  const status = search.get("status");
  const severity = search.get("severity");
  if (status && !STATUSES.has(status as NotificationOutboxStatus)) {
    return NextResponse.json({ error: `Unsupported notification status: ${status}` }, { status: 400 });
  }
  if (severity && !SEVERITIES.has(severity as NotificationSeverity)) {
    return NextResponse.json({ error: `Unsupported notification severity: ${severity}` }, { status: 400 });
  }

  const limit = readBoundedInteger(search.get("limit"), 50, 1, 100);
  const cursor = readBoundedInteger(search.get("cursor"), 0, 0, Number.MAX_SAFE_INTEGER);
  try {
    const page = await getNotificationOutboxStore().list(
      {
        campaign: clean(search.get("campaign")),
        environment: clean(search.get("environment")),
        product: clean(search.get("product")),
        runId: clean(search.get("run")),
        severity: (severity as NotificationSeverity | null) ?? undefined,
        status: (status as NotificationOutboxStatus | null) ?? undefined
      },
      cursor,
      limit
    );
    return NextResponse.json({ notifications: page.items, pagination: page.pagination });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function clean(value: string | null) {
  return value?.trim() || undefined;
}

function readBoundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? Math.min(parsed, maximum) : fallback;
}
