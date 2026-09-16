import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { certifyExecutionPlan, RETENTION_LIMITS } from "./retention-executor";
import { InssaRequestError } from "./request-security";
import type { RetentionPlan } from "./retention-types";

export const RETENTION_CONFIRMATION = "DELETE ELIGIBLE EVIDENCE";
type Approval = { userId: string; revision: string; policy: string; bundleIds: string[]; expiresAt: number; occurrence: string };
export type RetentionPreview = { token: string; bundles: number; objects: number; bytes: number; expiresAt: string };
function sign(payload: string) {
  const key = process.env.INSSA_AUTH_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length < 32) throw new Error("Retention confirmation signing is unavailable.");
  return createHmac("sha256", key).update(`retention-manual-v3:${payload}`).digest();
}
export function createRetentionPreview(plan: RetentionPlan, userId: string, now = Date.now()): RetentionPreview | null {
  certifyExecutionPlan(plan);
  const bundleIds: string[] = [];
  let bytes = 0, objects = 0;
  for (const row of plan.bundles.filter((b) => b.eligibilityReason === "ELIGIBLE")) {
    if (bundleIds.length >= RETENTION_LIMITS.bundles || objects + row.objectCount > RETENTION_LIMITS.objects || bytes + row.bytes > RETENTION_LIMITS.bytes) break;
    bundleIds.push(row.bundleId); bytes += row.bytes; objects += row.objectCount;
  }
  if (!bundleIds.length) return null;
  const approval: Approval = { userId, revision: plan.snapshotRevision, policy: plan.policyVersion, bundleIds, expiresAt: now + 300_000, occurrence: `manual:${randomUUID()}` };
  const payload = Buffer.from(JSON.stringify(approval)).toString("base64url");
  return { token: `${payload}.${sign(payload).toString("base64url")}`, bundles: bundleIds.length, objects, bytes, expiresAt: new Date(approval.expiresAt).toISOString() };
}
export function verifyRetentionConfirmation(token: unknown, phrase: unknown, userId: string, now = Date.now()): Approval {
  const invalid = () => new InssaRequestError("Retention confirmation is invalid or expired. Refresh and review the eligible batch again.", 409);
  if (phrase !== RETENTION_CONFIRMATION || typeof token !== "string" || token.length > 20_000) throw invalid();
  const parts = token.split(".");
  if (parts.length !== 2) throw invalid();
  const actual = Buffer.from(parts[1], "base64url"), expected = sign(parts[0]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  try {
    const approval = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Approval;
    if (approval.userId !== userId || approval.policy !== "evidence-retention-v3" || !Number.isFinite(approval.expiresAt) ||
        approval.expiresAt <= now || approval.expiresAt > now + 300_000 || typeof approval.revision !== "string" ||
        !/^manual:[a-f0-9-]{36}$/.test(approval.occurrence) || !Array.isArray(approval.bundleIds) || !approval.bundleIds.length ||
        approval.bundleIds.length > RETENTION_LIMITS.bundles || approval.bundleIds.some((id) => typeof id !== "string")) throw invalid();
    return approval;
  } catch { throw invalid(); }
}
