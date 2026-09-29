// Read-only, explicit operator regression probe; never runs on a polling interval.
import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { storageProvider } from "../lib/inssa-ops/storage-providers";
import { verifyStoredObject } from "../lib/inssa-ops/evidence-storage";
async function main() {
  if (process.argv[2] !== "--read-only")
    throw new Error("Explicit --read-only required.");
  loadEnvConfig(process.cwd());
  assert.equal(process.env.INSSA_EVIDENCE_STORAGE_PROVIDER, "supabase");
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const adapter = storageProvider("supabase");
  const checks = [];
  for (const [kind, mime, nested] of [
    ["report", "text/html", true],
    ["json", "application/json", false],
    ["screenshot", "image/png", false],
    ["video", "video/webm", false],
    ["nested-report-asset", "application/zip", true],
  ] as const) {
    let query = client
      .from("evidence_items")
      .select("id,relative_path,storage_key,size_bytes,sha256,content_type")
      .eq("upload_status", "uploaded")
      .eq("storage_backend", "supabase-storage")
      .eq("content_type", mime);
    if (nested) query = query.like("relative_path", "%playwright-report/%");
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data?.length)
      throw new Error(`Historical ${kind} unavailable.`);
    const i = data[0];
    await verifyStoredObject(adapter, i.storage_key, {
      sizeBytes: i.size_bytes,
      sha256: i.sha256,
    });
    checks.push({
      kind,
      itemId: i.id,
      path: i.relative_path,
      bytes: i.size_bytes,
      sha256: i.sha256,
      result: "PASS",
    });
  }
  console.log(
    JSON.stringify({ status: "PASS", readOnly: true, checks }, null, 2),
  );
}
main().catch(() => {
  console.error(
    "Historical read-only verification FAILED. No secret or response body logged.",
  );
  process.exitCode = 1;
});
