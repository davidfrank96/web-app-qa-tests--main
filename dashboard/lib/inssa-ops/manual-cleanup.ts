import type { InssaRunStore } from "./run-store";
import type { InssaAuthenticatedUser } from "./security";
import { InssaRequestError } from "./request-security";
import { redactInssaLogLine } from "./redaction";

export const MANUAL_CLEANUP_CONFIRMATION = "DELETED FROM INSSA STAGING";

// Records an operator's attestation only. Never calls the INSSA product backend.
export async function confirmManualCleanupRecord(store: InssaRunStore, user: InssaAuthenticatedUser, input: {
  recordId: string; objectId: string; runId: string; confirmationPhrase: unknown; note?: unknown;
}) {
  if (user.role !== "admin") throw new InssaRequestError("Admin role required.", 403);
  if (input.confirmationPhrase !== MANUAL_CLEANUP_CONFIRMATION) throw new InssaRequestError("Explicit deletion confirmation required.", 400);
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 500)) throw new InssaRequestError("Note must be at most 500 characters.", 400);
  const record = await store.getCleanupLedgerRecord(input.recordId);
  if (!record || record.objectId !== input.objectId || record.originatingRunId !== input.runId || record.environment !== "staging") {
    throw new InssaRequestError("Staging object and originating run must match the ledger.", 400);
  }
  const run = await store.getRun(record.originatingRunId);
  if (run && ["queued", "starting", "running", "indexing_artifacts"].includes(run.status)) throw new InssaRequestError("Cleanup cannot be confirmed while the run is active.", 409);
  if (record.status === "completed") return record;
  const confirmedAt = new Date().toISOString(), confirmedBy = user.email || user.id;
  const note = redactInssaLogLine(typeof input.note === "string" ? input.note.trim() : "");
  // Await the durable audit write before updating status; an audit outage fails closed.
  await store.appendAuditEvent({ actorEmail: user.email, actorUserId: user.id, role: user.role,
    campaignKey: record.campaignKey, eventType: "cleanup_verified", runId: run?.id ?? null, status: "operator_confirmed",
    metadata: { objectId: record.objectId, objectPath: record.objectPath, originatingRunId: record.originatingRunId, confirmedBy, confirmedAt, note } });
  return store.upsertCleanupLedger({ ...record, status: "completed", resolvedAt: confirmedAt, updatedAt: confirmedAt,
    notes: [record.notes, `Manual deletion confirmed by ${confirmedBy} at ${confirmedAt}.`, note].filter(Boolean).join("\n") });
}
