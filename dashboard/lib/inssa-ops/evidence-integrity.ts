import path from "node:path";
import type { InssaEvidenceBundleRecord, InssaEvidenceItemRecord } from "./types";

export function validateEvidenceManifest(runId: string, bundle: InssaEvidenceBundleRecord | null, items: InssaEvidenceItemRecord[]) {
  if (!bundle) {
    if (items.length) throw new Error("Evidence items require a bundle.");
    return;
  }
  if (bundle.runId !== runId || bundle.itemCount !== items.length) throw new Error("Evidence item count or run mismatch.");
  const ids = new Set<string>();
  const manifest: Record<string, string> = {};
  let total = 0;
  for (const item of items) {
    const relative = item.relativePath;
    if (!relative || relative.includes("\\") || relative.includes("\0") || relative.split("/").includes("..") ||
        path.posix.isAbsolute(relative) || path.posix.normalize(relative) !== relative || relative === ".") {
      throw new Error("Invalid evidence item path.");
    }
    if (ids.has(item.id) || Object.hasOwn(manifest, relative) || item.bundleId !== bundle.id || item.runId !== runId ||
        item.campaignKey !== bundle.campaignKey || !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0) throw new Error("Corrupt evidence manifest.");
    if (item.uploadStatus !== bundle.uploadStatus || item.storageBackend !== bundle.storageBackend) {
      throw new Error("Inconsistent evidence upload state.");
    }
    if (bundle.uploadStatus === "uploaded" && (bundle.storageBackend !== "supabase-storage" || !bundle.storagePrefix ||
        !bundle.uploadedAt || !item.uploadedAt || item.storageKey !== `${bundle.storagePrefix}/${relative}`)) {
      throw new Error("Incomplete durable evidence metadata.");
    }
    ids.add(item.id);
    manifest[relative] = item.sha256;
    total += item.sizeBytes;
  }
  if (total !== bundle.totalBytes || Object.keys(bundle.checksumManifest).length !== items.length ||
      items.some((item) => bundle.checksumManifest[item.relativePath] !== item.sha256)) {
    throw new Error("Evidence checksum manifest or total bytes mismatch.");
  }
}

// A publication changes availability only. Existing evidence identities and bytes are immutable.
export function validateEvidenceReplacement(existing: { bundles: InssaEvidenceBundleRecord[]; items: InssaEvidenceItemRecord[] },
  bundle: InssaEvidenceBundleRecord | null, items: InssaEvidenceItemRecord[]) {
  if (!existing.bundles.length) return;
  const previous = existing.bundles[0];
  if (!bundle || existing.bundles.length !== 1 || previous.id !== bundle.id || existing.items.length !== items.length) {
    throw new Error("Cannot replace existing evidence identities.");
  }
  for (const old of existing.items) {
    const item = items.find((candidate) => candidate.id === old.id);
    if (!item || item.artifactId !== old.artifactId || item.relativePath !== old.relativePath || item.sha256 !== old.sha256 ||
        item.sizeBytes !== old.sizeBytes || (old.uploadStatus === "uploaded" &&
        (item.uploadStatus !== "uploaded" || old.storageKey !== item.storageKey))) {
      throw new Error("Cannot change or downgrade immutable evidence.");
    }
  }
  if (previous.uploadStatus === "uploaded" && (bundle.uploadStatus !== "uploaded" || previous.storagePrefix !== bundle.storagePrefix)) {
    throw new Error("Cannot downgrade uploaded evidence.");
  }
}
