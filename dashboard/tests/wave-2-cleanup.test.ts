import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { initializeConfiguredCleanupLedger, evaluateCleanupGate } from "../lib/inssa-ops/cleanup-ledger";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";
import { getLocalRunStorePath } from "../lib/inssa-ops/paths";
import type { InssaCleanupLedgerRecord } from "../lib/inssa-ops/types";
const require = createRequire(import.meta.url);
test("startup preserves manual resolution; cleanup GET makes zero writes and launch gate reads fresh state", async (t) => {
  const source = JSON.parse(await fs.readFile(path.resolve("config/cleanup-ledger-seed.json"), "utf8"));
  const seed: InssaCleanupLedgerRecord = { mediaType: null, resultingState: null, selectedRecipient: null, ...source.records[0] };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-cleanup-wave2-"));
  process.env.INSSA_QA_REPO_ROOT = root; delete process.env.INSSA_OPS_METADATA_STORE;
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "dashboard/config"), { recursive: true });
  await fs.writeFile(path.join(root, "dashboard/config/cleanup-ledger-seed.json"), JSON.stringify({ records: [seed] }));
  const store = getInssaRunStore();
  const input = { repoRoot: root, store, environment: { INSSA_TEST_ACCOUNT_IS_DEDICATED_QA: "1", INSSA_DEFERRED_CLEANUP_MODE: "1" } };
  const uninitialized = await evaluateCleanupGate(input);
  assert.equal(uninitialized.unresolved[0].id, seed.id, "uninitialized seed remains visible and conservatively validated");
  await assert.rejects(fs.stat(getLocalRunStorePath()), { code: "ENOENT" });
  await initializeConfiguredCleanupLedger(root, store);
  const resolved = { ...seed, status: "completed" as const, resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), notes: "Operator verified manual resolution", evidencePaths: ["newer-manual-proof.json"] };
  await store.upsertCleanupLedger(resolved);
  await initializeConfiguredCleanupLedger(root, store);
  assert.deepEqual(await store.getCleanupLedgerRecord(seed.id), resolved);
  assert.equal((await evaluateCleanupGate(input)).ok, true);
  // Run the actual GET, replacing only its authenticated identity with a fixture user.
  const guardPath = require.resolve("../lib/inssa-ops/api-guard"); require(guardPath);
  const cached = require.cache[guardPath]!; const original = cached.exports;
  cached.exports = { ...original, requireInssaApiUser: async () => ({ response: null, user: { id: "fixture", role: "viewer", email: "viewer@example.test" } }) };
  t.after(() => { cached.exports = original; });
  const { GET } = require("../app/api/cleanup-ledger/route");
  const before = await fs.readFile(getLocalRunStorePath(), "utf8");
  const beforeStat = await fs.stat(getLocalRunStorePath());
  for (let i = 0; i < 3; i++) {
    const response = await GET({}); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).records, [resolved]);
  }
  assert.equal(await fs.readFile(getLocalRunStorePath(), "utf8"), before);
  assert.equal((await fs.stat(getLocalRunStorePath())).mtimeMs, beforeStat.mtimeMs);
  await store.upsertCleanupLedger({ ...resolved, status: "pending", resolvedAt: null });
  const changed = await evaluateCleanupGate(input); assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.id, "cleanup-state");
  await store.upsertCleanupLedger(resolved); assert.equal((await evaluateCleanupGate(input)).ok, true);
});
