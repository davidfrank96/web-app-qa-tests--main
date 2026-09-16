import type { InssaCleanupLedgerRecord, InssaEvidenceBundleRecord, InssaEvidenceItemRecord, InssaRunRecord } from "./types";

export type RetentionPolicy = {
  id: string;
  mode: "dry_run_only" | "enforced";
  effectiveAt: string;
  routineDays: number;
  warningDays?: number;
  failureDays: number;
  securityDays: number;
  postCleanupDays: number;
};
export type RetentionHold = {
  id: string;
  scope: "global" | "run" | "bundle" | "item" | "cleanup";
  runId: string | null;
  bundleId: string | null;
  itemId: string | null;
  cleanupLedgerId: string | null;
  reason: string;
  holdType: "manual" | "security_review" | "incident" | "cleanup" | "compliance";
  createdBy: string;
  createdAt: string;
  releasedAt: string | null;
  releasedBy: string | null;
  status: "active" | "released";
};
export type RetentionObject = { id: string; name: string; sizeBytes: number | null; createdAt: string; updatedAt: string };
export type RetentionSnapshot = {
  revision: string;
  consistent: boolean;
  policies: RetentionPolicy[];
  holds: RetentionHold[];
  runs: InssaRunRecord[];
  bundles: InssaEvidenceBundleRecord[];
  items: InssaEvidenceItemRecord[];
  cleanup: InssaCleanupLedgerRecord[];
  objects: RetentionObject[];
  deletions: RetentionDeletion[];
};
export type RetentionDecision = {
  bundleId: string;
  runId: string;
  campaign: string;
  runStatus: string | null;
  retentionClasses: string[];
  createdAt: string;
  completedAt: string | null;
  expiryAt: string | null;
  objectCount: number;
  bytes: number;
  protectionReasons: string[];
  eligibilityReason: "ELIGIBLE" | "PROTECTED" | "REVIEW_REQUIRED";
};
export type RetentionPlan = {
  mode: "DRY RUN ONLY";
  planId: string;
  policyVersion: string;
  routineDays: number;
  warningDays: number;
  comparisonOnly: boolean;
  asOf: string;
  snapshotRevision: string;
  reviewReasons: string[];
  storageDeletionCalls: 0;
  metadataDeletionCalls: 0;
  summary: {
    bundlesScanned: number;
    eligibleBundles: number;
    protectedBundles: number;
    reviewRequiredBundles: number;
    eligibleBytes: number;
    protectedBytes: number;
    reviewRequiredBytes: number;
    totalEvidenceStorageBytes: number;
    storageSizeComplete: boolean;
    protectedByHolds: number;
    protectedFailedEvidence: number;
    protectedSecurityEvidence: number;
    protectedFailureOrSecurity: number;
    protectedCleanupEvidence: number;
    protectedWarningEvidence: number;
    protectedWarningBytes: number;
    protectedFailureOrSecurityBytes: number;
    protectedCleanupBytes: number;
    activeHolds: number;
    unreferencedObjects: number;
    unreferencedBytes: number;
    orphanItems: number;
    oldestEligibleBundle: { bundleId: string; createdAt: string } | null;
  };
  bundles: RetentionDecision[];
};

export type RetentionDeletion = {
  id: string;
  bundleId: string;
  runId: string;
  campaignKey: string;
  sourceSignature: string;
  expectedObjects: RetentionObject[];
  policyVersion: string;
  retentionPlanId: string;
  status: "deleting" | "RETENTION_PARTIAL_FAILURE" | "deleted";
  originalObjectCount: number;
  originalByteCount: number;
};
export type RetentionTombstone = {
  authenticationMonitoringResult?: import("../monitoring/authentication-result").AuthenticationMonitoringSummary | null;
  runId: string; bundleId: string; campaignKey: string;
  originalObjectCount: number; originalByteCount: number; deletedAt: string;
  policyVersion: string; retentionPlanId: string; deletionReason: string; verificationStatus: "ABSENCE_VERIFIED";
};
export type RetentionHealth = {
  status: "HEALTHY" | "SKIPPED_ACTIVE_EXECUTION" | "PARTIAL_FAILURE" | "FAILED" | "STALE";
  enabled: boolean; schedule: string; nextScheduledAt: string; policyVersion: string; lastExecution: Record<string, unknown> | null; totalReclaimed: number;
};
