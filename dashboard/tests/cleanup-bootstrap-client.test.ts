import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import test from "node:test";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";

test("Supabase bootstrap inserts missing seeds without replacing conflicts or writing on empty initialization", async (t) => {
  let calls = 0;
  const seed = JSON.parse(await fs.readFile("config/cleanup-ledger-seed.json", "utf8")).records[0];
  const server = createServer(async (request, response) => {
    calls++;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/rest/v1/cleanup_ledger?on_conflict=originating_run_id,object_type,object_id");
    assert.equal(request.headers.prefer, "resolution=ignore-duplicates,return=minimal");
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.length, 1); assert.equal(body[0].object_id, seed.objectId);
    response.writeHead(204); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  process.env.INSSA_OPS_METADATA_STORE = "supabase";
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
  await getInssaRunStore().initializeCleanupLedger([]); assert.equal(calls, 0);
  await getInssaRunStore().initializeCleanupLedger([seed]); assert.equal(calls, 1);
});
