import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { recordInssaAuditEvent } from "./audit";
import { getInssaAuthenticatedUser, hasInssaRole, type InssaOpsRole } from "./security";

export async function requireInssaApiUser(request: NextRequest, minRole: InssaOpsRole = "viewer") {
  const user = await getInssaAuthenticatedUser();
  if (!user) {
    await recordInssaAuditEvent({
      eventType: "unauthorized_access_attempt",
      metadata: {
        method: request.method,
        path: request.nextUrl.pathname,
        requiredRole: minRole
      },
      status: "401"
    });
    return {
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
      user: null
    };
  }

  if (!hasInssaRole(user.role, minRole)) {
    await recordInssaAuditEvent({
      eventType: "role_violation_attempt",
      metadata: {
        actualRole: user.role,
        method: request.method,
        path: request.nextUrl.pathname,
        requiredRole: minRole
      },
      status: "403",
      user
    });
    return {
      response: NextResponse.json({ error: `Role ${minRole} or higher is required.` }, { status: 403 }),
      user: null
    };
  }

  return { response: null, user };
}
