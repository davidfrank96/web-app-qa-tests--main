import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { fixture, AS_OF } from "./fixtures/retention";
import { evaluateRetention } from "../lib/inssa-ops/retention";
import { migrateEvidence, type MigrationDestination, type MigrationLedger, type MigrationSnapshot, type MigrationStore, type MigrationProof } from "../lib/inssa-ops/evidence-migration";
const raw = (v: object) => Object.fromEntries(Object.entries(v).map(([k,v]) => [k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), v]));
function setup(count = 1) {
  const f = fixture(1); const body = Buffer.from("abc"); const sha = createHash("sha256").update(body).digest("hex");
  f.items[0].sha256 = sha; f.bundles[0].checksumManifest["one.json"] = sha;
  if (count > 1) {
    f.items.push({ ...f.items[0], id: "item-2", fileName: "photo.png", relativePath: "assets/nested/photo.png", storageKey: "fixture/assets/nested/photo.png", contentType: "image/png" });
    f.items.push({ ...f.items[0], id: "item-3", fileName: "video.webm", relativePath: "assets/video.webm", storageKey: "fixture/assets/video.webm", contentType: "video/webm" });
    f.bundles[0].itemCount = 3; f.bundles[0].totalBytes = 9;
    f.bundles[0].checksumManifest = Object.fromEntries(f.items.map(i => [i.relativePath, i.sha256]));
  }
  const snapshot = { bundle: raw(f.bundles[0]), items: f.items.map(raw), run: raw(f.runs[0]) } as MigrationSnapshot;
  let current = structuredClone(snapshot); let ledger: MigrationLedger | null = null; let switched = 0;
  const calls: string[] = []; let blocked = false;
  const store: MigrationStore = {
    inspect: async () => ({ snapshot: structuredClone(current), signature: "signature", blocked: blocked ? "BLOCKED_PROTECTION" : null }),
    ledger: async () => ledger ? structuredClone(ledger) : null,
    step: async (_b, action, args = {}) => {
      calls.push(action);
      if (action === "plan") {
        const destination = structuredClone(snapshot); destination.bundle.storage_backend = "spaces"; destination.bundle.storage_bucket = "fixture-bucket";
        destination.items.forEach(i => { i.storage_backend = "spaces"; i.storage_bucket = "fixture-bucket"; });
        ledger = { id: "migration-1", bundle_id: "bundle-1", source_snapshot: structuredClone(snapshot), source_signature: "signature", state: "PLANNED", destination_snapshot: destination,
          destination_bucket: "fixture-bucket", item_count: f.items.length, total_bytes: f.bundles[0].totalBytes, switched_at: null, rolled_back_at: null, attempts: 0, error_code: null };
      }
      assert.ok(ledger);
      if (blocked && ["copy","verify","switch","rollback","preserve"].includes(action)) throw new Error("BLOCKED_PROTECTION");
      if (action === "claim") ledger.attempts++;
      if (action === "copy") ledger.state = "COPYING";
      if (action === "verify") ledger.state = "DESTINATION_VERIFIED";
      if (action === "switch") { assert.equal(ledger.state, "DESTINATION_VERIFIED"); switched++; current = structuredClone(ledger.destination_snapshot); ledger.state = "METADATA_SWITCHED"; ledger.switched_at = new Date().toISOString(); }
      if (action === "preserve") ledger.state = "SOURCE_PRESERVED";
      if (action === "rollback") { current = structuredClone(snapshot); ledger.state = "ROLLED_BACK"; ledger.rolled_back_at = new Date().toISOString(); }
      if (action === "fail" && !["SOURCE_PRESERVED","ROLLED_BACK"].includes(ledger.state)) ledger.state = ledger.switched_at ? "ROLLBACK_REQUIRED" : args.error!;
      return structuredClone(ledger);
    },
  };
  function provider(id: "supabase" | "spaces") {
    const objects = new Map<string, { body: Buffer; contentType: string; sha256?: string }>(); let puts = 0; let reads = 0;
    if (id === "supabase") for (const item of f.items) objects.set(item.storageKey!, { body: Buffer.from(body), contentType: item.contentType });
    const adapter: MigrationDestination = { id, bucket: id === "supabase" ? "inssa-evidence" : "fixture-bucket",
      get: async key => { reads++; assert.ok(objects.has(key)); return Readable.from([objects.get(key)!.body]); },
      head: async key => { const o = objects.get(key); return o ? { sizeBytes: o.body.length, contentType: o.contentType, sha256: o.sha256, etag: createHash("sha256").update(o.body).digest("hex") } : null; },
      put: async (key, value, contentType, sha256) => { assert.equal(id,"spaces"); assert.ok(!objects.has(key)); objects.set(key, { body: Buffer.from(value), contentType, sha256 }); puts++; },
      listPrefix: async prefix => [...objects].filter(([key]) => key.startsWith(prefix)).map(([key,o]) => ({ key, sizeBytes: o.body.length, contentType: o.contentType })),
    };
    return { adapter, objects, puts: () => puts, reads: () => reads };
  }
  const source = provider("supabase"), dest = provider("spaces");
  const options = { bundle: "bundle-1", store, source: source.adapter, destination: dest.adapter, maxBytes: 1024, signal: AbortSignal.timeout(10_000) };
  return { options, source, dest, snapshot, f, calls, current: () => current, ledger: () => ledger!, switched: () => switched, hold: () => { blocked = true; } };
}

test("copy-only keeps metadata on Supabase; resume switches once; repeat is read/verify only; rollback preserves both byte copies", async () => {
  const x = setup(); const before = structuredClone(x.snapshot);
  const copied = await migrateEvidence({ ...x.options, copyOnly: true });
  assert.equal(copied.ledger.state, "DESTINATION_VERIFIED"); assert.deepEqual(x.current(), before);
  assert.equal(x.dest.puts(), 1); assert.equal(x.source.puts(), 0);
  const done = await migrateEvidence({ ...x.options, resume: true });
  assert.equal(done.ledger.state, "SOURCE_PRESERVED"); assert.equal(x.switched(), 1);
  await migrateEvidence({ ...x.options, resume: true }); assert.equal(x.switched(), 1); assert.equal(x.dest.puts(), 1);
  const calls = x.calls.length; await migrateEvidence({ ...x.options, verifyOnly: true }); assert.equal(x.calls.length, calls);
  await migrateEvidence({ ...x.options, rollback: true, resume: true }); assert.deepEqual(x.current(), before);
  assert.equal(x.source.objects.size, 1); assert.equal(x.dest.objects.size, 1);
});

for (const stage of ["copy", "object:item-1", "verify", "switch", "preserve"]) {
  test(`interruption after ${stage}: resume verifies surviving objects and never repeats a committed CAS`, async () => {
    const x = setup(); let interrupted = false;
    await assert.rejects(migrateEvidence({ ...x.options, onCheckpoint: async s => { if (s === stage && !interrupted) { interrupted = true; throw new Error("Injected lost response/process interruption"); } } }));
    assert.equal(x.source.objects.get("fixture/one.json")!.body.toString(), "abc");
    await migrateEvidence({ ...x.options, resume: true });
    assert.equal(x.ledger().state, "SOURCE_PRESERVED"); assert.equal(x.switched(), 1); assert.equal(x.dest.puts(), 1);
  });
}

for (const mutation of ["missing", "hash", "size", "mime", "extra"] as const) {
  test(`source ${mutation} blocks before any destination write`, async () => {
    const x = setup(); const original = x.source.objects.get("fixture/one.json")!;
    if (mutation === "missing") x.source.objects.clear();
    if (mutation === "hash") original.body = Buffer.from("bad");
    if (mutation === "size") original.body = Buffer.from("bad!");
    if (mutation === "mime") original.contentType = "text/html";
    if (mutation === "extra") x.source.objects.set("fixture/unlisted.json", original);
    await assert.rejects(migrateEvidence(x.options)); assert.equal(x.dest.puts(), 0); assert.equal(x.switched(), 0);
  });
}
for (const mutation of ["hash", "size", "mime", "metadata", "extra"] as const) {
  test(`conflicting destination ${mutation} is never overwritten or published`, async () => {
    const x = setup(); const object = { body: Buffer.from("abc"), contentType: "application/json", sha256: x.snapshot.items[0].sha256 };
    if (mutation === "hash") object.body = Buffer.from("bad");
    if (mutation === "size") object.body = Buffer.from("bad!");
    if (mutation === "mime") object.contentType = "text/html";
    if (mutation === "metadata") object.sha256 = "0".repeat(64);
    x.dest.objects.set(mutation === "extra" ? "fixture/unlisted.json" : "fixture/one.json", object);
    await assert.rejects(migrateEvidence(x.options)); assert.equal(x.dest.puts(), 0); assert.equal(x.switched(), 0);
  });
}
test("hold arriving after copying prevents metadata publication", async () => {
  const x = setup(); await assert.rejects(migrateEvidence({ ...x.options, onCheckpoint: async s => { if (s.startsWith("object:")) x.hold(); } }));
  assert.equal(x.switched(), 0); assert.equal(x.current().bundle.storage_backend, "supabase-storage");
});
test("a partial multi-object bundle resumes with nested PNG/video keys and MIME unchanged", async () => {
  const x = setup(3);
  await assert.rejects(migrateEvidence({ ...x.options, onCheckpoint: async s => { if (s === "object:item-2") throw new Error("Crash"); } }));
  assert.equal(x.dest.objects.size, 2); assert.equal(x.switched(), 0);
  const done = await migrateEvidence({ ...x.options, resume: true });
  assert.equal(done.proof.items.length, 3); assert.equal(x.dest.puts(), 3); assert.equal(x.switched(), 1);
  for (const [key, src] of x.source.objects) { const dst = x.dest.objects.get(key)!; assert.deepEqual(dst.body, src.body); assert.equal(dst.contentType, src.contentType); }
});
test("missing destination and mutated preserved source block verify-only and rollback", async () => {
  const x = setup(); await migrateEvidence(x.options); x.dest.objects.clear();
  await assert.rejects(migrateEvidence({ ...x.options, verifyOnly: true }));
  await assert.rejects(migrateEvidence({ ...x.options, rollback: true, resume: true }));
  assert.equal(x.current().bundle.storage_backend, "spaces");
  const y = setup(); await migrateEvidence(y.options); y.source.objects.get("fixture/one.json")!.body = Buffer.from("bad");
  await assert.rejects(migrateEvidence({ ...y.options, rollback: true, resume: true }));
  assert.equal(y.current().bundle.storage_backend, "spaces");
});
test("provider, bucket, byte budget and missing explicit resume are rejected", async () => {
  for (const change of [{ source: { id: "spaces" } }, { source: { bucket: "other" } }, { destination: { id: "supabase" } }]) {
    const x = setup(); await assert.rejects(migrateEvidence({ ...x.options, source: { ...x.options.source, ...change.source } as MigrationDestination, destination: { ...x.options.destination, ...change.destination } as MigrationDestination })); assert.equal(x.dest.puts(), 0);
  }
  const x = setup(); await assert.rejects(migrateEvidence({ ...x.options, maxBytes: 2 }));
  await migrateEvidence({ ...x.options, copyOnly: true }); await assert.rejects(migrateEvidence(x.options));
});
test("independent destination GET catches a lying HEAD and memory-bounded stream rejects overflow", async () => {
  const x = setup(); const get = x.options.destination.get;
  x.options.destination.get = async () => Readable.from([Buffer.from("corruption")]);
  await assert.rejects(migrateEvidence(x.options)); assert.equal(x.switched(), 0);
  x.options.destination.get = get; await migrateEvidence({ ...x.options, resume: true });
  assert.equal(x.ledger().state, "SOURCE_PRESERVED");
});
test("preserved sources and partial destination copies have ledger attribution, not orphan classification", async () => {
  const x = setup(); await migrateEvidence({ ...x.options, copyOnly: true }); const s = x.f;
  s.migrations = [{ id: x.ledger().id, bundleId: "bundle-1", state: "COPYING", destinationBucket: "fixture-bucket", sourceSnapshot: x.snapshot }];
  s.objects.push({ ...s.objects[0], id: "spaces-1", provider: "spaces", bucket: "fixture-bucket" });
  let plan = evaluateRetention(s, AS_OF); assert.equal(plan.summary.migrationDestinationReservedObjects, 1); assert.equal(plan.summary.unreferencedObjects, 0);
  assert.ok(plan.bundles[0].protectionReasons.includes("MIGRATION_ACTIVE"));
  s.migrations[0].state = "SOURCE_PRESERVED"; s.bundles[0].storageBackend = "spaces"; s.bundles[0].storageBucket = "fixture-bucket";
  s.items[0].storageBackend = "spaces"; s.items[0].storageBucket = "fixture-bucket";
  plan = evaluateRetention(s, AS_OF); assert.equal(plan.summary.migrationSourcePreservedObjects, 1); assert.equal(plan.summary.migrationSourcePreservedBytes, 3); assert.equal(plan.summary.unreferencedObjects, 0);
});
