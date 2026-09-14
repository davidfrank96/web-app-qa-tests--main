import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";

test("metadata client retries the same atomic RPC after a committed response is lost; never DELETEs", async (t) => {
  let calls = 0; const payloads: string[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.method, "POST"); assert.equal(request.url, "/rest/v1/rpc/publish_inssa_evidence");
    const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
    payloads.push(Buffer.concat(parts).toString()); calls++;
    if (calls === 1) { request.socket.destroy(); return; }
    response.writeHead(204); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0,"127.0.0.1",resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  process.env.INSSA_OPS_METADATA_STORE = "supabase"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  await getInssaRunStore().replaceRunEvidence(crypto.randomUUID(), null, []);
  assert.equal(calls, 2); assert.equal(payloads[0], payloads[1]);
});
