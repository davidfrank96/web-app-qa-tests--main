import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../../lib/inssa-ops/api-guard";
import { getNotificationOutboxStore } from "../../../../lib/inssa-ops/notification-outbox";
import { readUuid, requestErrorResponse } from "../../../../lib/inssa-ops/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  let id: string;
  try { id = readUuid((await context.params).id, "notification id"); } catch (error) { return requestErrorResponse(error); }
  try {
    const notification = await getNotificationOutboxStore().get(id);
    if (!notification) return NextResponse.json({ error: `Notification not found: ${id}` }, { status: 404 });
    return NextResponse.json({ notification });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
