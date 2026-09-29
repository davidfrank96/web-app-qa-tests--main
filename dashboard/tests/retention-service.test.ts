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

test("Spaces IO binds reservations, verifies SHA before delete, and records only verified absence on partial failure",async t=>{
  const {S3Client}=await import("@aws-sdk/client-s3");const {Readable}=await import("node:stream");const {createHash}=await import("node:crypto");
  const env={...process.env},fetcher=globalThis.fetch,send=S3Client.prototype.send;
  t.after(()=>{process.env=env;globalThis.fetch=fetcher;Object.defineProperty(S3Client.prototype,"send",{value:send,configurable:true,writable:true});});
  Object.assign(process.env,{INSSA_OPS_METADATA_STORE:"supabase",SUPABASE_URL:"https://fixture.example",SUPABASE_SERVICE_ROLE_KEY:"fixture",INSSA_EVIDENCE_SUPABASE_BUCKET:"inssa-evidence",DO_SPACES_REGION:"lon1",DO_SPACES_ENDPOINT:"https://lon1.digitaloceanspaces.com",DO_SPACES_BUCKET:"fixture-bucket",DO_SPACES_ACCESS_KEY_ID:"fixture",DO_SPACES_SECRET_ACCESS_KEY:"fixture"});
  const bytes=Buffer.from("abc"),sha=createHash("sha256").update(bytes).digest("hex");const present=new Set(["fixture/one.json","fixture/two.json"]);let failDelete=true;const calls:{name:string;body:any}[]=[];
  Object.defineProperty(S3Client.prototype,"send",{configurable:true,writable:true,value:async(c:any)=>{
    assert.equal(c.input.Bucket,"fixture-bucket");const key=c.input.Key;
    if(c.constructor.name==="DeleteObjectCommand"){if(failDelete&&key.endsWith("two.json"))throw {$metadata:{httpStatusCode:503}};present.delete(key);return {};}
    if(!present.has(key))throw {$metadata:{httpStatusCode:404}};
    if(c.constructor.name==="HeadObjectCommand")return {ContentLength:3,ContentType:"application/json",ETag:"fixture",Metadata:{sha256:sha}};
    if(c.constructor.name==="GetObjectCommand")return {Body:Readable.from([bytes])};throw new Error("Unexpected request");
  }});
  globalThis.fetch=async(input,init)=>{const name=new URL(String(input)).pathname.split("/").at(-1)!;const body=JSON.parse(String(init?.body));calls.push({name,body});
    if(name==="retention_reserve_spaces_bundle")return Response.json({status:"RESERVED",remaining:body.p_present});
    assert.ok(name.startsWith("retention_"));return Response.json({});};
  const {fixture}=await import("./fixtures/retention");const snapshot=fixture(),bundle=snapshot.bundles[0];bundle.storageBackend="spaces";bundle.storageBucket="fixture-bucket";
  const objects=[...present].map(name=>({id:name,name,sizeBytes:3,createdAt:bundle.createdAt,updatedAt:bundle.createdAt,provider:"spaces" as const,bucket:"fixture-bucket",etag:"fixture",sha256:sha}));
  const io=createRetentionExecutorIO(),location={provider:"spaces" as const,bucket:"fixture-bucket"};
  await assert.rejects(io.remove([objects[0].name],location),/reservation/);
  await io.reserve({occurrence:"manual:fixture",owner:"fixture-owner",snapshot,bundleId:bundle.id,signature:"signature",planId:"plan",objects});
  await assert.rejects(io.remove(objects.map(o=>o.name),location));
  await assert.rejects(io.verifyAbsent(objects.map(o=>o.name),location));
  await io.settle("manual:fixture","fixture-owner",bundle.id,false,"partial");
  const partial=calls.at(-1)!;assert.equal(partial.name,"retention_settle_spaces_bundle");assert.deepEqual(partial.body.p_absent,[objects[0]]);assert.ok(partial.body.p_checked_at);
  failDelete=false;
  const retry=await io.reserve({occurrence:"manual:retry",owner:"fixture-owner",snapshot,bundleId:bundle.id,signature:"signature",planId:"plan",objects});assert.deepEqual(retry.remaining,[objects[1]]);
  await io.remove([objects[1].name],location);await io.verifyAbsent(objects.map(o=>o.name),location);await io.settle("manual:retry","fixture-owner",bundle.id,true,null);
  assert.equal(calls.at(-1)!.body.p_absent.length,2);assert.equal(present.size,0);
});
