import { NextResponse } from "next/server";
import { getLocalManDashboardPayload } from "../../../lib/localman-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getLocalManDashboardPayload();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
