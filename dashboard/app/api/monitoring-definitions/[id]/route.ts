import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../lib/inssa-ops/api-guard";
import { getMonitoringDefinitionStore } from "../../../../lib/monitoring/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    const definition = await getMonitoringDefinitionStore().get(id);
    if (!definition) return NextResponse.json({ error: `Monitoring definition not found: ${id}` }, { status: 404 });
    return NextResponse.json({ monitoringDefinition: definition });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
