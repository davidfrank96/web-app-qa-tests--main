import assert from "node:assert/strict";
import test from "node:test";
import { getInssaPhase1Command } from "../lib/inssa-ops/command-registry";
import { evaluateRetention, RETENTION_POLICY_VERSION } from "../lib/inssa-ops/retention";
import { createRetentionReader, readRetentionSnapshot, RETENTION_RESOURCES } from "../lib/inssa-ops/retention-store";
import type { RetentionHold, RetentionSnapshot } from "../lib/inssa-ops/retention-types";
import type { InssaCleanupLedgerRecord, InssaRunStatus } from "../lib/inssa-ops/types";

const AS_OF = "2026-09-14T22:00:00.000Z";
const ago = (days: number) => new Date(Date.parse(AS_OF) - days * 86_400_000).toISOString();
function fixture(days = 31, status: InssaRunStatus = "passed"): RetentionSnapshot {
  const createdAt = ago(days), hash = "a".repeat(64);
  return {
    revision: "fixture-revision", consistent: true, holds: [], cleanup: [],
    policies: [{ id: RETENTION_POLICY_VERSION, mode: "dry_run_only", effectiveAt: "2026-09-14T00:00:00Z",
      routineDays: 30, failureDays: 90, securityDays: 90, postCleanupDays: 30 }],
    runs: [{ id: "run-1", campaignKey: "test_inssa_safe", commandSnapshot: getInssaPhase1Command("test_inssa_safe")!,
      createdAt, completedAt: createdAt, updatedAt: createdAt, startedAt: createdAt, durationMs: 0, exitCode: 0, requestedBy: "fixture", status }],
    bundles: [{ id: "bundle-1", runId: "run-1", campaignKey: "test_inssa_safe", title: "Fixture", product: "INSSA", environment: "staging",
      bundleType: "playwright", status: "indexed", retentionClass: "short-lived", rootPath: "/fixture", sourceArtifactId: null,
      itemCount: 1, totalBytes: 3, checksumManifest: { "one.json": hash }, sensitive: false, storageBackend: "supabase-storage",
      storagePrefix: "fixture", uploadStatus: "uploaded", uploadedAt: createdAt, uploadError: null, createdAt, indexedAt: createdAt }],
    items: [{ id: "item-1", bundleId: "bundle-1", runId: "run-1", campaignKey: "test_inssa_safe", artifactId: "artifact-1", itemType: "JSON Artifact",
      fileName: "one.json", relativePath: "one.json", contentType: "application/json", sizeBytes: 3, sha256: hash, sensitive: false,
      renderInline: false, retentionClass: "short-lived", storageBackend: "supabase-storage", storageKey: "fixture/one.json",
      uploadStatus: "uploaded", uploadedAt: createdAt, uploadError: null, metadata: {}, createdAt }],
    objects: [{ id: "object-1", name: "fixture/one.json", sizeBytes: 3, createdAt, updatedAt: createdAt }]
  };
}
const decide = (snapshot: RetentionSnapshot) => evaluateRetention(snapshot, AS_OF).bundles[0];
function addHold(snapshot: RetentionSnapshot, type: RetentionHold["holdType"], scope: RetentionHold["scope"] = "bundle") {
  snapshot.holds.push({ id: "hold-1", scope, runId: scope === "run" ? "run-1" : null,
    bundleId: scope === "bundle" ? "bundle-1" : null, itemId: scope === "item" ? "item-1" : null,
    cleanupLedgerId: scope === "cleanup" ? "cleanup-1" : null, reason: "Investigation fixture", holdType: type,
    createdBy: "fixture-admin", createdAt: ago(10), releasedAt: null, releasedBy: null, status: "active" });
}
function cleanup(snapshot: RetentionSnapshot, resolvedDays: number | null) {
  snapshot.bundles[0].retentionClass = "cleanup-evidence";
  snapshot.runs[0].cleanup = { affectedUsers: [], automaticCleanupAvailable: false, confirmedAt: resolvedDays === null ? null : ago(resolvedDays),
    confirmedBy: "fixture-admin", createdArtifactIds: [], createdCapsuleIds: ["capsule-1"], createdMediaIds: [], finalActionPerformed: true,
    instructions: [], lifecycleState: "published", runId: "run-1", schemaVersion: 2, status: resolvedDays === null ? "deferred" : "completed" };
  snapshot.cleanup = [{ id: "cleanup-1", originatingRunId: "run-1", objectId: "capsule-1", objectType: "time_capsule",
    status: resolvedDays === null ? "deferred" : "completed", resolvedAt: resolvedDays === null ? null : ago(resolvedDays),
    retentionUntil: ago(1), securitySensitive: false, unexpectedData: false } as InssaCleanupLedgerRecord];
}

test("success at 29 days is retained", () => assert.equal(decide(fixture(29)).eligibilityReason, "PROTECTED"));
test("success over 30 days is eligible; the exact 30-day boundary expires", () => {
  assert.equal(decide(fixture(31)).eligibilityReason, "ELIGIBLE"); assert.equal(decide(fixture(30)).eligibilityReason, "ELIGIBLE");
});
for (const status of ["failed", "failed_startup", "timed_out", "cancelled"] as const) {
  test(`${status} is retained under 90 days and eligible over 90 only without a stronger hold`, () => {
    assert.equal(decide(fixture(89, status)).eligibilityReason, "PROTECTED");
    const s = fixture(91, status); assert.equal(decide(s).eligibilityReason, "ELIGIBLE");
    addHold(s, "manual"); assert.equal(decide(s).eligibilityReason, "PROTECTED");
  });
}
test("item security class protects the whole bundle under 90 days", () => {
  const s = fixture(31); s.items[0].retentionClass = "security-evidence";
  assert.equal(decide(s).eligibilityReason, "PROTECTED"); assert.ok(decide(s).protectionReasons.includes("SECURITY_WINDOW"));
});
test("unresolved cleanup retains indefinitely", () => {
  const s = fixture(300); cleanup(s, null); assert.equal(decide(s).eligibilityReason, "PROTECTED"); assert.equal(decide(s).expiryAt, null);
});
test("resolved cleanup retains for 30 days after resolution", () => {
  const s = fixture(120); cleanup(s, 29); assert.equal(decide(s).eligibilityReason, "PROTECTED");
  cleanup(s, 31); assert.equal(decide(s).eligibilityReason, "ELIGIBLE");
});
for (const holdType of ["manual", "security_review", "incident", "cleanup", "compliance"] as const) {
  test(`${holdType} hold prevents expiry`, () => { const s = fixture(300); addHold(s, holdType); assert.equal(decide(s).eligibilityReason, "PROTECTED"); });
}
for (const scope of ["global", "run", "item", "cleanup"] as const) {
  test(`${scope} hold protects the complete associated bundle`, () => {
    const s = fixture(300); if (scope === "cleanup") cleanup(s, 90); addHold(s, "manual", scope);
    assert.equal(decide(s).eligibilityReason, "PROTECTED");
  });
}
test("released holds preserve history and a release after asOf still protects", () => {
  const s = fixture(31); addHold(s, "manual"); Object.assign(s.holds[0], { status: "released", releasedAt: ago(1), releasedBy: "admin" });
  assert.equal(decide(s).eligibilityReason, "ELIGIBLE"); s.holds[0].releasedAt = ago(-1); assert.equal(decide(s).eligibilityReason, "PROTECTED");
});
for (const status of ["queued", "starting", "running", "indexing_artifacts"] as const) {
  test(`${status} run is REVIEW_REQUIRED`, () => assert.equal(decide(fixture(300, status)).eligibilityReason, "REVIEW_REQUIRED"));
}
test("unknown cleanup association is REVIEW_REQUIRED", () => {
  const s = fixture(300); s.bundles[0].retentionClass = "cleanup-evidence"; assert.equal(decide(s).eligibilityReason, "REVIEW_REQUIRED");
  cleanup(s, 60); s.runs[0].cleanup!.createdMediaIds.push("missing-media"); assert.equal(decide(s).eligibilityReason, "REVIEW_REQUIRED");
});
test("resumed objects use durable object identity across runs", () => {
  const s = fixture(300); cleanup(s, null); s.cleanup[0].originatingRunId = "earlier-run";
  assert.equal(decide(s).eligibilityReason, "PROTECTED");
});
test("contradictory cleanup manifest cannot be ignored on a nominally safe run", () => {
  const s = fixture(300); cleanup(s, null); s.bundles[0].retentionClass = "short-lived";
  s.cleanup = []; s.runs[0].cleanup!.createdCapsuleIds = [];
  assert.equal(decide(s).eligibilityReason, "REVIEW_REQUIRED");
});
test("missing run, malformed hold, unknown policy, incomplete upload and uncertain security all fail closed", () => {
  for (const mutate of [
    (s: RetentionSnapshot) => { s.runs = []; },
    (s: RetentionSnapshot) => { addHold(s, "manual"); s.holds[0].status = "unknown" as RetentionHold["status"]; },
    (s: RetentionSnapshot) => { s.policies = []; },
    (s: RetentionSnapshot) => { s.bundles[0].uploadStatus = "local_only"; },
    (s: RetentionSnapshot) => { s.runs[0].commandSnapshot = { ...s.runs[0].commandSnapshot, npmScript: "unknown-command" }; },
    (s: RetentionSnapshot) => { s.items[0].sizeBytes = 99; },
    (s: RetentionSnapshot) => { s.objects = []; },
    (s: RetentionSnapshot) => { s.runs[0].completedAt = null; },
    (s: RetentionSnapshot) => { s.bundles[0].uploadedAt = "not-a-date"; },
    (s: RetentionSnapshot) => { s.items[0].retentionClass = "unknown" as "default"; }
  ]) { const s = fixture(300); mutate(s); assert.equal(decide(s).eligibilityReason, "REVIEW_REQUIRED"); }
});
test("strongest rule combines failure, item security, resolved cleanup, explicit retention and holds", () => {
  const s = fixture(91, "failed"); cleanup(s, 10); s.items[0].retentionClass = "security-evidence";
  s.cleanup[0].retentionUntil = ago(-50); assert.equal(decide(s).expiryAt, ago(-50));
  addHold(s, "incident"); assert.equal(decide(s).expiryAt, null); assert.equal(decide(s).eligibilityReason, "PROTECTED");
});
test("latest durable object update resets the age anchor", () => {
  const s = fixture(90); s.objects[0].updatedAt = ago(2); assert.equal(decide(s).eligibilityReason, "PROTECTED");
});
test("SIEM metadata is preserved; historical unreferenced objects are counted without eligibility", () => {
  const s = fixture(300); s.items[0].retentionClass = "siem-metadata";
  s.objects.push({ ...s.objects[0], id: "orphan", name: "historical-object" });
  const plan = evaluateRetention(s, AS_OF); assert.equal(plan.summary.eligibleBundles, 0); assert.equal(plan.summary.unreferencedObjects, 1);
});
test("repeated plans with the same asOf/policy/snapshot are deterministic and do not mutate input", () => {
  const s = fixture(31); const before = structuredClone(s);
  assert.deepEqual(evaluateRetention(s, AS_OF), evaluateRetention(s, AS_OF)); assert.deepEqual(s, before);
});

function sqlRow(row: unknown) {
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), value]));
}
test("planner pages beyond 1,000 rows; every transport call is GET; audit, cleanup, monitoring and Storage are unchanged", async (t) => {
  const s = fixture(31);
  s.objects = Array.from({ length: 1203 }, (_, index) => ({ ...s.objects[0], id: `object-${index}`, name: index ? `orphan-${index}` : "fixture/one.json" }));
  const baseline = structuredClone(s);
  const untouched = { auditEvents: [{ id: "audit" }], cleanupLedger: s.cleanup, monitoringDefinitions: [{ id: "monitor" }], logs: ["log"], outbox: ["notification"] };
  const untouchedBefore = structuredClone(untouched);
  const previous = { ...process.env }; t.after(() => { process.env = previous; });
  Object.assign(process.env, { INSSA_OPS_METADATA_STORE: "supabase", SUPABASE_URL: "https://fixture.example", SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key" });
  const calls: { resource: string; offset: number }[] = [];
  const transport: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    const url = new URL(String(input)); let body: unknown;
    if (url.pathname === "/rest/v1/rpc/retention_read_manifest") body = { revision: "fixture-revision", counts: Object.fromEntries(RETENTION_RESOURCES.map((key) => [key, s[key].length])) };
    else {
      assert.equal(url.pathname, "/rest/v1/rpc/retention_read_page");
      const resource = url.searchParams.get("p_resource") as typeof RETENTION_RESOURCES[number]; assert.ok(RETENTION_RESOURCES.includes(resource));
      const offset = Number(url.searchParams.get("p_offset")); calls.push({ resource, offset });
      body = { rows: s[resource].slice(offset, offset + 500).map(sqlRow) };
    }
    return Response.json(body);
  };
  const snapshot = await readRetentionSnapshot(createRetentionReader(transport));
  assert.equal(snapshot.objects.length, 1203); assert.ok(calls.some((call) => call.resource === "objects" && call.offset === 1000));
  const plan = evaluateRetention(snapshot, AS_OF); assert.equal(plan.summary.eligibleBundles, 1);
  assert.equal(plan.storageDeletionCalls, 0); assert.equal(plan.metadataDeletionCalls, 0);
  assert.deepEqual(s, baseline); assert.deepEqual(untouched, untouchedBefore);
});
test("truncated pages and changes during pagination block all eligibility", async () => {
  let manifests = 0;
  const snapshot = await readRetentionSnapshot({ manifest: async () => ({ revision: String(manifests++), counts: { bundles: 1 } }),
    page: async () => fixture().bundles.map(sqlRow) });
  assert.equal(snapshot.consistent, false); assert.equal(decide(snapshot).eligibilityReason, "REVIEW_REQUIRED");
  const truncated = await readRetentionSnapshot({ manifest: async () => ({ revision: "same", counts: { bundles: 2 } }),
    page: async () => fixture().bundles.map(sqlRow) }); assert.equal(truncated.consistent, false);
});
test("unavailable hold read rejects the dry run instead of assuming no holds", async () => {
  await assert.rejects(readRetentionSnapshot({ manifest: async () => ({ revision: "one", counts: { holds: 1 } }),
    page: async () => { throw new Error("hold read failed"); } }), /hold read failed/);
});
