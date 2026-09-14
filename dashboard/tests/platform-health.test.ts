import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GET } from "../app/api/health/route";

test("health independently detects stale processes, caches bounded dependency checks, and stays sanitized", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-health-wave1-")), previous = { ...process.env };
  let requests = 0, hang = false;
  const server = createServer((req,res) => {
    requests++; if (hang) return;
    res.setHeader("content-type","application/json");
    if (req.url === "/rest/v1/campaign_runs?select=id&limit=1") {
      // These provider results must not change infrastructure health.
      res.end(JSON.stringify([{ id: "qa-fixture", overallStatus: "degraded", google: "blocked_external", apple: "missing_configuration" }]));
    } else if (req.url === "/storage/v1/bucket/private-fixture") res.end('{"public":false}');
    else { res.writeHead(500); res.end('{}'); }
  });
  await new Promise<void>((resolve) => server.listen(0,"127.0.0.1",resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  Object.assign(process.env, { INSSA_QA_REPO_ROOT: root, INSSA_OPS_METADATA_STORE: "supabase",
    SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_SERVICE_ROLE_KEY: "never-expose-this-fixture-credential",
    INSSA_EVIDENCE_STORAGE_PROVIDER: "supabase", INSSA_EVIDENCE_SUPABASE_BUCKET: "private-fixture" });
  t.after(async () => { server.closeAllConnections(); server.close();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env,previous); await fs.rm(root,{recursive:true,force:true}); });
  const data = path.join(root,"dashboard/.data"); await fs.mkdir(path.join(data,"dashboard-runtime.lock"),{recursive:true});
  await fs.writeFile(path.join(data,"dashboard-runtime.lock/owner.json"),JSON.stringify({mode:"start",pid:process.pid,token:"fixture-owner"}));
  async function heartbeat(role: string, age = 0) { await fs.writeFile(path.join(data,`${role}-liveness.json`),
    JSON.stringify({at:new Date(Date.now()-age).toISOString(),pid:process.pid,ownerToken:"fixture-owner"})); }
  await heartbeat("worker"); await heartbeat("scheduler");
  let response = await GET(), body = await response.json();
  assert.equal(response.status,200); assert.equal(body.platformInfrastructure,"healthy");
  assert.equal(body.supabase,"healthy"); assert.equal(body.evidenceProvider,"supabase"); assert.equal(requests,2);
  for (const privateValue of [root,process.env.SUPABASE_SERVICE_ROLE_KEY!,"fixture-owner","blocked_external","missing_configuration"]) {
    assert.equal(JSON.stringify(body).includes(privateValue),false);
  }
  await heartbeat("worker",65_000); response = await GET(); body = await response.json();
  assert.equal(response.status,503); assert.equal(body.worker,"stale"); assert.equal(body.scheduler,"healthy");
  await heartbeat("worker"); await heartbeat("scheduler",190_000); response=await GET(); body=await response.json();
  assert.equal(response.status,503); assert.equal(body.scheduler,"stale"); assert.equal(body.worker,"healthy");
  assert.equal(requests,2,"Dependency reads must be coalesced/cached across health requests");
  await heartbeat("scheduler"); hang=true;
  // Change the credential to start a new cached probe without waiting out the TTL.
  process.env.SUPABASE_SERVICE_ROLE_KEY="second-test-only-credential";
  const started=Date.now(); response=await GET(); body=await response.json();
  assert.ok(Date.now()-started < 3_000); assert.equal(response.status,503);
  assert.equal(body.supabase,"unhealthy"); assert.equal(body.evidenceProvider,"misconfigured");
});
