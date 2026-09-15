import { getInssaPhase1Command } from "../../lib/inssa-ops/command-registry";
import { RETENTION_POLICY_VERSION } from "../../lib/inssa-ops/retention";
import type { RetentionSnapshot } from "../../lib/inssa-ops/retention-types";
import type { InssaRunStatus } from "../../lib/inssa-ops/types";
export const AS_OF = "2026-09-14T22:00:00.000Z";
const ago = (days: number) => new Date(Date.parse(AS_OF) - days * 86_400_000).toISOString();
export function fixture(days = 31, status: InssaRunStatus = "passed"): RetentionSnapshot {
  const createdAt = ago(days), hash = "a".repeat(64);
  return {
    revision: "fixture-revision", consistent: true, holds: [], cleanup: [], deletions: [],
    policies: [{ id: RETENTION_POLICY_VERSION, mode: "enforced", effectiveAt: "2026-09-14T00:00:00Z",
      routineDays: 21, failureDays: 90, securityDays: 90, postCleanupDays: 30 }],
    runs: [{ id: "run-1", campaignKey: "test_inssa_safe", commandSnapshot: getInssaPhase1Command("test_inssa_safe")!,
      createdAt, completedAt: createdAt, updatedAt: createdAt, startedAt: createdAt, durationMs: 0, exitCode: 0, requestedBy: "fixture", status }],
    bundles: [{ id: "bundle-1", runId: "run-1", campaignKey: "test_inssa_safe", title: "Fixture", product: "INSSA", environment: "staging",
      bundleType: "playwright", status: "indexed", retentionClass: "short-lived", rootPath: "/fixture", sourceArtifactId: null,
      itemCount: 1, totalBytes: 3, checksumManifest: { "one.json": hash }, sensitive: false, storageBackend: "supabase-storage",
      storagePrefix: "fixture", uploadStatus: "uploaded", uploadedAt: createdAt, uploadError: null, createdAt, indexedAt: createdAt }],
    items: [{ id: "item-1", bundleId: "bundle-1", runId: "run-1", campaignKey: "test_inssa_safe", artifactId: "artifact-1", itemType: "JSON Artifact",
      fileName: "one.json", relativePath: "one.json", contentType: "application/json", sizeBytes: 3, sha256: hash, sensitive: false,
      renderInline: false, retentionClass: "short-lived", storageBackend: "supabase-storage", storageKey: "fixture/one.json",
      uploadStatus: "uploaded", uploadedAt: createdAt, uploadError: null, metadata: {}, createdAt }],
    objects: [{ id: "object-1", name: "fixture/one.json", sizeBytes: 3, createdAt, updatedAt: createdAt }]
  };
}
