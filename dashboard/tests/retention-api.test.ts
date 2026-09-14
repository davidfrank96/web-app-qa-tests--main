import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);

test("retention GET requires admin before reading metadata and has no mutation handlers", async (t) => {
  const guardPath = require.resolve("../lib/inssa-ops/api-guard"); require(guardPath);
  const storePath = require.resolve("../lib/inssa-ops/retention-store"); require(storePath);
  const guard = require.cache[guardPath]!, store = require.cache[storePath]!;
  const originalGuard = guard.exports, originalStore = store.exports;
  let status = 401, reads = 0;
  guard.exports = { ...originalGuard, requireInssaApiUser: async (_request: unknown, role: string) => {
    assert.equal(role, "admin"); return status === 200 ? { response: null, user: { role: "admin" } } : { response: new Response(null, { status }), user: null };
  } };
  store.exports = { createRetentionReader: () => ({}), readRetentionSnapshot: async () => { reads++; throw new Error("fixture inaccessible"); } };
  t.after(() => { guard.exports = originalGuard; store.exports = originalStore; });
  const route = require("../app/api/retention/route");
  assert.equal((await route.GET({})).status, 401); assert.equal(reads, 0);
  status = 403; assert.equal((await route.GET({})).status, 403); assert.equal(reads, 0);
  status = 200; const response = await route.GET({}); assert.equal(response.status, 503); assert.equal(reads, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(route[method], undefined);
});
