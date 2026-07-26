import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { getMonitoringDefinitionStore } from "../../../lib/monitoring/store";
import type { MonitoringSeverity, MonitoringTriggerType } from "../../../lib/monitoring/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRIGGER_TYPES = new Set<MonitoringTriggerType>(["manual", "schedule", "api", "deployment", "webhook", "future"]);
const SEVERITIES = new Set<MonitoringSeverity>(["informational", "low", "medium", "high", "critical"]);

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const search = request.nextUrl.searchParams;
  const triggerType = search.get("triggerType");
  const severity = search.get("severity");
  const enabled = search.get("enabled");
  if (triggerType && !TRIGGER_TYPES.has(triggerType as MonitoringTriggerType)) {
    return NextResponse.json({ error: `Unsupported monitoring trigger type: ${triggerType}` }, { status: 400 });
  }
  if (severity && !SEVERITIES.has(severity as MonitoringSeverity)) {
    return NextResponse.json({ error: `Unsupported monitoring severity: ${severity}` }, { status: 400 });
  }
  if (enabled && enabled !== "true" && enabled !== "false") {
    return NextResponse.json({ error: `Unsupported enabled filter: ${enabled}` }, { status: 400 });
  }

  const limit = readBoundedInteger(search.get("limit"), 50, 1, 100);
  const cursor = readBoundedInteger(search.get("cursor"), 0, 0, Number.MAX_SAFE_INTEGER);
  try {
    const page = await getMonitoringDefinitionStore().list(
      {
        campaignId: clean(search.get("campaign")),
        enabled: enabled ? enabled === "true" : undefined,
        environment: clean(search.get("environment")),
        product: clean(search.get("product")),
        severity: (severity as MonitoringSeverity | null) ?? undefined,
        triggerType: (triggerType as MonitoringTriggerType | null) ?? undefined
      },
      cursor,
      limit
    );
    return NextResponse.json({ monitoringDefinitions: page.items, pagination: page.pagination });
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
