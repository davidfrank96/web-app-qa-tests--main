import { evaluateRetention, retentionSourceSignature, RETENTION_POLICY_VERSION } from "./retention";
import type { RetentionObject, RetentionPlan, RetentionSnapshot } from "./retention-types";

export const RETENTION_LIMITS = { bundles: 100, objects: 5000, bytes: 2_000_000_000 } as const;
export type RetentionExecutorIO = {
  snapshot(): Promise<RetentionSnapshot>;
  claim(id: string, owner: string, automatic: boolean): Promise<{ status: string }>;
  heartbeat(id: string, owner: string): Promise<void>;
  reserve(input: { occurrence: string; owner: string; snapshot: RetentionSnapshot; bundleId: string; signature: string; planId: string; objects: RetentionObject[] }): Promise<{ status: string; remaining?: RetentionObject[] }>;
  remove(keys: string[]): Promise<void>;
  verifyAbsent(keys: string[]): Promise<void>;
  settle(id: string, owner: string, bundle: string, success: boolean, error: string | null): Promise<unknown>;
  finish(id: string, owner: string, error: string | null, protectedCount: number, reviewCount: number): Promise<unknown>;
};
export function certifyExecutionPlan(plan: RetentionPlan) {
  if (plan.policyVersion !== RETENTION_POLICY_VERSION || plan.routineDays !== 21 || plan.comparisonOnly || plan.reviewReasons.length ||
      !plan.summary.storageSizeComplete) throw new Error("Retention v2 execution certification failed; no deletion authorized by this plan.");
}
export function retentionComparison(snapshot: RetentionSnapshot, asOf = new Date().toISOString()) {
  return { thirtyDays: evaluateRetention(snapshot, asOf, { routineDays: 30 }),
    twentyOneDays: evaluateRetention(snapshot, asOf), fourteenDays: evaluateRetention(snapshot, asOf, { routineDays: 14 }) };
}
export function dueRetentionOccurrence(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) >= 90 ? `daily:${parts.year}-${parts.month}-${parts.day}` : null;
}

// No input candidate list is trusted: every bundle gets a NEW consistent plan. SQL reserve
// compares its revision and gates concurrent safety changes before the first Storage call.
export async function executeRetention(io: RetentionExecutorIO, input: { occurrence: string; owner: string; automatic?: boolean; signal?: AbortSignal; now?: () => Date }) {
  const now = input.now ?? (() => new Date());
  const claim = await io.claim(input.occurrence, input.owner, input.automatic ?? false);
  if (claim.status !== "RUNNING") return claim;
  let heartbeatFailure: unknown = null;
  let heartbeatPending: Promise<void> | null = null;
  const heartbeat = () => heartbeatPending ??= io.heartbeat(input.occurrence, input.owner).finally(() => { heartbeatPending = null; });
  const timer = setInterval(() => { void heartbeat().catch((error) => { heartbeatFailure = error; }); }, 15_000);
  timer.unref();
  const assertOwned = async () => {
    input.signal?.throwIfAborted();
    if (heartbeatFailure) throw new Error("Retention ownership heartbeat failed.");
    await heartbeat();
  };
  let error: string | null = null, protectedCount = 0, reviewCount = 0;
  let currentBundle: string | null = null;
  let bundles = 0, objects = 0, bytes = 0;
  const attempted = new Set<string>();
  let initialCandidates: Set<string> | null = null;
  try {
    for (;;) {
      await assertOwned();
      const snapshot = await io.snapshot();
      const plan = evaluateRetention(snapshot, now().toISOString());
      certifyExecutionPlan(plan);
      protectedCount = plan.summary.protectedBundles; reviewCount = plan.summary.reviewRequiredBundles;
      initialCandidates ??= new Set(plan.bundles.filter((b) => b.eligibilityReason === "ELIGIBLE").map((b) => b.bundleId));
      const candidate = plan.bundles.find((b) => b.eligibilityReason === "ELIGIBLE" && initialCandidates!.has(b.bundleId) && !attempted.has(b.bundleId));
      if (!candidate || bundles >= RETENTION_LIMITS.bundles) break;
      const bundle = snapshot.bundles.find((b) => b.id === candidate.bundleId)!;
      const items = snapshot.items.filter((i) => i.bundleId === bundle.id);
      const pending = snapshot.deletions.find((d) => d.bundleId === bundle.id);
      const exactObjects = pending?.expectedObjects ?? items.map((i) => snapshot.objects.find((o) => o.name === i.storageKey)!);
      const remaining = exactObjects.filter((o) => snapshot.objects.some((s) => s.name === o.name));
      const remainingBytes = remaining.reduce((n, o) => n + o.sizeBytes!, 0);
      if (objects + remaining.length > RETENTION_LIMITS.objects || bytes + remainingBytes > RETENTION_LIMITS.bytes) break;
      await assertOwned();
      const reserved = await io.reserve({ occurrence: input.occurrence, owner: input.owner, snapshot, bundleId: bundle.id,
        signature: retentionSourceSignature(bundle, items), planId: plan.planId, objects: exactObjects });
      if (reserved.status === "BUDGET_REACHED") break;
      if (reserved.status !== "RESERVED" || !reserved.remaining) throw new Error("Retention reservation failed.");
      currentBundle = bundle.id; attempted.add(bundle.id); bundles++; objects += remaining.length; bytes += remainingBytes;
      let deletionError: unknown = null;
      try {
        for (let i = 0; i < reserved.remaining.length; i += 100) {
          await assertOwned();
          await io.remove(reserved.remaining.slice(i, i + 100).map((o) => o.name));
        }
      } catch (failure) { deletionError = failure; }
      try {
        await assertOwned();
        // Verify even when DELETE returned an ambiguous error or a prior attempt removed every object.
        await io.verifyAbsent(exactObjects.map((o) => o.name));
        await assertOwned();
        await io.settle(input.occurrence, input.owner, bundle.id, true, null);
      } catch (failure) {
        // Preserve manifest and intent. The next occurrence evaluates fresh protections and sends only remaining keys.
        await io.settle(input.occurrence, input.owner, bundle.id, false,
          deletionError ? "Storage deletion incomplete; remaining objects require retry." : "Storage absence or metadata finalization could not be verified.");
        if (heartbeatFailure || input.signal?.aborted) throw failure;
      }
      currentBundle = null;
    }
  } catch (failure) {
    error = failure instanceof Error ? failure.message : "Retention maintenance failed.";
    if (currentBundle) await io.settle(input.occurrence, input.owner, currentBundle, false, error).catch(() => {});
  } finally { clearInterval(timer); await (heartbeatPending as Promise<void> | null)?.catch(() => {}); }
  // If the process lost ownership, SQL refuses finalization and durable stale recovery handles it.
  return io.finish(input.occurrence, input.owner, error, protectedCount, reviewCount);
}
