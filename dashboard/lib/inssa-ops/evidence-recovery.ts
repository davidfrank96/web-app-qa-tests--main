import fs from "node:fs/promises";
import { validateEvidenceManifest } from "./evidence-integrity";
import { readVerifiedSource } from "./evidence-storage";
import { getRepoRoot } from "./paths";
import type { InssaEvidenceBundleRecord, InssaEvidenceItemRecord } from "./types";

export const HISTORICAL_EVIDENCE_UNAVAILABLE = "EVIDENCE_UNAVAILABLE_AFTER_EPHEMERAL_RUN";
export async function classifyHistoricalEvidenceSources(bundle: InssaEvidenceBundleRecord, items: InssaEvidenceItemRecord[]) {
  validateEvidenceManifest(bundle.runId, bundle, items);
  const root = await fs.realpath(getRepoRoot());
  let verified = 0, missing = 0;
  for (const item of items) {
    try { await readVerifiedSource(root, item); verified++; }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") missing++;
      else throw error; // Corruption/access errors are not proof that source bytes are gone.
    }
  }
  return { classification: missing ? "SOURCE_BYTES_GONE" as const : "RECOVERABLE_BYTES_PRESENT" as const, verified, missing };
}

export function markHistoricalEvidenceUnavailable(bundle: InssaEvidenceBundleRecord, items: InssaEvidenceItemRecord[]) {
  if (bundle.uploadStatus === "uploaded" || items.some((item) => item.uploadStatus === "uploaded")) {
    throw new Error("Cannot mark durable evidence unavailable because its local source is missing.");
  }
  return { bundle: { ...bundle, uploadStatus: "failed" as const, uploadError: HISTORICAL_EVIDENCE_UNAVAILABLE },
    items: items.map((item) => ({ ...item, uploadStatus: "failed" as const, uploadError: HISTORICAL_EVIDENCE_UNAVAILABLE })) };
}
