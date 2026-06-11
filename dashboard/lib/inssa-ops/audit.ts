import { getInssaRunStore } from "./run-store";
import type { InssaAuthenticatedUser } from "./security";
import type { InssaAuditEventType } from "./types";

export type InssaAuditInput = {
  campaignKey?: string | null;
  eventType: InssaAuditEventType;
  metadata?: Record<string, unknown>;
  runId?: string | null;
  status?: string | null;
  user?: InssaAuthenticatedUser | null;
};

export async function recordInssaAuditEvent(input: InssaAuditInput) {
  try {
    return await getInssaRunStore().appendAuditEvent({
      actorEmail: input.user?.email ?? null,
      actorUserId: input.user?.id ?? null,
      campaignKey: input.campaignKey ?? null,
      eventType: input.eventType,
      metadata: input.metadata ?? {},
      role: input.user?.role ?? null,
      runId: input.runId ?? null,
      status: input.status ?? null
    });
  } catch (error) {
    console.warn("Failed to persist INSSA audit event", error);
    return null;
  }
}
