import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";
import { migrateEvidence, MigrationError, validateMigrationSnapshot } from "../lib/inssa-ops/evidence-migration";
import { createMigrationStore } from "../lib/inssa-ops/evidence-migration-store";
import { spacesConfiguration, storageProvider } from "../lib/inssa-ops/storage-providers";

loadEnvConfig(process.cwd());
const { values } = parseArgs({ options: {
  "dry-run": { type: "boolean" }, execute: { type: "boolean" }, "copy-only": { type: "boolean" },
  "verify-only": { type: "boolean" }, resume: { type: "boolean" }, status: { type: "boolean" }, rollback: { type: "boolean" },
  bundle: { type: "string" }, limit: { type: "string", default: "5" }, "max-bytes": { type: "string", default: "26214400" },
  "time-limit": { type: "string", default: "600" }, after: { type: "string" }, confirm: { type: "string" }, help: { type: "boolean" },
}, strict: true, allowPositionals: false });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function main() {
  if (values.help) {
    console.log("Default: --dry-run --limit 5 --max-bytes 26214400. Use --after UUID for the next stable page.\n--execute requires --bundle UUID OR an explicit --limit, plus --confirm COPY_VERIFY_PRESERVE_SOURCE. Add --copy-only to pause before CAS.\n--resume requires --bundle. --verify-only and --status never write.\n--rollback --execute --resume --bundle UUID --confirm ROLLBACK_METADATA_PRESERVE_BOTH. No storage deletion exists."); return;
  }
  const limit = Number(values.limit), maxBytes = Number(values["max-bytes"]), seconds = Number(values["time-limit"]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 26214400 ||
    !Number.isInteger(seconds) || seconds < 1 || seconds > 900 || (values.bundle && !UUID.test(values.bundle)) || (values.after && !UUID.test(values.after))) throw new Error("Invalid migration bounds or ID.");
  const readonly = values.status || values["verify-only"];
  if ((values.execute && (readonly || values["dry-run"])) || (values["copy-only"] && !values.execute) ||
    (values.rollback && !values.execute) || ((values.resume || values.rollback || readonly) && !values.bundle)) throw new Error("Incompatible migration modes.");
  if (values.execute && ((!values.bundle && !process.argv.some(a => a === "--limit" || a.startsWith("--limit="))) || values.confirm !== (values.rollback ? "ROLLBACK_METADATA_PRESERVE_BOTH" : "COPY_VERIFY_PRESERVE_SOURCE"))) throw new Error("Execution requires an explicit bundle or limit and the exact confirmation phrase.");
  if (values.execute && process.env.INSSA_EVIDENCE_STORAGE_PROVIDER !== "spaces") throw new Error("New evidence writes must remain on Spaces.");
  const store = createMigrationStore(); const signal = AbortSignal.timeout(seconds * 1000);
  if (values.status) {
    const ledger = await store.ledger(values.bundle!);
    console.log(JSON.stringify({ mode: "STATUS", ledger: ledger ? { id: ledger.id, bundle: ledger.bundle_id, state: ledger.state, sourceSignature: ledger.source_signature,
      destinationBucket: ledger.destination_bucket, items: ledger.item_count, bytes: ledger.total_bytes, attempts: ledger.attempts, error: ledger.error_code,
      switchedAt: ledger.switched_at, rolledBackAt: ledger.rolled_back_at } : null })); return;
  }
  if (!values.execute && !values["verify-only"]) {
    const ids = values.bundle ? [values.bundle] : await store.candidates(limit, values.after);
    let budget = 0; const candidates = [];
    for (const id of ids) {
      signal.throwIfAborted(); const inspected = await store.inspect(id); let reason = inspected.blocked;
      if (await store.ledger(id)) reason = "MIGRATION_EXISTS_USE_EXPLICIT_RESUME";
      try { validateMigrationSnapshot(inspected.snapshot, maxBytes); } catch (e) { reason = e instanceof MigrationError ? e.code : "BLOCKED_SOURCE_INTEGRITY"; }
      const bytes = inspected.snapshot?.bundle.total_bytes ?? 0;
      if (!reason && budget + bytes > maxBytes) reason = "BATCH_BYTE_LIMIT";
      if (!reason) budget += bytes;
      candidates.push({ bundle: id, run: inspected.snapshot?.bundle.run_id, items: inspected.snapshot?.bundle.item_count, bytes, metadataEligible: !reason, sourceVerification: "REQUIRED_BEFORE_COPY", reason, sourceSignature: inspected.signature });
    }
    console.log(JSON.stringify({ mode: "DRY_RUN", mutations: 0, sourceDeletion: "NOT_AUTHORIZED", limit, maxBytes, selectedBytes: budget, candidates, nextCursor: ids.at(-1) ?? null })); return;
  }
  const bucket = spacesConfiguration().bucket;
  const ids = values.bundle ? [values.bundle] : await store.candidates(limit, values.after);
  let usedBytes = 0; let cursor = values.after ?? null;
  for (const id of ids) {
  signal.throwIfAborted();
  if (!values.bundle) {
    const inspected = await store.inspect(id);
    if (inspected.blocked || await store.ledger(id)) { console.log(JSON.stringify({ bundle: id, skipped: "PROTECTED_OR_ALREADY_PLANNED", nextCursor: id })); cursor = id; continue; }
    if (usedBytes + inspected.snapshot.bundle.total_bytes > maxBytes) { console.log(JSON.stringify({ stopped: "BATCH_BYTE_LIMIT", nextCursor: cursor })); break; }
  }
  // Printed before work so an interrupted batch always identifies the exact bundle to resume.
  console.log(JSON.stringify({ processing: id, previousCursor: cursor, concurrency: 1 }));
  const result = await migrateEvidence({ bundle: id, store, source: storageProvider("supabase", "inssa-evidence", signal),
    destination: storageProvider("spaces", bucket, signal), signal, maxBytes: maxBytes - usedBytes, copyOnly: values["copy-only"], verifyOnly: values["verify-only"], rollback: values.rollback, resume: values.resume });
  usedBytes += result.ledger.total_bytes; cursor = id;
  console.log(JSON.stringify({ mode: values["verify-only"] ? "VERIFY_ONLY" : values.rollback ? "ROLLBACK" : values["copy-only"] ? "COPY_ONLY" : "EXECUTE",
    migration: result.ledger.id, bundle: result.ledger.bundle_id, state: result.ledger.state, items: result.ledger.item_count,
    bytes: result.ledger.total_bytes, batchBytes: usedBytes, nextCursor: cursor, sourcePreserved: true, sourceDeletion: "NOT_AUTHORIZED", proof: result.proof }));
  }
}
main().catch(e => { console.error(JSON.stringify({ status: "BLOCKED", code: e instanceof MigrationError ? e.code : "FAILED_RETRYABLE", message: e instanceof MigrationError ? e.code : "Migration stopped; check configuration, bounds, mode and durable status." })); process.exitCode = 1; });
