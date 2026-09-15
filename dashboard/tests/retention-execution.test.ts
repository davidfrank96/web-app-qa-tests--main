import assert from "node:assert/strict";
import test from "node:test";
import { AS_OF, fixture } from "./fixtures/retention";
import { evaluateRetention, retentionSourceSignature } from "../lib/inssa-ops/retention";
import { certifyExecutionPlan, dueRetentionOccurrence, executeRetention, retentionComparison, type RetentionExecutorIO } from "../lib/inssa-ops/retention-executor";
import type { RetentionSnapshot } from "../lib/inssa-ops/retention-types";

function harness(snapshot = fixture()) {
  const calls: string[] = [], sent: string[][] = [], occurrences = new Set<string>(), tombstones: unknown[] = [];
  let active = false, partial = false, verificationFault = false;
  const io: RetentionExecutorIO = {
    snapshot: async () => structuredClone(snapshot),
    claim: async (id) => { if (occurrences.has(id)) return { status: "ALREADY_RECORDED" }; occurrences.add(id); return { status: active ? "SKIPPED_ACTIVE_EXECUTION" : "RUNNING" }; },
    heartbeat: async () => {},
    reserve: async (i) => {
      if (i.snapshot.revision !== snapshot.revision) throw new Error("Snapshot changed");
      calls.push("reserve");
      const bundle = snapshot.bundles.find((b) => b.id === i.bundleId)!;
      snapshot.deletions = snapshot.deletions.filter((d) => d.bundleId !== i.bundleId);
      snapshot.deletions.push({ id: i.bundleId, bundleId: i.bundleId, runId: bundle.runId, campaignKey: bundle.campaignKey,
        sourceSignature: i.signature, expectedObjects: i.objects, policyVersion: "evidence-retention-v2", retentionPlanId: i.planId,
        status: "deleting", originalByteCount: bundle.totalBytes, originalObjectCount: bundle.itemCount });
      return { status: "RESERVED", remaining: i.objects.filter((o) => snapshot.objects.some((s) => s.name === o.name)) };
    },
    remove: async (keys) => { calls.push("delete"); sent.push(keys); const removed = partial ? keys.slice(0, 1) : keys;
      snapshot.objects = snapshot.objects.filter((o) => !removed.includes(o.name)); if (partial) throw new Error("Injected partial Storage failure"); },
    verifyAbsent: async (keys) => { calls.push("verify"); if (verificationFault || snapshot.objects.some((o) => keys.includes(o.name))) throw new Error("Not verified"); },
    settle: async (_id, _owner, bundleId, success) => { const d = snapshot.deletions.find((d) => d.bundleId === bundleId)!;
      if (!success) { d.status = "RETENTION_PARTIAL_FAILURE"; return; }
      calls.push("prune"); tombstones.push({ bundleId, objectCount: d.originalObjectCount, bytes: d.originalByteCount });
      snapshot.bundles = snapshot.bundles.filter((b) => b.id !== bundleId); snapshot.items = snapshot.items.filter((i) => i.bundleId !== bundleId);
      snapshot.deletions = snapshot.deletions.filter((d) => d.bundleId !== bundleId);
    },
    finish: async (_id, _owner, error, protectedCount, reviewCount) => ({ status: error ? "FAILED" : snapshot.deletions.length ? "PARTIAL_FAILURE" : "HEALTHY", error, protectedCount, reviewCount })
  };
  return { snapshot, io, calls, sent, tombstones, setActive: () => { active = true; }, setPartial: (value: boolean) => { partial = value; }, failVerification: () => { verificationFault = true; } };
}
const run = (io: RetentionExecutorIO, occurrence = "manual:test") => executeRetention(io, { occurrence, owner: "test-owner", now: () => new Date(AS_OF) });
function twoObjects(s: RetentionSnapshot) {
  s.items.push({ ...s.items[0], id: "item-2", artifactId: "artifact-2", fileName: "two.json", relativePath: "two.json", storageKey: "fixture/two.json" });
  s.objects.push({ ...s.objects[0], id: "object-2", name: "fixture/two.json" });
  s.bundles[0].checksumManifest["two.json"] = "a".repeat(64); s.bundles[0].itemCount = 2; s.bundles[0].totalBytes = 6;
}
test("v2 retains 20-day success and expires exact 21 days and older", () => {
  assert.equal(evaluateRetention(fixture(20), AS_OF).summary.eligibleBundles, 0);
  for (const days of [21, 22]) { const plan = evaluateRetention(fixture(days), AS_OF); certifyExecutionPlan(plan); assert.equal(plan.summary.eligibleBundles, 1); }
});
test("30/21/14 comparison uses the same rules; comparative and mismatched policies cannot execute", () => {
  const plans = retentionComparison(fixture(25), AS_OF);
  assert.equal(plans.thirtyDays.summary.eligibleBundles, 0); assert.equal(plans.twentyOneDays.summary.eligibleBundles, 1); assert.equal(plans.fourteenDays.summary.eligibleBundles, 1);
  for (const plan of [plans.thirtyDays, plans.fourteenDays, { ...plans.twentyOneDays, policyVersion: "evidence-retention-v1" }]) assert.throws(() => certifyExecutionPlan(plan));
});
for (const state of ["failed", "failed_startup", "timed_out", "cancelled"] as const) test(`v2 ${state} under 90 days never deletes`, async () => {
  const h = harness(fixture(89, state)); await run(h.io); assert.deepEqual(h.sent, []);
});
test("v2 security, active, review and unresolved cleanup never delete", async () => {
  for (const change of [(s: RetentionSnapshot) => { s.items[0].retentionClass = "security-evidence"; },
    (s: RetentionSnapshot) => { s.runs[0].status = "running"; }, (s: RetentionSnapshot) => { s.bundles[0].uploadStatus = "local_only"; },
    (s: RetentionSnapshot) => { s.bundles[0].retentionClass = "cleanup-evidence"; }]) {
    const h = harness(); change(h.snapshot); await run(h.io); assert.deepEqual(h.sent, []);
  }
});
test("hold added after the dry run prevents execution; reserve rejects a concurrent changed revision", async () => {
  const h = harness(); assert.equal(evaluateRetention(h.snapshot, AS_OF).summary.eligibleBundles, 1);
  h.snapshot.holds.push({ id: "hold", scope: "global", bundleId: null, runId: null, itemId: null, cleanupLedgerId: null, reason: "Incident", createdAt: AS_OF,
    holdType: "incident", createdBy: "operator", releasedAt: null, releasedBy: null, status: "active" });
  await run(h.io); assert.deepEqual(h.sent, []);
  const race = harness(); const original = race.io.reserve; race.io.reserve = async (input) => { race.snapshot.revision = "changed-after-plan"; return original(input); };
  await run(race.io); assert.deepEqual(race.sent, []);
});
test("Storage deletion and verified absence precede pruning; tombstone and run survive; occurrence is idempotent", async () => {
  const h = harness(), runs = structuredClone(h.snapshot.runs); await run(h.io); await run(h.io);
  assert.deepEqual(h.calls, ["reserve", "delete", "verify", "prune"]); assert.equal(h.tombstones.length, 1); assert.equal(h.snapshot.items.length, 0);
  assert.deepEqual(h.snapshot.runs, runs);
});
test("partial deletion persists intent, re-evaluates and retries ONLY remaining keys", async () => {
  const h = harness(); twoObjects(h.snapshot); h.setPartial(true);
  assert.equal((await run(h.io) as { status: string }).status, "PARTIAL_FAILURE");
  assert.equal(h.snapshot.items.length, 2); assert.equal(h.snapshot.deletions[0].status, "RETENTION_PARTIAL_FAILURE");
  assert.equal(evaluateRetention(h.snapshot, AS_OF).summary.eligibleBundles, 1);
  h.setPartial(false); await run(h.io, "manual:retry"); assert.deepEqual(h.sent, [["fixture/one.json", "fixture/two.json"], ["fixture/two.json"]]);
  assert.equal(h.tombstones.length, 1);
});
test("missing objects without a durable intent never become eligible; changed pending evidence fails closed", () => {
  const s = fixture(); s.objects = []; assert.equal(evaluateRetention(s, AS_OF).summary.eligibleBundles, 0);
  const full = fixture(); full.deletions.push({ id: "intent", bundleId: "bundle-1", runId: "run-1", campaignKey: "test_inssa_safe", sourceSignature: retentionSourceSignature(full.bundles[0], full.items),
    expectedObjects: structuredClone(full.objects), policyVersion: "evidence-retention-v2", retentionPlanId: "old-plan", status: "RETENTION_PARTIAL_FAILURE", originalByteCount: 3, originalObjectCount: 1 });
  full.objects[0].id = "replacement"; assert.equal(evaluateRetention(full, AS_OF).summary.eligibleBundles, 0);
});
test("failed absence verification never prunes metadata", async () => { const h = harness(); h.failVerification(); await run(h.io); assert.equal(h.snapshot.items.length, 1); assert.equal(h.tombstones.length, 0); });
test("byte budget is checked before Storage deletion", async () => {
  const h = harness(); h.snapshot.items[0].sizeBytes = h.snapshot.bundles[0].totalBytes = h.snapshot.objects[0].sizeBytes = 2_000_000_001;
  await run(h.io); assert.deepEqual(h.sent, []);
});
test("bundle budget stops at 100 and leaves the next eligible bundle for another occurrence", async () => {
  const s = fixture(); for (let n = 1; n <= 100; n++) { const copy = fixture(); const suffix = String(n); s.runs.push({ ...copy.runs[0], id: `run-x${suffix}` });
    s.bundles.push({ ...copy.bundles[0], id: `bundle-x${suffix}`, runId: `run-x${suffix}`, storagePrefix: `fixture-x${suffix}` });
    s.items.push({ ...copy.items[0], id: `item-x${suffix}`, bundleId: `bundle-x${suffix}`, runId: `run-x${suffix}`, storageKey: `fixture-x${suffix}/one.json` });
    s.objects.push({ ...copy.objects[0], id: `object-x${suffix}`, name: `fixture-x${suffix}/one.json` }); }
  const h = harness(s); await run(h.io); assert.equal(h.tombstones.length, 100); assert.equal(h.snapshot.bundles.length, 1);
});
test("active campaign safely records a skipped occurrence without competing with QA", async () => { const h = harness(); h.setActive(); assert.equal((await run(h.io) as { status: string }).status, "SKIPPED_ACTIVE_EXECUTION"); assert.deepEqual(h.calls, []); });
test("Dublin daily occurrence handles summer and winter boundaries and repeated DST hour", () => {
  assert.equal(dueRetentionOccurrence(new Date("2026-09-15T00:29:59Z")), null);
  assert.equal(dueRetentionOccurrence(new Date("2026-09-15T00:30:00Z")), "daily:2026-09-15");
  assert.equal(dueRetentionOccurrence(new Date("2026-12-15T01:30:00Z")), "daily:2026-12-15");
  assert.equal(dueRetentionOccurrence(new Date("2026-10-25T00:30:00Z")), dueRetentionOccurrence(new Date("2026-10-25T01:30:00Z")));
});
