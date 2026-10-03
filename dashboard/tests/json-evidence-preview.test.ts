import test from "node:test";
import assert from "node:assert/strict";
import { loadJsonEvidence } from "../lib/inssa-ops/json-evidence-preview";
const signal = new AbortController().signal;
const href = "/api/artifacts/123/file";
const request = (response: Response) => (async (_url: unknown, options: RequestInit) => {
  assert.equal(options.credentials, "same-origin");assert.equal(options.redirect,"error");return response;
}) as typeof fetch;
test("authenticated attachment JSON is formatted as inert text", async () => {
  const value={example:'<script>alert(1)</script>'};
  assert.equal(await loadJsonEvidence(href,signal,request(new Response(JSON.stringify(value)))),JSON.stringify(value,null,2));
});
test("preview fails closed for unauthorized, invalid, oversized and external content", async () => {
  await assert.rejects(loadJsonEvidence(href,signal,request(new Response('',{status:403}))), /403/);
  await assert.rejects(loadJsonEvidence(href,signal,request(new Response('<html>Login</html>'))));
  await assert.rejects(loadJsonEvidence(href,signal,request(new Response('x'.repeat(2*1024*1024+1)))),/too large/);
  await assert.rejects(loadJsonEvidence('https://example.test/file',signal),/Unsupported/);
  await assert.rejects(loadJsonEvidence('/api/artifacts/123/bundle/../file',signal),/Unsupported/);
});
