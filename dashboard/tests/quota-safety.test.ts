import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { quotaLevel, quotaCeiling } from "../lib/inssa-ops/quota-status";
import { BackgroundRequestCounter, REQUEST_WINDOW_MS, installBackgroundRequestMetrics, backgroundRequestSnapshot } from "../lib/inssa-ops/background-request-metrics";
test("quota boundaries and incomplete metadata never authorize deletion", async () => {
  for (const [value, level] of [[79.999, "HEALTHY"], [80, "WARNING"], [90, "WARNING"], [90.001, "CRITICAL"], [110, "CRITICAL"], [null, "UNAVAILABLE"]] as const) assert.equal(quotaLevel(value, 100), level);
  assert.equal(quotaLevel(NaN, 100), "UNAVAILABLE"); assert.equal(quotaLevel(5, 0), "UNAVAILABLE");
  assert.equal(quotaCeiling(undefined, 100), 100); assert.throws(() => quotaCeiling("bad", 100));
  const service = await fs.readFile("lib/inssa-ops/usage-status.ts", "utf8"); assert.doesNotMatch(service, /executeRetention|DELETE|retention-executor/);
  const ui = await fs.readFile("components/quota-summary.tsx", "utf8"); assert.match(ui, /onClick={onDryRun}/); assert.doesNotMatch(ui, /\/retention\/execute|DELETE|setInterval/);
  const route = await fs.readFile("app/api/operations/usage/route.ts", "utf8"); assert.match(route, /requireInssaApiUser\(request, "admin"\)/);
});
test("request counters expire without database writes and preserve fetch behavior", async () => {
  const counter = new BackgroundRequestCounter(0); counter.record(1000); counter.record(2000);
  assert.equal(counter.snapshot(60000).requestsPerMinute, 2); assert.equal(counter.snapshot(REQUEST_WINDOW_MS + 2000).requests, 0);
  const previousFetch = globalThis.fetch, previousUrl = process.env.SUPABASE_URL;
  const response = new Response("fixture"); const calls: unknown[] = [];
  globalThis.fetch = (async (...args: unknown[]) => { calls.push(args); return response; }) as typeof fetch;
  process.env.SUPABASE_URL = "https://qa.example.test";
  try {
    installBackgroundRequestMetrics(); const init = { method: "POST", body: "fixture" };
    assert.equal(await fetch("https://qa.example.test/rest/v1/rpc/poll_inssa_execution_job", init), response);
    await fetch("https://other.example.test/rest/v1/items"); await fetch("https://qa.example.test/storage/v1/object");
    assert.deepEqual(calls[0], ["https://qa.example.test/rest/v1/rpc/poll_inssa_execution_job", init]); assert.equal(backgroundRequestSnapshot()?.requests, 1);
  } finally { globalThis.fetch = previousFetch; if (previousUrl) process.env.SUPABASE_URL = previousUrl; else delete process.env.SUPABASE_URL; }
});
