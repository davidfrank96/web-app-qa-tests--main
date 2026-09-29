import { createHash } from "node:crypto";
import { evidenceLocation } from "./storage-provider-model";
import { storageProvider } from "./storage-providers";
import type { RetentionObject, RetentionSnapshot } from "./retention-types";
import type { InssaEvidenceItemRecord } from "./types";

// Legacy SQL inventory and intents are always from the original Supabase bucket.
export function objectIdentity(o: RetentionObject) {
  return JSON.stringify([
    o.provider ?? "supabase",
    o.bucket ?? "inssa-evidence",
    o.name,
  ]);
}
export function itemIdentity(i: InssaEvidenceItemRecord) {
  try {
    const l = evidenceLocation(i);
    return JSON.stringify([l.provider, l.bucket, i.storageKey]);
  } catch {
    return JSON.stringify([i.storageBackend, i.storageBucket, i.storageKey]);
  }
}
export async function spacesRetentionInventory(
  snapshot: RetentionSnapshot,
): Promise<RetentionObject[]> {
  const buckets = new Set(
    snapshot.bundles
      .filter((b) => b.storageBackend === "spaces" && b.status !== "expired")
      .map((b) => evidenceLocation(b).bucket),
  );
  const objects: RetentionObject[] = [];
  for (const bucket of buckets) {
    const adapter = storageProvider("spaces", bucket);
    for (const o of await adapter.listPrefix("inssa/")) {
      if (!o.etag || !o.modifiedAt)
        throw new Error("Incomplete Spaces retention inventory.");
      const item = snapshot.items.find(
        (i) =>
          i.storageBackend === "spaces" &&
          i.storageBucket === bucket &&
          i.storageKey === o.key,
      );
      objects.push({
        provider: "spaces",
        bucket,
        name: o.key,
        sizeBytes: o.sizeBytes,
        id: createHash("sha256")
          .update(JSON.stringify([bucket, o.key, o.etag, o.modifiedAt]))
          .digest("hex"),
        etag: o.etag,
        sha256: item?.sha256,
        createdAt: o.modifiedAt,
        updatedAt: o.modifiedAt,
      });
    }
  }
  return objects;
}
