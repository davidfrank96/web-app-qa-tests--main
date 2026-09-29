import assert from "node:assert/strict";
import test from "node:test";
import { AS_OF, fixture } from "./fixtures/retention";
import {
  evaluateRetention,
  retentionSourceSignature,
} from "../lib/inssa-ops/retention";
import {
  executeRetention,
  type RetentionExecutorIO,
} from "../lib/inssa-ops/retention-executor";
import {
  objectIdentity,
  itemIdentity,
} from "../lib/inssa-ops/retention-storage";

function spaces() {
  const s = fixture();
  for (const row of [...s.bundles, ...s.items]) {
    row.storageBackend = "spaces";
    row.storageBucket = "fixture-bucket";
  }
  s.objects = s.objects.map((o) => ({
    ...o,
    provider: "spaces" as const,
    bucket: "fixture-bucket",
    etag: "fixture",
    sha256: s.items[0].sha256,
  }));
  return s;
}
test("retention distinguishes identical keys in two providers and preserves legacy signatures", () => {
  const s = spaces();
  s.objects.push({
    ...s.objects[0],
    provider: "supabase",
    bucket: "inssa-evidence",
  });
  const p = evaluateRetention(s, AS_OF);
  assert.equal(p.bundles[0].eligibilityReason, "ELIGIBLE");
  assert.equal(p.bundles[0].provider, "spaces");
  assert.equal(p.summary.unreferencedObjects, 1);
  assert.notEqual(objectIdentity(s.objects[1]), itemIdentity(s.items[0]));
  s.objects.shift();
  assert.equal(
    evaluateRetention(s, AS_OF).bundles[0].eligibilityReason,
    "REVIEW_REQUIRED",
  );
  const old = fixture();
  const signature = retentionSourceSignature(old.bundles[0], old.items);
  old.bundles[0].storageBucket = null;
  old.items[0].storageBucket = null;
  assert.equal(retentionSourceSignature(old.bundles[0], old.items), signature);
});
test("Spaces retention honors holds, failure/security windows and changed retry objects", () => {
  const s = spaces();
  s.holds.push({
    id: "hold",
    scope: "global",
    runId: null,
    bundleId: null,
    itemId: null,
    cleanupLedgerId: null,
    reason: "investigation",
    holdType: "manual",
    createdBy: "fixture",
    createdAt: s.bundles[0].createdAt,
    status: "active",
    releasedAt: null,
    releasedBy: null,
  });
  assert.equal(
    evaluateRetention(s, AS_OF).bundles[0].eligibilityReason,
    "PROTECTED",
  );
  s.holds = [];
  s.runs[0].status = "failed";
  assert.equal(
    evaluateRetention(s, AS_OF).bundles[0].eligibilityReason,
    "PROTECTED",
  );
  s.runs[0].status = "passed";
  s.items[0].retentionClass = "security-evidence";
  assert.equal(
    evaluateRetention(s, AS_OF).bundles[0].eligibilityReason,
    "PROTECTED",
  );
  s.items[0].retentionClass = s.bundles[0].retentionClass;
  const b = s.bundles[0];
  s.deletions = [
    {
      id: "intent",
      bundleId: b.id,
      runId: b.runId,
      campaignKey: b.campaignKey,
      sourceSignature: retentionSourceSignature(b, s.items),
      expectedObjects: structuredClone(s.objects),
      policyVersion: "evidence-retention-v3",
      retentionPlanId: "plan",
      status: "RETENTION_PARTIAL_FAILURE",
      originalObjectCount: b.itemCount,
      originalByteCount: b.totalBytes,
    },
  ];
  s.objects[0].etag = "replaced";
  assert.ok(
    evaluateRetention(s, AS_OF).bundles[0].protectionReasons.includes(
      "DELETION_OBJECT_CHANGED",
    ),
  );
  s.objects = [];
  assert.equal(
    evaluateRetention(s, AS_OF).bundles[0].eligibilityReason,
    "ELIGIBLE",
  );
});
test("executor passes the recorded provider and bucket and preserves failure intent", async () => {
  const s = spaces();
  let failed = false,
    deleted = false;
  const calls: string[] = [];
  const io: RetentionExecutorIO = {
    snapshot: async () => s,
    claim: async () => ({ status: "RUNNING" }),
    heartbeat: async () => {},
    reserve: async (i) => ({ status: "RESERVED", remaining: i.objects }),
    remove: async (keys, l) => {
      assert.deepEqual(l, { provider: "spaces", bucket: "fixture-bucket" });
      assert.deepEqual(
        keys,
        s.objects.map((o) => o.name),
      );
      calls.push("spaces-delete");
      throw new Error("fixture unavailable");
    },
    verifyAbsent: async (_keys, l) => {
      assert.equal(l?.provider, "spaces");
      throw new Error("still present");
    },
    settle: async (_id, _owner, _b, success) => {
      failed = !success;
      deleted = success;
    },
    finish: async () => ({}),
  };
  await executeRetention(io, {
    occurrence: "manual:fixture",
    owner: "fixture-owner",
    now: () => new Date(AS_OF),
  });
  assert.deepEqual(calls, ["spaces-delete"]);
  assert.equal(failed, true);
  assert.equal(deleted, false);
});
