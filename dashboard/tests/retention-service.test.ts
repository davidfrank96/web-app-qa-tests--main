import assert from "node:assert/strict";
import test from "node:test";
import { createRetentionExecutorIO } from "../lib/inssa-ops/retention-service";

test("actual Storage adapter hard-deletes exact keys in the fixed private bucket and verifies absence with HEAD", async (t) => {
  const previous = { ...process.env }, fetcher = globalThis.fetch;
  t.after(() => { process.env = previous; globalThis.fetch = fetcher; });
  Object.assign(process.env, { INSSA_OPS_METADATA_STORE: "supabase", SUPABASE_URL: "https://retention-fixture.example", SUPABASE_SERVICE_ROLE_KEY: "test-only-role", INSSA_EVIDENCE_SUPABASE_BUCKET: "inssa-evidence" });
  const calls: { path: string; method: string }[] = [];
  let headStatus = 404;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ path: url.pathname, method: init?.method ?? "GET" });
    if (init?.method === "DELETE") {
      assert.equal(url.pathname, "/storage/v1/object/inssa-evidence");
      assert.deepEqual(JSON.parse(String(init.body)), { prefixes: ["run/one.json", "run/two.json"] }); return Response.json([]);
    }
    assert.equal(init?.method, "HEAD"); assert.ok(url.pathname.startsWith("/storage/v1/object/inssa-evidence/run/"));
    return new Response(null, { status: headStatus });
  };
  const io = createRetentionExecutorIO(); await io.remove(["run/one.json", "run/two.json"]); await io.verifyAbsent(["run/one.json", "run/two.json"]);
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 1); assert.equal(calls.filter((c) => c.method === "HEAD").length, 2);
  headStatus = 200; await assert.rejects(io.verifyAbsent(["run/one.json"]), /remains present/);
  headStatus = 403; await assert.rejects(io.verifyAbsent(["run/one.json"]));
  await assert.rejects(io.remove([])); await assert.rejects(io.remove(["../other-bucket"]));
  process.env.INSSA_EVIDENCE_SUPABASE_BUCKET = "other-bucket"; assert.throws(() => createRetentionExecutorIO(), /bucket mismatch/);
});
