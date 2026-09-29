import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { validateEvidenceManifest } from "./evidence-integrity";
import { ExecutionLeaseOwnershipError } from "./execution-job-store";
import type { EvidencePublicationGuard } from "./evidence-safety";
import { getRepoRoot } from "./paths";
import type {
  InssaEvidenceBundleRecord,
  InssaEvidenceItemRecord,
} from "./types";
import {
  activeEvidenceProvider,
  evidenceLocation,
  isDurableBackend,
  safeStorageKey,
} from "./storage-provider-model";
import {
  EvidenceStorageError,
  storageProvider,
  type EvidenceStorageProvider,
} from "./storage-providers";

export type InssaEvidenceStorageResult = {
  bundle: InssaEvidenceBundleRecord;
  items: InssaEvidenceItemRecord[];
  message: string;
  status: "local_only" | "uploaded" | "failed";
};

export async function persistEvidenceBundleToDurableStorage(
  bundle: InssaEvidenceBundleRecord,
  items: InssaEvidenceItemRecord[],
  guard?: EvidencePublicationGuard,
): Promise<InssaEvidenceStorageResult> {
  try {
    const selected = activeEvidenceProvider();
    validateEvidenceManifest(bundle.runId, bundle, items);
    await guard?.assertSafe();
    // Re-publication never migrates an already durable object to the current write provider.
    const location =
      bundle.uploadStatus === "uploaded" ? evidenceLocation(bundle) : null;
    const provider = location?.provider ?? selected;
    if (provider === "local")
      return {
        bundle: {
          ...bundle,
          uploadStatus: "local_only",
          uploadError: null,
          uploadedAt: null,
        },
        items: items.map((item) => ({
          ...item,
          uploadStatus: "local_only",
          uploadError: null,
          uploadedAt: null,
        })),
        status: "local_only",
        message:
          "Durable evidence storage is not configured; evidence remains on the local filesystem.",
      };
    const adapter = storageProvider(provider, location?.bucket, guard?.signal);
    const root = await fs.realpath(getRepoRoot());
    for (const item of items) {
      await guard?.assertSafe();
      await readVerifiedSource(root, item);
    }
    if (process.env.INSSA_OPS_METADATA_STORE === "supabase") {
      const client = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );
      const prior = await client
        .from("evidence_bundles")
        .select("status")
        .eq("run_id", bundle.runId);
      if (prior.error)
        throw new Error("Evidence expiry state could not be checked.");
      if (prior.data.some((row) => row.status === "expired"))
        throw new Error(
          "Evidence expired under retention policy; publication is forbidden.",
        );
    }
    const prefix =
      bundle.uploadStatus === "uploaded"
        ? bundle.storagePrefix!
        : buildStoragePrefix(bundle);
    const backend =
      provider === "supabase"
        ? ("supabase-storage" as const)
        : ("spaces" as const);
    // Preserve null legacy bucket metadata on an idempotent historical publication.
    const bucket =
      bundle.uploadStatus === "uploaded"
        ? bundle.storageBucket
        : adapter.bucket;
    const uploadedAt = new Date().toISOString();
    const uploaded: InssaEvidenceItemRecord[] = [];
    for (const item of items) {
      const key = safeStorageKey(`${prefix}/${item.relativePath}`);
      const bytes = await readVerifiedSource(root, item);
      await guard?.assertSafe();
      try {
        await adapter.put(key, bytes, item.contentType, item.sha256);
      } catch (e) {
        if (!(e instanceof EvidenceStorageError && e.code === "CONFLICT"))
          throw e;
      }
      await verifyStoredObject(adapter, key, item);
      await guard?.assertSafe();
      uploaded.push({
        ...item,
        storageBackend: backend,
        storageBucket: bucket,
        storageKey: key,
        uploadStatus: "uploaded",
        uploadedAt,
        uploadError: null,
      });
    }
    return {
      bundle: {
        ...bundle,
        storageBackend: backend,
        storageBucket: bucket,
        storagePrefix: prefix,
        uploadStatus: "uploaded",
        uploadedAt,
        uploadError: null,
      },
      items: uploaded,
      status: "uploaded",
      message: `Uploaded ${uploaded.length} verified evidence items to ${provider} private storage.`,
    };
  } catch (error) {
    if (error instanceof ExecutionLeaseOwnershipError || guard?.signal?.aborted)
      throw error;
    const message =
      error instanceof Error ? error.message : "Evidence storage failure.";
    return {
      bundle: {
        ...bundle,
        uploadError: message,
        uploadStatus: "failed",
        uploadedAt: null,
      },
      items: items.map((item) => ({
        ...item,
        uploadError: message,
        uploadStatus: "failed",
        uploadedAt: null,
      })),
      status: "failed",
      message: `Durable evidence upload failed; source availability is not guaranteed. ${message}`,
    };
  }
}

export function providerForEvidenceItem(
  item: InssaEvidenceItemRecord,
  signal?: AbortSignal,
) {
  if (
    !isDurableBackend(item.storageBackend) ||
    item.uploadStatus !== "uploaded"
  )
    throw new Error("Evidence item is not available from durable storage.");
  const location = evidenceLocation(item);
  safeStorageKey(item.storageKey);
  return storageProvider(location.provider, location.bucket, signal);
}
export async function verifyStoredObject(
  adapter: EvidenceStorageProvider,
  key: string,
  item: Pick<InssaEvidenceItemRecord, "sha256" | "sizeBytes">,
) {
  const stream = await adapter.get(key);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > item.sizeBytes) {
      stream.destroy();
      throw new Error("Durable evidence size verification failed.");
    }
    hash.update(chunk);
  }
  if (size !== item.sizeBytes)
    throw new Error("Durable evidence size verification failed.");
  if (hash.digest("hex") !== item.sha256)
    throw new Error("Durable evidence checksum verification failed.");
}
export async function downloadEvidenceItemFromDurableStorage(
  item: InssaEvidenceItemRecord,
): Promise<Buffer> {
  const stream = await providerForEvidenceItem(item).get(item.storageKey);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > item.sizeBytes) {
      stream.destroy();
      throw new Error("Durable evidence size verification failed.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return verifyEvidenceItemBytes(item, Buffer.concat(chunks));
}
export function verifyEvidenceItemBytes(
  item: Pick<InssaEvidenceItemRecord, "sizeBytes" | "sha256">,
  bytes: Buffer,
): Buffer {
  if (bytes.byteLength !== item.sizeBytes)
    throw new Error(
      `Durable evidence size verification failed: expected ${item.sizeBytes}, received ${bytes.byteLength}.`,
    );
  if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
    throw new Error("Durable evidence checksum verification failed.");
  return bytes;
}
function buildStoragePrefix(bundle: InssaEvidenceBundleRecord) {
  return [
    "inssa",
    bundle.environment,
    bundle.campaignKey,
    bundle.runId,
    bundle.id,
  ]
    .map(
      (segment) =>
        segment.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
        "unknown",
    )
    .join("/");
}
export async function readVerifiedSource(
  repoRoot: string,
  item: InssaEvidenceItemRecord,
): Promise<Buffer> {
  safeStorageKey(item.relativePath);
  const absolute = await fs.realpath(path.resolve(repoRoot, item.relativePath));
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Evidence item path escapes the repository.");
  if (!(await fs.stat(absolute)).isFile())
    throw new Error("Evidence source is not a regular file.");
  return verifyEvidenceItemBytes(item, await fs.readFile(absolute));
}
