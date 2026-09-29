import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import {
  SpacesEvidenceStorage,
  SupabaseEvidenceStorage,
  storageProvider,
  type EvidenceStorageProvider,
} from "../lib/inssa-ops/storage-providers";
import {
  activeEvidenceProvider,
  evidenceLocation,
} from "../lib/inssa-ops/storage-provider-model";
import {
  providerForEvidenceItem,
  verifyStoredObject,
} from "../lib/inssa-ops/evidence-storage";
import {
  parseEvidenceRange,
  verifiedEvidenceResponse,
} from "../lib/inssa-ops/evidence-stream";
import type { InssaEvidenceItemRecord } from "../lib/inssa-ops/types";

import { miniReport } from "./fixtures/mini-report";
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
type Stored = { body: Buffer; type: string; sha: string };
function harness(provider: "supabase" | "spaces", t: TestContext) {
  const objects = new Map<string, Stored>();
  let fail = "";
  const calls: string[] = [];
  const oldFetch = globalThis.fetch;
  let store: EvidenceStorageProvider;
  const send = async (c: {
    constructor: { name: string };
    input: Record<string, any>;
  }) => {
    const op = c.constructor.name;
    const i = c.input;
    calls.push(op);
    if (fail === op) throw { $metadata: { httpStatusCode: 403 } };
    const o = objects.get(i.Key);
    if (op === "PutObjectCommand") {
      assert.equal(i.ACL, "private");
      assert.equal(i.IfNoneMatch, "*");
      if (o) throw { $metadata: { httpStatusCode: 412 } };
      objects.set(i.Key, {
        body: i.Body,
        type: i.ContentType,
        sha: i.Metadata.sha256,
      });
      return {};
    }
    if (op === "DeleteObjectCommand") {
      objects.delete(i.Key);
      return {};
    }
    if (op === "ListObjectsV2Command")
      return {
        Contents: [...objects]
          .filter(([k]) => k.startsWith(i.Prefix))
          .map(([Key, v]) => ({
            Key,
            Size: v.body.length,
            ETag: '"fixture"',
            LastModified: new Date(0),
          })),
      };
    if (!o) throw { $metadata: { httpStatusCode: 404 } };
    if (op === "HeadObjectCommand")
      return {
        ContentLength: o.body.length,
        ContentType: o.type,
        Metadata: { sha256: o.sha },
      };
    if (op === "GetObjectCommand") return { Body: Readable.from([o.body]) };
    throw new Error("Unexpected operation");
  };
  if (provider === "spaces") {
    const client = new S3Client({
      region: "lon1",
      endpoint: "https://lon1.digitaloceanspaces.com",
      credentials: {
        accessKeyId: "fixture-key",
        secretAccessKey: "fixture-secret",
      },
    });
    Object.defineProperty(client, "send", { value: send });
    store = new SpacesEvidenceStorage(client, "fixture-bucket");
    t.after(() => client.destroy());
  } else {
    globalThis.fetch = async (input, init) => {
      const u = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push(method);
      if (fail === method)
        return Response.json(
          { message: "fixture denied", statusCode: 403 },
          { status: 403 },
        );
      if (u.pathname.includes("/bucket/")) { calls.push("private-bucket-check"); return Response.json({ public: false }); }
      const key = decodeURIComponent(
        u.pathname.split("/fixture-bucket/")[1] ?? "",
      );
      const o = objects.get(key);
      if (u.pathname.includes("/object/sign/"))
        return Response.json({
          signedURL: "/object/sign/fixture-bucket/" + key + "?token=fixture",
        });
      if (u.pathname.includes("/object/list/")) {
        const { prefix, offset } = JSON.parse(String(init?.body));
        const entries = [...objects].filter(([k]) =>
          k.startsWith(prefix ? prefix + "/" : ""),
        );
        const data = new Map<string, object>();
        for (const [k, v] of entries) {
          const rest = k.slice(prefix ? prefix.length + 1 : 0);
          const name = rest.split("/")[0];
          data.set(
            name,
            rest.includes("/")
              ? { name, id: null }
              : {
                  name,
                  id: k,
                  metadata: { size: v.body.length, mimetype: v.type },
                },
          );
        }
        return Response.json([...data.values()].slice(offset, offset + 100));
      }
      if (method === "DELETE") {
        const { prefixes } = JSON.parse(String(init?.body));
        for (const k of prefixes) objects.delete(k);
        return Response.json([]);
      }
      if (method === "POST") {
        assert.equal(new Headers(init?.headers).get("x-upsert"), "false");
        if (o)
          return Response.json(
            { statusCode: 409, message: "exists" },
            { status: 409 },
          );
        const body = Buffer.from(init?.body as Buffer);
        objects.set(key, {
          body,
          type: new Headers(init?.headers).get("content-type")!,
          sha: digest(body),
        });
        return Response.json({ Key: key });
      }
      if (!o) return new Response(null, { status: 404 });
      if (u.pathname.includes("/object/info/")) return Response.json({ name: key, bucket_id: "fixture-bucket", size: o.body.length, content_type: o.type });
      // Model the live CDN: compressed HEAD responses omit the original byte length.
      if (method === "HEAD" && new Headers(init?.headers).get("accept-encoding") !== "identity") {
        return new Response(null, { headers: { "content-type": o.type, "content-encoding": "br" } });
      }
      if (method === "GET") assert.equal(new Headers(init?.headers).get("accept-encoding"), "identity");
      return new Response(method === "HEAD" ? null : new Uint8Array(o.body), {
        headers: {
          "content-type": o.type === "text/html" ? "text/plain" : o.type,
          "content-length": String(o.body.length),
        },
      });
    };
    store = new SupabaseEvidenceStorage(
      "https://fixture.example",
      "fixture-role",
      "fixture-bucket",
    );
    t.after(() => {
      globalThis.fetch = oldFetch;
    });
  }
  return {
    store,
    objects,
    calls,
    setFailure: (s: string) => {
      fail = s;
    },
    send,
  };
}
for (const provider of ["supabase", "spaces"] as const) {
  test(`${provider}: shared private provider contract and miniature relative report`, async (t) => {
    const { store, objects, calls } = harness(provider, t);
    for (const [name, type, body] of miniReport) {
      const b = Buffer.from(body);
      await store.put(`mini/${name}`, b, type, digest(b));
      assert.equal(await store.exists(`mini/${name}`), true);
      const h = await store.head(`mini/${name}`);
      assert.equal(h?.sizeBytes, b.length);
      assert.equal(h?.contentType, type);
      const chunks = [];
      for await (const chunk of await store.get(`mini/${name}`))
        chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), body);
      await verifyStoredObject(store, `mini/${name}`, {
        sizeBytes: b.length,
        sha256: digest(b),
      });
      assert.ok(
        (await store.createReadAccess(`mini/${name}`, 60)).startsWith(
          "https://",
        ),
      );
      await assert.rejects(
        store.put(`mini/${name}`, b, type, digest(b)),
        /CONFLICT/,
      );
    }
    assert.equal((await store.listPrefix("mini/")).length, 5);
      if(provider === "supabase") assert.equal(calls.filter(c=>c === "private-bucket-check").length,1);
    await assert.rejects(store.createReadAccess("mini/index.html", 301));
    await assert.rejects(
      verifyStoredObject(store, "mini/index.html", {
        sizeBytes: 1,
        sha256: "a".repeat(64),
      }),
      /size/,
    );
    await assert.rejects(
      verifyStoredObject(store, "mini/index.html", {
        sizeBytes: objects.get("mini/index.html")!.body.length,
        sha256: "a".repeat(64),
      }),
      /checksum/,
    );
    await store.delete([...objects.keys()]);
    assert.equal(objects.size, 0);
    assert.equal(await store.head("missing/file"), null);
    assert.equal(await store.exists("missing/file"), false);
    await assert.rejects(store.get("missing/file"), /NOT_FOUND/);
    await assert.rejects(
      store.put(
        "../escape",
        Buffer.from("x"),
        "text/plain",
        digest(Buffer.from("x")),
      ),
    );
  });
  test(`${provider}: access, upload, network and deletion failures are truthful`, async (t) => {
    const h = harness(provider, t);
    const b = Buffer.from("fixture");
    h.setFailure(provider === "spaces" ? "PutObjectCommand" : "POST");
    await assert.rejects(h.store.put("a/b", b, "text/plain", digest(b)));
    assert.equal(h.objects.size, 0);
    h.setFailure("");
    await h.store.put("a/b", b, "text/plain", digest(b));
    h.setFailure(provider === "spaces" ? "DeleteObjectCommand" : "DELETE");
    await assert.rejects(h.store.delete(["a/b"]));
    assert.equal(h.objects.size, 1);
    h.setFailure(provider === "spaces" ? "GetObjectCommand" : "GET");
    await assert.rejects(h.store.get("a/b"));
    await assert.rejects(
      h.store.put("a/c", b, "text/plain", "a".repeat(64)),
      /checksum/,
    );
  });
}
test("provider resolution is explicit, legacy-compatible and never falls across providers", async (t) => {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  process.env.INSSA_EVIDENCE_STORAGE_PROVIDER = "supabase";
  process.env.DO_SPACES_ACCESS_KEY_ID = "configured";
  assert.equal(activeEvidenceProvider(), "supabase");
  assert.equal(
    evidenceLocation({ storageBackend: "supabase-storage" }).provider,
    "supabase",
  );
  process.env.INSSA_EVIDENCE_STORAGE_PROVIDER = "invented";
  assert.throws(activeEvidenceProvider, /Unsupported/);
  assert.throws(
    () => evidenceLocation({ storageBackend: "spaces" }),
    /missing/,
  );
  assert.throws(
    () => evidenceLocation({ storageBackend: "unknown" }),
    /Unknown/,
  );
  Object.assign(process.env, {
    DO_SPACES_REGION: "lon1",
    DO_SPACES_ENDPOINT: "https://lon1.digitaloceanspaces.com",
    DO_SPACES_BUCKET: "fixture-bucket",
    DO_SPACES_SECRET_ACCESS_KEY: "fixture",
  });
  assert.throws(() => storageProvider("spaces", "wrong-bucket"), /match/);
  assert.throws(() =>
    providerForEvidenceItem({
      storageBackend: "unknown",
      uploadStatus: "uploaded",
    } as unknown as InssaEvidenceItemRecord),
  );
  delete process.env.DO_SPACES_SECRET_ACCESS_KEY;
  assert.throws(() => storageProvider("spaces"), /configuration/);
});
test("verified binary response supports bounded ranges and rejects corrupt bytes before responding", async (t) => {
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  Object.assign(process.env, {
    SUPABASE_URL: "https://fixture.example",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
  });
  const h = harness("supabase", t),
    b = Buffer.from("0123456789");
  await h.store.put("video/test.webm", b, "video/webm", digest(b));
  const item = {
    storageBackend: "supabase-storage",
    storageBucket: "fixture-bucket",
    uploadStatus: "uploaded",
    storageKey: "video/test.webm",
    sizeBytes: b.length,
    sha256: digest(b),
  } as InssaEvidenceItemRecord;
  const r = await verifiedEvidenceResponse(
    item,
    new Headers({ "content-type": "video/webm" }),
    "bytes=2-5",
  );
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await r.text(), "2345");
  assert.equal(
    (await verifiedEvidenceResponse(item, new Headers(), "bytes=99-")).status,
    416,
  );
  await assert.rejects(
    verifiedEvidenceResponse(
      { ...item, sha256: "a".repeat(64) },
      new Headers(),
      null,
    ),
    /integrity/,
  );
  assert.deepEqual(parseEvidenceRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.equal(parseEvidenceRange("bytes=0-1,3-4", 10), "invalid");
});

test("Spaces partial upload preserves a failed manifest and retries immutable keys", async (t) => {
  const env = { ...process.env },
    send = S3Client.prototype.send;
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "phase2-publication-"));
  t.after(async () => {
    process.env = env;
    Object.defineProperty(S3Client.prototype, "send", {
      value: send,
      configurable: true,
      writable: true,
    });
    await fs.rm(root, { recursive: true, force: true });
  });
  const h = harness("spaces", t);
  let puts = 0,
    partial = true;
  Object.defineProperty(S3Client.prototype, "send", {
    configurable: true,
    writable: true,
    value: async (c: any) => {
      if (c.constructor.name === "PutObjectCommand" && ++puts === 2 && partial)
        throw { $metadata: { httpStatusCode: 503 } };
      return h.send(c);
    },
  });
  Object.assign(process.env, {
    INSSA_QA_REPO_ROOT: root,
    INSSA_OPS_METADATA_STORE: "local",
    INSSA_EVIDENCE_STORAGE_PROVIDER: "spaces",
    DO_SPACES_REGION: "lon1",
    DO_SPACES_ENDPOINT: "https://lon1.digitaloceanspaces.com",
    DO_SPACES_BUCKET: "fixture-bucket",
    DO_SPACES_ACCESS_KEY_ID: "fixture",
    DO_SPACES_SECRET_ACCESS_KEY: "fixture",
  });
  const { fixture } = await import("./fixtures/retention"),
    { persistEvidenceBundleToDurableStorage } = await import(
      "../lib/inssa-ops/evidence-storage"
    );
  const s = fixture(),
    b = s.bundles[0];
  const bytes = Buffer.from("one");
  await fs.writeFile(path.join(root, "one.json"), bytes);
  await fs.writeFile(path.join(root, "two.json"), bytes);
  b.storageBackend = "local-filesystem";
  b.storagePrefix = null;
  b.uploadStatus = "local_only";
  b.itemCount = 2;
  b.totalBytes = 6;
  b.checksumManifest = { "one.json": digest(bytes), "two.json": digest(bytes) };
  s.items[0] = {
    ...s.items[0],
    storageBackend: "local-filesystem",
    uploadStatus: "local_only",
    sha256: digest(bytes),
  };
  s.items.push({
    ...s.items[0],
    id: "item-2",
    artifactId: "artifact-2",
    fileName: "two.json",
    relativePath: "two.json",
  });
  const failed = await persistEvidenceBundleToDurableStorage(b, s.items);
  assert.equal(failed.status, "failed");
  assert.ok(failed.items.every((i) => i.uploadStatus === "failed"));
  assert.equal(h.objects.size, 1);
  partial = false;
  puts = 0;
  const retry = await persistEvidenceBundleToDurableStorage(b, s.items);
  assert.equal(retry.status, "uploaded");
  assert.equal(h.objects.size, 2);
  assert.ok(retry.items.every((i) => i.storageBackend === "spaces"));
  process.env.INSSA_EVIDENCE_STORAGE_PROVIDER = "supabase";
  const repeated = await persistEvidenceBundleToDurableStorage(
    retry.bundle,
    retry.items,
  );
  assert.equal(repeated.status, "uploaded");
  assert.ok(repeated.items.every((i) => i.storageBackend === "spaces"));
});

test("network rejection is sanitized and never switches a Spaces object's provider", async (t) => {
  const client = new S3Client({
    region: "lon1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
  });
  t.after(() => client.destroy());
  Object.defineProperty(client, "send", {
    value: async () => {
      throw new Error("connection reset with private context");
    },
  });
  const store = new SpacesEvidenceStorage(client, "fixture-bucket");
  await assert.rejects(
    store.get("a/b"),
    (e) =>
      String(e).includes("UNAVAILABLE") &&
      !String(e).includes("private context"),
  );
});

test("report relative asset resolution finds the same recorded item in both providers",async()=>{
  const {resolvePlaywrightEvidenceBundlePath,findUploadedEvidenceItem}=await import("../lib/inssa-ops/evidence-serving");
  const artifact={artifactType:"Playwright Report",runId:"fixture",sensitive:false,filePath:"run-output/fixture/playwright-report/index.html"} as import("../lib/inssa-ops/types").InssaArtifactRecord;
  for(const backend of ["supabase-storage","spaces"] as const){
    for(const [name] of miniReport){
      const resolved=resolvePlaywrightEvidenceBundlePath(artifact,name.split("/"));
      const item={storageKey:`fixture/${name}`,storageBackend:backend,storageBucket:backend==="spaces"?"fixture-bucket":null,uploadStatus:"uploaded",relativePath:`run-output/fixture/playwright-report/${name}`} as InssaEvidenceItemRecord;
      assert.equal(findUploadedEvidenceItem([item],resolved.evidenceItemPath),item);
      assert.ok(resolved.contentType!=="application/octet-stream");
    }
  }
  assert.throws(()=>resolvePlaywrightEvidenceBundlePath(artifact,["..","secret"]));
});

test("private evidence proxy rejects unauthenticated access before object retrieval",async t=>{
  const env={...process.env};const fs=await import("node:fs/promises"),os=await import("node:os"),path=await import("node:path");
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"phase2-auth-boundary-"));
  t.after(async()=>{process.env=env;await fs.rm(root,{recursive:true,force:true});});
  Object.assign(process.env,{INSSA_QA_REPO_ROOT:root,INSSA_OPS_METADATA_STORE:"local"});delete process.env.NEXT_PUBLIC_SUPABASE_URL;delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const {GET}=await import("../app/api/artifacts/[id]/bundle/[[...relativePath]]/route");const {NextRequest}=await import("next/server");
  const response=await GET(new NextRequest("http://localhost/api/artifacts/11111111-1111-4111-8111-111111111111/bundle/index.html"),{params:Promise.resolve({id:"11111111-1111-4111-8111-111111111111",relativePath:["index.html"]})});
  assert.equal(response.status,401);
});

test("Supabase HTTP 400 absence requires a specific missing-object error, never a credential or bucket failure",async t=>{
  const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;});const store=new SupabaseEvidenceStorage("https://fixture.example","fixture","fixture-bucket");let message="Object not found";
  globalThis.fetch=async(_input,init)=>init?.method==="HEAD"?new Response(null,{status:400}):Response.json({statusCode:"404",error:"not_found",message},{status:400});
  assert.equal(await store.exists("a/b"),false);assert.equal(await store.head("a/b"),null);await assert.rejects(store.get("a/b"),/NOT_FOUND/);
  message="Bucket not found";await assert.rejects(store.exists("a/b"),/UNAVAILABLE/);message="Invalid JWT";await assert.rejects(store.head("a/b"),/UNAVAILABLE/);
});
