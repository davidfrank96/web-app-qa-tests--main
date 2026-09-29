import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validateEvidenceManifest } from "./evidence-integrity";
import { getInssaPhase1Command } from "./command-registry";
import type { EvidenceStorageProvider, ObjectHead } from "./storage-providers";
import type { InssaEvidenceBundleRecord, InssaEvidenceItemRecord } from "./types";

export type MigrationState = "PLANNED" | "COPYING" | "DESTINATION_VERIFIED" | "METADATA_SWITCHED" | "SOURCE_PRESERVED" |
  "FAILED_RETRYABLE" | "BLOCKED_CHANGED_SOURCE" | "BLOCKED_PROTECTION" | "BLOCKED_SOURCE_INTEGRITY" | "BLOCKED_DESTINATION_CONFLICT" | "ROLLBACK_REQUIRED" | "ROLLED_BACK";
type Raw = Record<string, unknown>;
export type MigrationItem = Raw & { id: string; storage_backend: string; storage_bucket: string | null; storage_key: string;
  size_bytes: number; content_type: string; sha256: string };
export type MigrationSnapshot = { bundle: Raw & { id: string; run_id: string; storage_backend: string; storage_bucket: string | null;
  storage_prefix: string; total_bytes: number; item_count: number }; items: MigrationItem[]; run: Raw };
export type MigrationLedger = { id: string; bundle_id: string; state: MigrationState; source_snapshot: MigrationSnapshot;
  source_signature: string; destination_snapshot: MigrationSnapshot; destination_bucket: string; switched_at: string | null;
  rolled_back_at: string | null; attempts: number; item_count: number; total_bytes: number; error_code: string | null };
export type Inspection = { snapshot: MigrationSnapshot; signature: string; blocked: string | null };
export type MigrationProof = { items: { id: string; key: string; sha256: string; sizeBytes: number; contentType: string; sourceBucket: string; destinationBucket: string }[];
  sourceVerifiedAt: string; destinationVerifiedAt: string; exactPrefix: true; sourceHeads: (ObjectHead & { id: string })[] };
export interface MigrationStore {
  inspect(bundle: string): Promise<Inspection>;
  ledger(bundle: string): Promise<MigrationLedger | null>;
  step(bundle: string, action: string, args?: { owner?: string; bucket?: string; signature?: string; proof?: MigrationProof; error?: MigrationState }): Promise<MigrationLedger>;
}
// The migration engine has no delete capability, even when supplied a full provider.
export type MigrationSource = Pick<EvidenceStorageProvider, "id" | "bucket" | "get" | "head" | "listPrefix">;
export type MigrationDestination = MigrationSource & Pick<EvidenceStorageProvider, "put">;
export class MigrationError extends Error {
  constructor(public readonly code: MigrationState, detail: string = code) { super(detail); }
}
const columns = (v: Raw) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), x]));
const mime = (s: string) => s.split(";", 1)[0].trim().toLowerCase();
function check(condition: unknown, code: MigrationState): asserts condition { if (!condition) throw new MigrationError(code); }

export function validateMigrationSnapshot(snapshot: MigrationSnapshot, maxBytes: number) {
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 25 * 1024 * 1024, "BLOCKED_PROTECTION");
  const { bundle: b, items } = snapshot;
  const command = snapshot.run.command_snapshot as { key?: string; npmScript?: string } | undefined;
  const known = command?.key ? getInssaPhase1Command(command.key) : null;
  check(known && command && command.key === b.campaign_key && command.npmScript === known.npmScript &&
    ["passed", "passed_with_warnings"].includes(String(snapshot.run.status)) && !b.retention_tombstone &&
    !/security|cross.user/i.test(String(b.campaign_key)), "BLOCKED_PROTECTION");
  check(b.storage_backend === "supabase-storage" && (b.storage_bucket ?? "inssa-evidence") === "inssa-evidence", "BLOCKED_SOURCE_INTEGRITY");
  check(b.total_bytes <= maxBytes && items.length > 0 && items.length <= 5000, "BLOCKED_PROTECTION");
  try { validateEvidenceManifest(b.run_id, columns(b) as InssaEvidenceBundleRecord, items.map(i => columns(i) as InssaEvidenceItemRecord)); }
  catch { throw new MigrationError("BLOCKED_SOURCE_INTEGRITY"); }
  check(items.every(i => (i.storage_bucket ?? "inssa-evidence") === "inssa-evidence" && i.size_bytes <= maxBytes), "BLOCKED_SOURCE_INTEGRITY");
}

async function bytes(provider: MigrationSource, item: MigrationItem, signal: AbortSignal, code: MigrationState) {
  signal.throwIfAborted();
  const before = await provider.head(item.storage_key);
  check(before && before.sizeBytes === item.size_bytes && mime(before.contentType) === mime(item.content_type), code);
  if (before.sha256) check(before.sha256 === item.sha256, code);
  const stream = await provider.get(item.storage_key);
  const cancel = () => stream.destroy(new MigrationError("FAILED_RETRYABLE", "Migration time budget exhausted"));
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const hash = createHash("sha256"); const chunks: Buffer[] = []; let size = 0;
  try {
    for await (const chunk of stream) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length; check(size <= item.size_bytes, code); hash.update(part); chunks.push(part);
    }
  } finally { signal.removeEventListener("abort", cancel); stream.destroy(); }
  check(size === item.size_bytes && hash.digest("hex") === item.sha256, code);
  const after = await provider.head(item.storage_key);
  check(after && JSON.stringify(after) === JSON.stringify(before), code);
  return { body: Buffer.concat(chunks, size), head: before };
}
async function exactPrefix(provider: MigrationSource, snapshot: MigrationSnapshot, complete: boolean, code: MigrationState) {
  const listed = await provider.listPrefix(`${snapshot.bundle.storage_prefix}/`, Math.min(5000, snapshot.items.length + 1));
  const expected = new Map(snapshot.items.map(i => [i.storage_key, i.size_bytes]));
  check(new Set(listed.map(o => o.key)).size === listed.length && listed.every(o => expected.get(o.key) === o.sizeBytes), code);
  if (complete) check(listed.length === expected.size, code);
}

export async function verifyMigrationCopies(snapshot: MigrationSnapshot, source: MigrationSource, destination: MigrationSource,
  signal: AbortSignal, checkpoint: () => Promise<void> = async () => {}): Promise<MigrationProof> {
  check(source.id === "supabase" && source.bucket === "inssa-evidence" && destination.id === "spaces", "BLOCKED_DESTINATION_CONFLICT");
  await exactPrefix(source, snapshot, true, "BLOCKED_SOURCE_INTEGRITY");
  await exactPrefix(destination, snapshot, true, "BLOCKED_DESTINATION_CONFLICT");
  const sourceHeads: MigrationProof["sourceHeads"] = [];
  for (const item of snapshot.items) {
    await checkpoint();
    const result = await bytes(source, item, signal, "BLOCKED_SOURCE_INTEGRITY");
    sourceHeads.push({ id: item.id, ...result.head });
  }
  const sourceVerifiedAt = new Date().toISOString();
  for (const item of snapshot.items) { await checkpoint(); await bytes(destination, item, signal, "BLOCKED_DESTINATION_CONFLICT"); }
  await exactPrefix(destination, snapshot, true, "BLOCKED_DESTINATION_CONFLICT");
  return { items: [...snapshot.items].sort((a,b) => a.id.localeCompare(b.id)).map(i => ({ id: i.id, key: i.storage_key,
    sha256: i.sha256, sizeBytes: i.size_bytes, contentType: i.content_type, sourceBucket: i.storage_bucket ?? "inssa-evidence", destinationBucket: destination.bucket })),
    sourceVerifiedAt, destinationVerifiedAt: new Date().toISOString(), exactPrefix: true, sourceHeads };
}

export async function migrateEvidence(options: { bundle: string; store: MigrationStore; source: MigrationSource; destination: MigrationDestination;
  maxBytes: number; signal: AbortSignal; copyOnly?: boolean; verifyOnly?: boolean; rollback?: boolean; resume?: boolean;
  onCheckpoint?: (stage: string, ledger: MigrationLedger) => Promise<void> }) {
  const { bundle, store, source, destination, maxBytes, signal } = options;
  let ledger = await store.ledger(bundle);
  const inspection = await store.inspect(bundle);
  check(!inspection.blocked, "BLOCKED_PROTECTION");
  const snapshot = ledger?.source_snapshot ?? inspection.snapshot;
  if (ledger) check(isDeepStrictEqual(inspection.snapshot, ledger.switched_at && !ledger.rolled_back_at ? ledger.destination_snapshot : ledger.source_snapshot), "BLOCKED_CHANGED_SOURCE");
  validateMigrationSnapshot(snapshot, maxBytes);
  check(source.id === "supabase" && source.bucket === "inssa-evidence" && destination.id === "spaces" &&
    (!ledger || ledger.destination_bucket === destination.bucket), "BLOCKED_DESTINATION_CONFLICT");
  if (options.verifyOnly) {
    check(ledger, "BLOCKED_PROTECTION");
    return { ledger, proof: await verifyMigrationCopies(snapshot, source, destination, signal), readOnly: true };
  }
  check(!ledger || options.resume, "BLOCKED_PROTECTION");
  check(!options.rollback || ledger?.switched_at, "BLOCKED_PROTECTION");
  if (!ledger) ledger = await store.step(bundle, "plan", { bucket: destination.bucket, signature: inspection.signature });
  const owner = randomUUID();
  ledger = await store.step(bundle, "claim", { owner });
  const step = async (action: string, proof?: MigrationProof) => {
    signal.throwIfAborted(); ledger = await store.step(bundle, action, { owner, proof });
    await options.onCheckpoint?.(action, ledger); return ledger;
  };
  const heartbeat = async () => { await step("heartbeat"); };
  try {
    if (options.rollback) {
      const proof = await verifyMigrationCopies(snapshot, source, destination, signal, heartbeat);
      await step("rollback", proof); return { ledger, proof };
    }
    check(ledger.state !== "ROLLED_BACK", "BLOCKED_PROTECTION");
    if (!ledger.switched_at) {
      await step("copy");
      // Hash the ENTIRE source before the first destination put.
      await exactPrefix(source, snapshot, true, "BLOCKED_SOURCE_INTEGRITY");
      await exactPrefix(destination, snapshot, false, "BLOCKED_DESTINATION_CONFLICT");
      for (const item of snapshot.items) { await heartbeat(); await bytes(source, item, signal, "BLOCKED_SOURCE_INTEGRITY"); }
      for (const item of snapshot.items) {
        await heartbeat();
        if (!(await destination.head(item.storage_key))) {
          const verified = await bytes(source, item, signal, "BLOCKED_SOURCE_INTEGRITY");
          await heartbeat();
          // Conditional immutable put. An uncertain acknowledgement is resolved on resume by a full GET/hash.
          await destination.put(item.storage_key, verified.body, item.content_type, item.sha256);
        }
        await bytes(destination, item, signal, "BLOCKED_DESTINATION_CONFLICT");
        await options.onCheckpoint?.(`object:${item.id}`, ledger);
      }
      const proof = await verifyMigrationCopies(snapshot, source, destination, signal, heartbeat);
      await step("verify", proof);
      if (options.copyOnly) return { ledger, proof };
      await step("switch", proof);
    }
    const proof = await verifyMigrationCopies(snapshot, source, destination, signal, heartbeat);
    await step("preserve", proof);
    return { ledger, proof };
  } catch (error) {
    try { ledger = await store.step(bundle, "fail", { owner, error: error instanceof MigrationError ? error.code : "FAILED_RETRYABLE" }); }
    catch { /* Lost ownership or connection: the durable last checkpoint remains resumable. */ }
    throw error;
  } finally {
    try { await store.step(bundle, "release", { owner }); } catch { /* Lease expiry is the crash recovery path. */ }
  }
}
