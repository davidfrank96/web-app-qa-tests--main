import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getRepoRoot } from "./paths";
import type { InssaEvidenceBundleRecord, InssaEvidenceItemRecord } from "./types";

export type InssaEvidenceStorageResult = {
  bundle: InssaEvidenceBundleRecord;
  items: InssaEvidenceItemRecord[];
  message: string;
  status: "local_only" | "uploaded" | "failed";
};

type EvidenceStorageConfig =
  | {
      provider: "local";
    }
  | {
      bucket: string;
      provider: "supabase";
      serviceRoleKey: string;
      supabaseUrl: string;
    };

type UploadVerification = {
  sha256: string;
  sizeBytes: number;
};

type SupabaseStorageAdminClient = {
  storage: {
    createBucket(bucketName: string, options: { public: boolean }): Promise<{ error: { message: string } | null }>;
    getBucket(bucketName: string): Promise<{ error: { message: string } | null }>;
  };
};

type SupabaseEvidenceBucket = {
  download(storageKey: string): Promise<{ data: Blob; error: null } | { data: null; error: { message: string } }>;
  upload(
    storageKey: string,
    body: Buffer,
    options: { contentType: string; upsert: boolean }
  ): Promise<{ error: { message: string } | null }>;
};

export async function persistEvidenceBundleToDurableStorage(
  bundle: InssaEvidenceBundleRecord,
  items: InssaEvidenceItemRecord[]
): Promise<InssaEvidenceStorageResult> {
  try {
    const config = readEvidenceStorageConfig();
    if (config.provider === "local") {
      return {
        bundle: markBundleLocalOnly(bundle),
        items: items.map(markItemLocalOnly),
        message: "Durable evidence storage is not configured; evidence remains on the local filesystem.",
        status: "local_only"
      };
    }
    return await uploadBundleToSupabase(config, bundle, items);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      bundle: markBundleUploadFailed(bundle, message),
      items: items.map((item) => markItemUploadFailed(item, message)),
      message: `Durable evidence upload failed; local filesystem evidence remains available. ${message}`,
      status: "failed"
    };
  }
}

export async function downloadEvidenceItemFromDurableStorage(item: InssaEvidenceItemRecord): Promise<Buffer> {
  if (item.storageBackend !== "supabase-storage" || item.uploadStatus !== "uploaded") {
    throw new Error("Evidence item is not available from durable storage.");
  }

  const config = readEvidenceStorageConfig();
  if (config.provider !== "supabase") {
    throw new Error("Durable evidence storage is not configured for Supabase retrieval.");
  }

  const storageKey = normalizeStorageKey(item.storageKey);
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });
  const download = await client.storage.from(config.bucket).download(storageKey);
  if (download.error) {
    throw new Error(`Supabase Storage download failed: ${download.error.message}`);
  }

  return verifyEvidenceItemBytes(item, Buffer.from(await download.data.arrayBuffer()));
}

export function verifyEvidenceItemBytes(item: InssaEvidenceItemRecord, bytes: Buffer): Buffer {
  if (bytes.byteLength !== item.sizeBytes) {
    throw new Error(`Durable evidence size verification failed: expected ${item.sizeBytes}, received ${bytes.byteLength}.`);
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== item.sha256) {
    throw new Error("Durable evidence checksum verification failed.");
  }
  return bytes;
}

function readEvidenceStorageConfig(): EvidenceStorageConfig {
  const provider = process.env.INSSA_EVIDENCE_STORAGE_PROVIDER?.trim().toLowerCase() ?? "local";
  if (provider !== "supabase") {
    return { provider: "local" };
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.INSSA_EVIDENCE_SUPABASE_BUCKET?.trim() || "inssa-evidence";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase evidence storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refusing an implicit local fallback."
    );
  }

  return {
    bucket,
    provider: "supabase",
    serviceRoleKey,
    supabaseUrl
  };
}

async function uploadBundleToSupabase(
  config: Extract<EvidenceStorageConfig, { provider: "supabase" }>,
  bundle: InssaEvidenceBundleRecord,
  items: InssaEvidenceItemRecord[]
): Promise<InssaEvidenceStorageResult> {
  const repoRoot = getRepoRoot();
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });
  const bucket = client.storage.from(config.bucket);
  const uploadedAt = new Date().toISOString();
  const storagePrefix = buildStoragePrefix(bundle);
  const uploadedItems: InssaEvidenceItemRecord[] = [];
  const checksumManifest: Record<string, string> = {};
  let totalBytes = 0;

  await ensureSupabaseBucket(client, config.bucket);

  for (const item of items) {
    const localRelativePath = normalizeRelativeEvidencePath(item.relativePath);
    const absolutePath = path.join(repoRoot, localRelativePath);
    assertInsideRepo(repoRoot, absolutePath);

    const body = await fs.readFile(absolutePath);
    const storageKey = `${storagePrefix}/${localRelativePath}`;
    const upload = await bucket.upload(storageKey, body, {
      contentType: item.contentType,
      upsert: false
    });
    // A retry may find an immutable key already present. Accept it only when the
    // persisted bytes exactly match the run's evidence metadata.
    let verification: UploadVerification;
    try {
      verification = await verifySupabaseObject(bucket, storageKey);
    } catch (error) {
      if (upload.error) {
        throw new Error(`Supabase Storage upload failed for ${localRelativePath}: ${upload.error.message}`);
      }
      throw error;
    }
    if (verification.sizeBytes !== item.sizeBytes) {
      throw new Error(
        `Supabase Storage size verification failed for ${localRelativePath}: expected ${item.sizeBytes}, received ${verification.sizeBytes}`
      );
    }
    if (verification.sha256 !== item.sha256) {
      throw new Error(
        `Supabase Storage checksum verification failed for ${localRelativePath}: expected ${item.sha256}, received ${verification.sha256}`
      );
    }
    checksumManifest[localRelativePath] = verification.sha256;
    totalBytes += verification.sizeBytes;
    uploadedItems.push({
      ...item,
      relativePath: localRelativePath,
      storageBackend: "supabase-storage",
      storageKey,
      uploadError: null,
      uploadStatus: "uploaded",
      uploadedAt
    });
  }

  return {
    bundle: {
      ...bundle,
      checksumManifest,
      storageBackend: "supabase-storage",
      storagePrefix,
      totalBytes,
      uploadError: null,
      uploadStatus: "uploaded",
      uploadedAt
    },
    items: uploadedItems,
    message: `Uploaded ${uploadedItems.length} evidence items to Supabase Storage bucket ${config.bucket}.`,
    status: "uploaded"
  };
}

async function ensureSupabaseBucket(client: SupabaseStorageAdminClient, bucketName: string) {
  const existing = await client.storage.getBucket(bucketName);
  if (!existing.error) {
    return;
  }

  const created = await client.storage.createBucket(bucketName, {
    public: false
  });
  if (created.error) {
    throw new Error(`Supabase Storage bucket is unavailable: ${bucketName}. ${created.error.message}`);
  }
}

async function verifySupabaseObject(
  bucket: SupabaseEvidenceBucket,
  storageKey: string
): Promise<UploadVerification> {
  const download = await bucket.download(storageKey);
  if (download.error) {
    throw new Error(`Supabase Storage verification download failed for ${storageKey}: ${download.error.message}`);
  }

  const bytes = Buffer.from(await download.data.arrayBuffer());
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength
  };
}

function buildStoragePrefix(bundle: InssaEvidenceBundleRecord) {
  return [
    "inssa",
    sanitizeStorageSegment(bundle.environment),
    sanitizeStorageSegment(bundle.campaignKey),
    sanitizeStorageSegment(bundle.runId),
    sanitizeStorageSegment(bundle.id)
  ].join("/");
}

function normalizeRelativeEvidencePath(relativePath: string) {
  const normalized = path.posix.normalize(relativePath.split(path.sep).join("/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid evidence item path: ${relativePath}`);
  }
  return normalized;
}

function normalizeStorageKey(storageKey: string) {
  const unixPath = storageKey.trim().replaceAll("\\", "/");
  if (!unixPath || unixPath.includes("\0") || unixPath.startsWith("/") || unixPath.split("/").includes("..")) {
    throw new Error("Invalid durable evidence storage key.");
  }
  const normalized = path.posix.normalize(unixPath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Invalid durable evidence storage key.");
  }
  return normalized;
}

function assertInsideRepo(repoRoot: string, absolutePath: string) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Evidence item path escapes the repository: ${absolutePath}`);
  }
}

function sanitizeStorageSegment(segment: string) {
  return segment.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function markBundleLocalOnly(bundle: InssaEvidenceBundleRecord): InssaEvidenceBundleRecord {
  return {
    ...bundle,
    uploadError: null,
    uploadStatus: "local_only",
    uploadedAt: null
  };
}

function markItemLocalOnly(item: InssaEvidenceItemRecord): InssaEvidenceItemRecord {
  return {
    ...item,
    uploadError: null,
    uploadStatus: "local_only",
    uploadedAt: null
  };
}

function markBundleUploadFailed(bundle: InssaEvidenceBundleRecord, message: string): InssaEvidenceBundleRecord {
  return {
    ...bundle,
    uploadError: message,
    uploadStatus: "failed",
    uploadedAt: null
  };
}

function markItemUploadFailed(item: InssaEvidenceItemRecord, message: string): InssaEvidenceItemRecord {
  return {
    ...item,
    uploadError: message,
    uploadStatus: "failed",
    uploadedAt: null
  };
}
