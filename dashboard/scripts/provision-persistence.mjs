#!/usr/bin/env node

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const REQUIRED_TABLES = [
  "campaign_runs",
  "run_logs",
  "artifacts",
  "audit_events",
  "evidence_bundles",
  "evidence_items",
  "execution_jobs",
  "notification_outbox",
  "monitoring_definitions",
  "monitoring_schedule_occurrences",
  "scheduler_runtime_status"
];

const verifyOnly = process.argv.includes("--verify-only");
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const bucketName = process.env.INSSA_EVIDENCE_SUPABASE_BUCKET?.trim() || "inssa-evidence";

if (!supabaseUrl || !serviceRoleKey) {
  fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`
};

const missingTables = [];
for (const table of REQUIRED_TABLES) {
  let response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=0`, { headers });
  } catch (error) {
    fail(`Unable to reach Supabase while verifying ${table}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) missingTables.push(`${table} (HTTP ${response.status})`);
}

if (missingTables.length) {
  fail(`Persistence schema is incomplete: ${missingTables.join(", ")}. Apply every migration before provisioning storage.`);
}

const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
let bucket = await client.storage.getBucket(bucketName);
if (bucket.error) {
  if (verifyOnly) fail(`Private evidence bucket is missing: ${bucketName}.`);
  const created = await client.storage.createBucket(bucketName, { public: false });
  if (created.error) fail(`Unable to create private evidence bucket ${bucketName}: ${created.error.message}`);
  bucket = await client.storage.getBucket(bucketName);
}

if (bucket.error || !bucket.data) {
  fail(`Unable to verify evidence bucket ${bucketName}: ${bucket.error?.message ?? "unknown response"}`);
}
if (bucket.data.public) {
  fail(`Evidence bucket ${bucketName} is public. Set it to private before platform startup.`);
}

console.log(`persistence:${verifyOnly ? "verify" : "provision"} PASS`);
console.log(`Tables: ${REQUIRED_TABLES.length}/${REQUIRED_TABLES.length}`);
console.log(`Evidence bucket: ${bucketName} (private)`);

function fail(message) {
  console.error(`persistence:${verifyOnly ? "verify" : "provision"} FAIL`);
  console.error(message);
  process.exit(1);
}
