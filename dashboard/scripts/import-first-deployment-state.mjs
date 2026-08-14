import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(dashboardRoot);

const apply = process.argv.includes("--apply");
const manifestArg = process.argv.find((argument) => argument.startsWith("--archive-manifest="));
const confirmedRef = process.env.SUPABASE_PROJECT_REF?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (!confirmedRef || confirmedRef !== projectRef) {
  throw new Error("SUPABASE_PROJECT_REF must exactly match the configured Supabase URL before operational-state import.");
}
if (!manifestArg) {
  throw new Error("--archive-manifest=<absolute path> is required before operational-state import.");
}

const archiveManifestPath = path.resolve(manifestArg.slice("--archive-manifest=".length));
const archiveManifest = JSON.parse(await fs.readFile(archiveManifestPath, "utf8"));

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

if ((await sha256(archiveManifest.archivePath)) !== archiveManifest.archiveSha256) {
  throw new Error("Pre-deployment archive checksum verification failed.");
}

const runStore = JSON.parse(await fs.readFile(path.join(dashboardRoot, ".data", "inssa-runs.json"), "utf8"));
const monitoringStore = JSON.parse(
  await fs.readFile(path.join(dashboardRoot, ".data", "monitoring-definitions.json"), "utf8")
);
const cleanupRecords = runStore.cleanupLedger ?? [];
const definitions = monitoringStore.definitions ?? [];

if (cleanupRecords.length !== 9) {
  throw new Error(`Expected exactly nine deferred cleanup records; found ${cleanupRecords.length}.`);
}
for (const record of cleanupRecords) {
  if (
    !record.id ||
    !record.originatingRunId ||
    !record.objectId ||
    !record.objectPath ||
    !record.retentionUntil ||
    record.dedicatedQaAccount !== true ||
    record.safelyAccounted !== true ||
    record.sensitiveValuesExcluded !== true
  ) {
    throw new Error(`Cleanup record ${record.id || "<missing id>"} is not safe for cutover.`);
  }
}

const cleanupRows = cleanupRecords.map((record) => ({
  affected_users: record.affectedUsers,
  campaign_key: record.campaignKey,
  created_at: record.createdAt,
  dedicated_qa_account: record.dedicatedQaAccount,
  deferred_at: record.deferredAt,
  environment: record.environment,
  evidence_paths: record.evidencePaths,
  id: record.id,
  media_type: record.mediaType,
  notes: record.notes,
  object_id: record.objectId,
  object_path: record.objectPath,
  object_type: record.objectType,
  originating_run_id: record.originatingRunId,
  owner_account: record.ownerAccount,
  product: record.product,
  reason_code: record.reasonCode,
  resulting_state: record.resultingState,
  resolved_at: record.resolvedAt,
  retention_until: record.retentionUntil,
  safely_accounted: record.safelyAccounted,
  schema_version: record.schemaVersion,
  security_sensitive: record.securitySensitive,
  selected_recipient: record.selectedRecipient,
  sensitive_values_excluded: record.sensitiveValuesExcluded,
  status: record.status,
  unexpected_data: record.unexpectedData,
  updated_at: record.updatedAt,
  verification_methods: record.verificationMethods
}));

const monitoringRows = definitions.map((definition) => ({
  campaign_id: definition.campaignId,
  created_at: definition.createdAt,
  enabled: definition.campaignId === "monitor_inssa_auth_production" ? false : definition.enabled,
  environment: definition.environment,
  evidence_policy: definition.evidencePolicy,
  id: definition.id,
  name: definition.name,
  notification_policy: definition.notificationPolicy,
  product: definition.product,
  retry_policy: definition.retryPolicy,
  run_policy: definition.runPolicy,
  schedule: null,
  schedule_config: definition.schedule,
  schema_version: definition.schemaVersion,
  severity: definition.severity,
  timeout_ms: definition.timeout,
  trigger_type: definition.triggerType,
  updated_at: definition.updatedAt
}));

console.log(`cutover target: ${projectRef.slice(0, 4)}...${projectRef.slice(-4)}`);
console.log(`cleanup records prepared: ${cleanupRows.length}`);
console.log(`monitoring definitions prepared: ${monitoringRows.length}`);
console.log("scheduler history prepared: 0 (fresh hosted scheduler state)");

if (!apply) {
  console.log("operational-state import: DRY RUN PASS");
  process.exit(0);
}

const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
for (const [table, rows] of [
  ["cleanup_ledger", cleanupRows],
  ["monitoring_definitions", monitoringRows]
]) {
  const { error } = await client.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`${table} import failed: ${error.message}`);
}

const cleanupIds = cleanupRows.map((record) => record.id);
const definitionIds = monitoringRows.map((record) => record.id);
const [{ data: importedCleanup, error: cleanupError }, { data: importedDefinitions, error: definitionError }] =
  await Promise.all([
    client.from("cleanup_ledger").select("id,status,retention_until").in("id", cleanupIds),
    client.from("monitoring_definitions").select("id,campaign_id,environment,enabled").in("id", definitionIds)
  ]);
if (cleanupError) throw new Error(`cleanup_ledger verification failed: ${cleanupError.message}`);
if (definitionError) throw new Error(`monitoring_definitions verification failed: ${definitionError.message}`);
if (importedCleanup?.length !== cleanupRows.length) throw new Error("Cleanup-ledger count verification failed.");
if (importedDefinitions?.length !== monitoringRows.length) throw new Error("Monitoring-definition count verification failed.");
if (importedDefinitions.some((definition) => definition.campaign_id === "monitor_inssa_auth_production" && definition.enabled)) {
  throw new Error("A production authentication monitoring definition remains scheduled after import.");
}
const stagingAuthenticationDefinitions = importedDefinitions.filter(
  (definition) => definition.campaign_id === "monitor_inssa_auth_staging" && definition.environment === "staging"
);
if (stagingAuthenticationDefinitions.length !== 2 || stagingAuthenticationDefinitions.some((definition) => !definition.enabled)) {
  throw new Error("The twice-daily staging authentication monitoring definitions were not imported as enabled.");
}

const receipt = {
  archiveManifestPath,
  cleanupRecordCount: importedCleanup.length,
  completedAt: new Date().toISOString(),
  importedTables: ["cleanup_ledger", "monitoring_definitions"],
  monitoringDefinitionCount: importedDefinitions.length,
  projectRefMasked: `${projectRef.slice(0, 4)}...${projectRef.slice(-4)}`,
  schedulerHistoryImported: false,
  schemaVersion: 1
};
const receiptPath = path.join(dashboardRoot, ".data", "first-deployment-cutover-receipt.json");
await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log("operational-state import: PASS");
console.log(`cutover receipt: ${receiptPath}`);
