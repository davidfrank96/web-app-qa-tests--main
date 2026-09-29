// Explicit local canary only. Never invoked by CI, a worker, scheduler, or production startup.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import {
  storageProvider,
  spacesConfiguration,
} from "../lib/inssa-ops/storage-providers";
import { verifyStoredObject } from "../lib/inssa-ops/evidence-storage";
import { miniReport } from "../tests/fixtures/mini-report";

async function main() {
  if (process.argv[2] !== "--isolated-canary")
    throw new Error("Explicit --isolated-canary required.");
  loadEnvConfig(process.cwd());
  assert.equal(
    process.env.INSSA_EVIDENCE_STORAGE_PROVIDER,
    "supabase",
    "Active provider must stay Supabase.",
  );
  const config = spacesConfiguration();
  assert.equal(config.bucket, "kbean-qa-evidence");
  assert.equal(config.region, "lon1");
  const store = storageProvider("spaces"),
    prefix = `phase2-adapter-test/${randomUUID()}/`;
  const keys: string[] = [];
  const checks: object[] = [];
  console.log(JSON.stringify({ canaryPrefix: prefix }));
  try {
    assert.equal((await store.listPrefix(prefix)).length, 0);
    for (const [name, type, text] of miniReport) {
      const body = name.endsWith(".png")
        ? Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=",
            "base64",
          )
        : Buffer.from(text);
      const key = prefix + name,
        sha256 = createHash("sha256").update(body).digest("hex");
      keys.push(key);
      await store.put(key, body, type, sha256);
      const head = await store.head(key);
      assert.equal(head?.sizeBytes, body.length);
      assert.equal(head?.contentType, type);
      assert.equal(head?.sha256, sha256);
      await verifyStoredObject(store, key, { sizeBytes: body.length, sha256 });
      assert.equal(await store.exists(key), true);
      await assert.rejects(store.put(key, body, type, sha256), /CONFLICT/);
      const signed = await fetch(await store.createReadAccess(key, 60), {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      assert.equal(signed.status, 200);
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(await signed.arrayBuffer()))
          .digest("hex"),
        sha256,
      );
      const anonymous: Response = await fetch(
        `https://${config.bucket}.${config.region}.digitaloceanspaces.com/${key}`,
        { redirect: "error", signal: AbortSignal.timeout(20000) },
      );
      assert.equal(anonymous.status, 403);
      await anonymous.body?.cancel();
      checks.push({
        path: name,
        bytes: body.length,
        contentType: type,
        sha256,
        privateRead: "PASS",
        signedRead: "PASS",
        immutablePut: "PASS",
      });
    }
    assert.equal((await store.listPrefix(prefix)).length, miniReport.length);
  } finally {
    for (const key of keys) {
      assert.ok(key.startsWith(prefix));
      await store.delete([key]);
      assert.equal(await store.head(key), null);
    }
  }
  const remaining = await store.listPrefix("", 5000);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        prefix,
        checks,
        canaryObjectsRemaining: (await store.listPrefix(prefix)).length,
        bucketObjectsRemaining: remaining.length,
        activeWriteProvider: process.env.INSSA_EVIDENCE_STORAGE_PROVIDER,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(
    "Spaces adapter canary FAILED: " +
      (error?.name ?? "error") +
      ". Inspect scoped canary prefix and retry cleanup before closure. No credentials logged.",
  );
  process.exitCode = 1;
});
