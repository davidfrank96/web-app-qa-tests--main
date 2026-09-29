export type EvidenceStorageProviderId = "local" | "supabase" | "spaces";
export type DurableEvidenceProviderId = Exclude<
  EvidenceStorageProviderId,
  "local"
>;
export type EvidenceBackend =
  | "local-filesystem"
  | "supabase-storage"
  | "spaces";

export function providerFromBackend(
  backend: unknown,
): EvidenceStorageProviderId {
  if (backend === "supabase-storage") return "supabase";
  if (backend === "spaces") return "spaces";
  if (backend === "local-filesystem") return "local";
  throw new Error("Unknown evidence storage backend.");
}
export function isDurableBackend(backend: unknown): boolean {
  return backend === "supabase-storage" || backend === "spaces";
}
export function activeEvidenceProvider(): EvidenceStorageProviderId {
  const value =
    process.env.INSSA_EVIDENCE_STORAGE_PROVIDER?.trim().toLowerCase() ??
    "local";
  if (value === "local" || value === "supabase" || value === "spaces")
    return value;
  throw new Error("Unsupported evidence storage provider.");
}
export function safeStorageKey(key: string): string {
  if (
    !key ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.startsWith("/") ||
    key.split("/").some((s) => !s || s === "." || s === "..")
  )
    throw new Error("Invalid evidence storage key.");
  return key;
}
export function safeBucket(bucket: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error("Invalid evidence bucket.");
  return bucket;
}
export type EvidenceLocation = {
  provider: DurableEvidenceProviderId;
  bucket: string;
};
export function evidenceLocation(record: {
  storageBackend: unknown;
  storageBucket?: string | null;
}): EvidenceLocation {
  const provider = providerFromBackend(record.storageBackend);
  if (provider === "local")
    throw new Error("Local evidence has no durable location.");
  // Legacy Supabase rows predate bucket metadata. Spaces never uses an implicit bucket.
  const bucket =
    record.storageBucket ?? (provider === "supabase" ? "inssa-evidence" : null);
  if (!bucket) throw new Error("Durable evidence bucket missing.");
  return { provider, bucket: safeBucket(bucket) };
}
