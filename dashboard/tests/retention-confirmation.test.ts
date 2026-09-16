import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { AS_OF, fixture } from "./fixtures/retention";
import { evaluateRetention } from "../lib/inssa-ops/retention";
import { createRetentionPreview, RETENTION_CONFIRMATION, verifyRetentionConfirmation } from "../lib/inssa-ops/retention-confirmation";
import { nextMonthlyRetentionAt } from "../lib/inssa-ops/retention-schedule";
const now = Date.parse(AS_OF);

test("manual approval binds admin, policy, eligible batch, revision and five-minute expiry; rejects tampering and missing phrase", (t) => {
  const prior = process.env.INSSA_AUTH_RATE_LIMIT_SECRET;
  process.env.INSSA_AUTH_RATE_LIMIT_SECRET = "fixture-retention-signing-key-32-characters";
  t.after(() => { if (prior === undefined) delete process.env.INSSA_AUTH_RATE_LIMIT_SECRET; else process.env.INSSA_AUTH_RATE_LIMIT_SECRET = prior; });
  const plan = evaluateRetention(fixture(), AS_OF), preview = createRetentionPreview(plan, "admin-1", now)!;
  assert.deepEqual([preview.bundles, preview.objects, preview.bytes], [1, 1, 3]);
  const approval = verifyRetentionConfirmation(preview.token, RETENTION_CONFIRMATION, "admin-1", now);
  assert.deepEqual(approval.bundleIds, ["bundle-1"]); assert.equal(approval.revision, plan.snapshotRevision);
  assert.deepEqual(verifyRetentionConfirmation(preview.token, RETENTION_CONFIRMATION, "admin-1", now), approval, "retry retains one durable occurrence");
  for (const [token, phrase, user, time] of [[preview.token, "", "admin-1", now], [preview.token, RETENTION_CONFIRMATION, "other-admin", now],
    [preview.token, RETENTION_CONFIRMATION, "admin-1", now + 300_000], [`${preview.token}tampered`, RETENTION_CONFIRMATION, "admin-1", now]] as const) {
    assert.throws(() => verifyRetentionConfirmation(token, phrase, user, time));
  }
  assert.equal(createRetentionPreview(evaluateRetention(fixture(29), AS_OF), "admin-1", now), null);
  assert.throws(() => createRetentionPreview(evaluateRetention(fixture(), AS_OF, { legacyV2: true }), "admin-1", now));
  const overBudget = fixture(); overBudget.bundles[0].totalBytes = overBudget.items[0].sizeBytes = overBudget.objects[0].sizeBytes = 2_000_000_001;
  assert.equal(createRetentionPreview(evaluateRetention(overBudget, AS_OF), "admin-1", now), null);
});

test("next monthly cleanup always lies in the future across year and Dublin DST boundaries", () => {
  assert.equal(nextMonthlyRetentionAt(new Date("2026-09-16T01:00Z")).toISOString(), "2026-10-01T00:30:00.000Z");
  assert.equal(nextMonthlyRetentionAt(new Date("2026-10-01T00:30Z")).toISOString(), "2026-11-01T01:30:00.000Z");
  assert.equal(nextMonthlyRetentionAt(new Date("2026-12-15T00:00Z")).toISOString(), "2027-01-01T01:30:00.000Z");
  assert.equal(nextMonthlyRetentionAt(new Date("2026-03-15T00:00Z")).toISOString(), "2026-04-01T00:30:00.000Z");
});

test("manual endpoint rejects unauthenticated, non-admin, untrusted-origin and unconfirmed requests before any execution", async (t) => {
  const require = createRequire(import.meta.url);
  const guardPath = require.resolve("../lib/inssa-ops/api-guard"); require(guardPath);
  const servicePath = require.resolve("../lib/inssa-ops/retention-service"); require(servicePath);
  const guard = require.cache[guardPath]!, service = require.cache[servicePath]!;
  const oldGuard = guard.exports, oldService = service.exports;
  let status = 401, attempts = 0;
  guard.exports = { ...oldGuard, requireInssaApiUser: async (_req: unknown, role: string) => {
    assert.equal(role, "admin"); return status === 200 ? { response: null, user: { id: "admin-1", role: "admin" } } : { response: new Response(null, { status }) };
  } };
  service.exports = { ...oldService, createRetentionExecutorIO: () => { attempts++; throw new Error("Execution must not start"); } };
  t.after(() => { guard.exports = oldGuard; service.exports = oldService; });
  const route = require("../app/api/retention/execute/route");
  const request = (origin = "http://localhost:3000", body = {}) => new NextRequest("http://localhost:3000/api/retention/execute", {
    method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request())).status, 401);
  status = 403; assert.equal((await route.POST(request())).status, 403);
  status = 200; assert.equal((await route.POST(request("https://untrusted.invalid"))).status, 403);
  assert.equal((await route.POST(request())).status, 409);
  assert.equal(attempts, 0);
});
