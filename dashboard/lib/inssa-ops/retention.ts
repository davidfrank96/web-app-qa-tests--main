import { isAuthenticationMonitoringCampaign, parseAuthenticationMonitoringSummary } from "../monitoring/authentication-result";
import { createHash } from "node:crypto";
import { getInssaPhase1Command } from "./command-registry";
import { validateEvidenceManifest } from "./evidence-integrity";
import type { RetentionDecision, RetentionHold, RetentionPlan, RetentionSnapshot } from "./retention-types";

export const RETENTION_POLICY_VERSION = "evidence-retention-v3";
export const RETENTION_POLICY_V2 = "evidence-retention-v2";
export const RETENTION_POLICY_V1 = "evidence-retention-v1";

export function retentionSourceSignature(bundle: RetentionSnapshot["bundles"][number], items: RetentionSnapshot["items"]) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  return createHash("sha256").update(JSON.stringify(canonical({ bundle, items: [...items].sort((a, b) => a.id.localeCompare(b.id)) }))).digest("hex");
}

const DAY = 86_400_000;
const SUCCESS = new Set(["passed", "passed_with_warnings"]);
const FAILURE = new Set(["failed", "failed_startup", "timed_out", "cancelled"]);
const CLASSES = new Set(["short-lived", "default", "security-evidence", "cleanup-evidence", "siem-metadata"]);
const timestamp = (value: unknown): number => typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
const ordered = (values: string[]) => [...new Set(values)].sort();

function validHold(hold: RetentionHold) {
  const fields = [hold.runId, hold.bundleId, hold.itemId, hold.cleanupLedgerId];
  const index = ["run", "bundle", "item", "cleanup"].indexOf(hold.scope);
  const scopeValid = hold.scope === "global" ? fields.every((v) => v === null)
    : index >= 0 && fields.every((v, i) => i === index ? typeof v === "string" && !!v : v === null);
  return !!hold.id && scopeValid && !!hold.reason?.trim() && !!hold.createdBy?.trim() &&
    ["manual", "security_review", "incident", "cleanup", "compliance"].includes(hold.holdType) &&
    Number.isFinite(timestamp(hold.createdAt)) && (hold.status === "active"
      ? hold.releasedAt === null && hold.releasedBy === null
      : hold.status === "released" && !!hold.releasedBy?.trim() && timestamp(hold.releasedAt) >= timestamp(hold.createdAt));
}

// No store, filesystem, network or mutation capability is accepted by this evaluator.
export function evaluateRetention(snapshot: RetentionSnapshot, asOfInput: string, options: { routineDays?: 14 | 21 | 30; legacyV2?: boolean } = {}): RetentionPlan {
  const now = timestamp(asOfInput);
  if (!Number.isFinite(now)) throw new Error("A valid asOf timestamp is required.");
  const asOf = new Date(now).toISOString();
  const version = snapshot.policies.some((p) => p.id === RETENTION_POLICY_VERSION) ? RETENTION_POLICY_VERSION : snapshot.policies.some((p) => p.id === RETENTION_POLICY_V2) ? RETENTION_POLICY_V2 : RETENTION_POLICY_V1;
  const policy = snapshot.policies.find((p) => p.id === version);
  const routineDays = options.legacyV2 ? 21 : options.routineDays ?? policy?.routineDays ?? 30;
  const warningDays = options.legacyV2 || version !== RETENTION_POLICY_VERSION ? routineDays : policy?.warningDays ?? 60;
  const policyKnown = snapshot.policies.length > 0 && new Set(snapshot.policies.map((p) => p.id)).size === snapshot.policies.length &&
    snapshot.policies.every((p) => [RETENTION_POLICY_VERSION, RETENTION_POLICY_V2, RETENTION_POLICY_V1].includes(p.id) &&
      p.mode === (p.id === RETENTION_POLICY_V1 ? "dry_run_only" : "enforced") &&
      p.routineDays === (p.id === RETENTION_POLICY_V2 ? 21 : 30) &&
      (p.id !== RETENTION_POLICY_VERSION || p.warningDays === 60) &&
      p.failureDays === 90 && p.securityDays === 90 && p.postCleanupDays === 30 && timestamp(p.effectiveAt) <= now) &&
    [14, 21, 30].includes(routineDays);
  const holdsKnown = snapshot.holds.every(validHold);
  const reviewReasons = ordered([...(snapshot.consistent ? [] : ["SNAPSHOT_CHANGED"]),
    ...(policyKnown ? [] : ["POLICY_UNKNOWN"]), ...(holdsKnown ? [] : ["HOLD_STATE_UNKNOWN"])]);
  // A hold currently active also protects a historical plan. A release after asOf cannot erase a past hold.
  const activeHolds = snapshot.holds.filter((h) => h.status !== "released" || timestamp(h.releasedAt) > now);
  const runs = new Map(snapshot.runs.map((run) => [run.id, run]));
  const objects = new Map(snapshot.objects.map((object) => [object.name, object]));
  const keyCounts = new Map<string, number>();
  for (const item of snapshot.items) keyCounts.set(item.storageKey, (keyCounts.get(item.storageKey) ?? 0) + 1);
  const decisions: RetentionDecision[] = snapshot.bundles.map((bundle): RetentionDecision => {
    const review: string[] = [...reviewReasons];
    const protect: string[] = [];
    let indefinite = false;
    const items = snapshot.items.filter((item) => item.bundleId === bundle.id);
    const run = runs.get(bundle.runId);
    // Only a durable, unchanged deletion intent can explain missing objects. This is an in-memory
    // inventory for the SAME eligibility evaluator, never a reconstruction or Storage write.
    const pending = snapshot.deletions?.find((d) => d.bundleId === bundle.id && d.status !== "deleted");
    const bundleObjects = new Map(objects);
    if (pending) {
      if (pending.policyVersion !== RETENTION_POLICY_VERSION || pending.sourceSignature !== retentionSourceSignature(bundle, items) ||
          pending.originalObjectCount !== items.length || pending.originalByteCount !== bundle.totalBytes ||
          pending.expectedObjects.length !== items.length || new Set(pending.expectedObjects.map((o) => o.name)).size !== items.length ||
          pending.expectedObjects.some((o) => !items.some((i) => i.storageKey === o.name && i.sizeBytes === o.sizeBytes))) {
        review.push("DELETION_INTENT_INCONSISTENT");
      } else {
        for (const expected of pending.expectedObjects) {
          const actual = objects.get(expected.name);
          if (actual && (actual.id !== expected.id || actual.sizeBytes !== expected.sizeBytes ||
              actual.createdAt !== expected.createdAt || actual.updatedAt !== expected.updatedAt)) review.push("DELETION_OBJECT_CHANGED");
          if (!actual) bundleObjects.set(expected.name, expected);
        }
      }
    }
    const classes = ordered([bundle.retentionClass, ...items.map((item) => item.retentionClass)]);
    if (!snapshot.consistent) review.push("SNAPSHOT_CHANGED");
    if (!policyKnown) review.push("POLICY_UNKNOWN");
    if (!holdsKnown) review.push("HOLD_STATE_UNKNOWN");
    if (!run) review.push("RUN_MISSING");
    if (run && !SUCCESS.has(run.status) && !FAILURE.has(run.status)) review.push("ACTIVE_OR_UNKNOWN_RUN");
    if (run && (run.campaignKey !== bundle.campaignKey || run.id !== bundle.runId)) review.push("RUN_ASSOCIATION_AMBIGUOUS");
    if (classes.some((c) => !CLASSES.has(c))) review.push("RETENTION_CLASS_UNKNOWN");
    if (classes.includes("siem-metadata")) { protect.push("SIEM_METADATA_PRESERVED"); indefinite = true; }
    try { validateEvidenceManifest(bundle.runId, bundle, items); } catch { review.push("BUNDLE_INCONSISTENT"); }
    if (bundle.status !== "indexed" || !items.length) review.push("BUNDLE_INCONSISTENT");
    if (bundle.uploadStatus !== "uploaded" || bundle.storageBackend !== "supabase-storage" || bundle.uploadError ||
        items.some((item) => item.uploadStatus !== "uploaded" || item.uploadError)) review.push("UPLOAD_INCOMPLETE");
    for (const item of items) {
      const object = bundleObjects.get(item.storageKey);
      if (!object || !Number.isSafeInteger(object.sizeBytes) || object.sizeBytes !== item.sizeBytes ||
          keyCounts.get(item.storageKey) !== 1) review.push("STORAGE_INVENTORY_INCONSISTENT");
    }
    if (isAuthenticationMonitoringCampaign(bundle.campaignKey)) {
      try {
        const saved = items.find((i) => i.metadata.authenticationMonitoringResult)?.metadata.authenticationMonitoringResult;
        const result = parseAuthenticationMonitoringSummary(saved);
        if (result.runId !== bundle.runId || result.environment !== (bundle.campaignKey.endsWith("_production") ? "production" : "staging")) throw new Error("Result association mismatch");
      } catch { review.push("PROVIDER_RESULT_PRESERVATION_UNCERTAIN"); }
    }
    const command = run?.commandSnapshot;
    const known = command && getInssaPhase1Command(command.key);
    const commandKnown = !!known && command?.key === bundle.campaignKey && command.npmScript === known.npmScript &&
      command.riskLevel === known.riskLevel && command.mutatesStaging === known.mutatesStaging &&
      (command.cleanupRequired === true) === (known.cleanupRequired === true) &&
      (command.requiresSecondaryAccount === true) === (known.requiresSecondaryAccount === true);
    if (!commandKnown) review.push("SECURITY_CLASSIFICATION_UNCERTAIN");
    const manifest = run?.cleanup;
    if (manifest && manifest.runId !== bundle.runId) review.push("CLEANUP_ASSOCIATION_AMBIGUOUS");
    const capsuleIds = Array.isArray(manifest?.createdCapsuleIds) ? manifest.createdCapsuleIds : [];
    const mediaIds = Array.isArray(manifest?.createdMediaIds) ? manifest.createdMediaIds : [];
    const associated = snapshot.cleanup.filter((row) => row.originatingRunId === bundle.runId ||
      (row.objectType === "time_capsule" && capsuleIds.includes(row.objectId)) ||
      (row.objectType === "media" && mediaIds.includes(row.objectId)));
    const mutation = command?.mutatesStaging === true || command?.cleanupRequired === true || classes.includes("cleanup-evidence") ||
      capsuleIds.length > 0 || mediaIds.length > 0 || associated.length > 0 ||
      (!!manifest && (manifest.status !== "not_required" || !!manifest.retentionUntil));
    const security = classes.includes("security-evidence") || bundle.bundleType === "security" ||
      /security|cross.user|reveal.later/i.test(bundle.campaignKey) || command?.requiresSecondaryAccount === true ||
      associated.some((row) => row.securitySensitive || row.unexpectedData);
    const anchorValues = [bundle.createdAt, bundle.indexedAt, bundle.uploadedAt, run?.createdAt, run?.completedAt,
      ...items.flatMap((item) => [item.createdAt, item.uploadedAt]),
      ...items.flatMap((item) => { const object = bundleObjects.get(item.storageKey); return object ? [object.createdAt, object.updatedAt] : []; })];
    const times = anchorValues.map(timestamp);
    if (times.some((time) => !Number.isFinite(time) || time > now)) review.push("DATES_INCONSISTENT");
    const anchor = Math.max(...times.filter(Number.isFinite));
    const diagnosticItems = items.filter((item) => item.metadata.executionDiagnostics !== undefined);
    const diagnostics = diagnosticItems.map((item) => item.metadata.executionDiagnostics as Record<string, unknown> | null);
    if (diagnostics.some((d) => !d || d.schemaVersion !== 1 || d.state !== "available" ||
        typeof d.retryUsed !== "boolean" || typeof d.flaky !== "boolean")) review.push("EXECUTION_DIAGNOSTICS_UNKNOWN");
    const warning = run?.status === "passed_with_warnings" || diagnostics.some((d) => d?.retryUsed === true || d?.flaky === true);
    let expiry = anchor + (FAILURE.has(run?.status ?? "") ? 90 : warning ? warningDays : routineDays) * DAY;
    if (FAILURE.has(run?.status ?? "") && expiry > now) protect.push("FAILURE_WINDOW");
    if (SUCCESS.has(run?.status ?? "") && expiry > now) protect.push(warning && warningDays > routineDays ? "WARNING_RETRY_WINDOW" : "ROUTINE_WINDOW");
    if (security) {
      expiry = Math.max(expiry, anchor + 90 * DAY);
      if (anchor + 90 * DAY > now) protect.push("SECURITY_WINDOW");
    }
    if (mutation) {
      const missingObject = capsuleIds.some((id) => !associated.some((r) => r.objectType === "time_capsule" && r.objectId === id)) ||
        mediaIds.some((id) => !associated.some((r) => r.objectType === "media" && r.objectId === id));
      if (!manifest || manifest.runId !== bundle.runId || !associated.length || missingObject ||
          !Array.isArray(manifest.createdCapsuleIds) || !Array.isArray(manifest.createdMediaIds)) review.push("CLEANUP_ASSOCIATION_AMBIGUOUS");
      const unresolved = associated.some((row) => row.status !== "completed") ||
        (manifest && !["completed", "manually_confirmed"].includes(manifest.status));
      if (unresolved) { protect.push("UNRESOLVED_CLEANUP"); indefinite = true; }
      for (const row of associated) {
        const retentionUntil = timestamp(row.retentionUntil);
        if (!Number.isFinite(retentionUntil)) review.push("CLEANUP_DATES_UNKNOWN");
        else { expiry = Math.max(expiry, retentionUntil); if (retentionUntil > now) protect.push("CLEANUP_RETENTION_UNTIL"); }
        if (row.status === "completed") {
          const resolved = timestamp(row.resolvedAt);
          if (!Number.isFinite(resolved) || resolved > now) review.push("CLEANUP_RESOLUTION_UNKNOWN");
          else { expiry = Math.max(expiry, resolved + 30 * DAY); if (resolved + 30 * DAY > now) protect.push("POST_CLEANUP_WINDOW"); }
        }
      }
      if (manifest?.retentionUntil) {
        const until = timestamp(manifest.retentionUntil);
        if (!Number.isFinite(until)) review.push("CLEANUP_DATES_UNKNOWN");
        else { expiry = Math.max(expiry, until); if (until > now) protect.push("CLEANUP_RETENTION_UNTIL"); }
      }
      if (manifest && ["completed", "manually_confirmed"].includes(manifest.status)) {
        const resolved = Math.max(...[manifest.cleanupTimestamp, manifest.confirmedAt, manifest.verifiedAt].map(timestamp).filter(Number.isFinite));
        if (!Number.isFinite(resolved) || resolved > now) review.push("CLEANUP_RESOLUTION_UNKNOWN");
        else { expiry = Math.max(expiry, resolved + 30 * DAY); if (resolved + 30 * DAY > now) protect.push("POST_CLEANUP_WINDOW"); }
      }
    }
    for (const hold of activeHolds) {
      if (hold.scope === "global" || hold.runId === bundle.runId || hold.bundleId === bundle.id ||
          items.some((item) => item.id === hold.itemId) || associated.some((row) => row.id === hold.cleanupLedgerId)) {
        protect.push(`HOLD_${hold.holdType.toUpperCase()}:${hold.id}`); indefinite = true;
      }
    }
    const eligibilityReason = review.length ? "REVIEW_REQUIRED" : indefinite || expiry > now ? "PROTECTED" : "ELIGIBLE";
    return { bundleId: bundle.id, runId: bundle.runId, campaign: bundle.campaignKey, runStatus: run?.status ?? null,
      retentionClasses: classes, createdAt: bundle.createdAt, completedAt: run?.completedAt ?? null,
      expiryAt: indefinite || !Number.isFinite(expiry) ? null : new Date(expiry).toISOString(),
      objectCount: items.length, bytes: bundle.totalBytes, protectionReasons: ordered([...protect, ...review]), eligibilityReason };
  }).sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  const eligible = decisions.filter((row) => row.eligibilityReason === "ELIGIBLE");
  const protectedRows = decisions.filter((row) => row.eligibilityReason === "PROTECTED");
  const reviewRows = decisions.filter((row) => row.eligibilityReason === "REVIEW_REQUIRED");
  const retained = decisions.filter((row) => row.eligibilityReason !== "ELIGIBLE");
  const count = (pattern: RegExp) => retained.filter((row) => row.protectionReasons.some((reason) => pattern.test(reason))).length;
  const bytes = (rows: RetentionDecision[]) => rows.reduce((sum, row) => sum + row.bytes, 0);
  const oldest = [...eligible].sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt) || a.bundleId.localeCompare(b.bundleId))[0];
  const unreferenced = snapshot.objects.filter((object) => !keyCounts.has(object.name));
  const result: Omit<RetentionPlan, "planId"> = {
    mode: "DRY RUN ONLY", routineDays, warningDays, comparisonOnly: options.routineDays !== undefined || options.legacyV2 === true, policyVersion: policy?.id ?? RETENTION_POLICY_VERSION, asOf,
    snapshotRevision: snapshot.revision, reviewReasons, storageDeletionCalls: 0, metadataDeletionCalls: 0,
    summary: {
      bundlesScanned: decisions.length, eligibleBundles: eligible.length, protectedBundles: protectedRows.length,
      reviewRequiredBundles: reviewRows.length, eligibleBytes: bytes(eligible), protectedBytes: bytes(protectedRows),
      reviewRequiredBytes: bytes(reviewRows), totalEvidenceStorageBytes: snapshot.objects.reduce((sum, o) => sum + (o.sizeBytes ?? 0), 0),
      storageSizeComplete: snapshot.objects.every((o) => Number.isSafeInteger(o.sizeBytes) && o.sizeBytes! >= 0),
      protectedByHolds: count(/^HOLD_/), protectedFailedEvidence: count(/^FAILURE_WINDOW$/),
      protectedSecurityEvidence: count(/^SECURITY_WINDOW$/), protectedFailureOrSecurity: count(/^(FAILURE|SECURITY)_WINDOW$/),
      protectedCleanupEvidence: count(/^(UNRESOLVED_CLEANUP|POST_CLEANUP_WINDOW|CLEANUP_RETENTION_UNTIL)$/),
      protectedWarningEvidence: count(/^WARNING_RETRY_WINDOW$/),
      protectedWarningBytes: bytes(retained.filter((r) => r.protectionReasons.includes("WARNING_RETRY_WINDOW"))),
      protectedFailureOrSecurityBytes: bytes(retained.filter((r) => r.protectionReasons.some((p) => /^(FAILURE|SECURITY)_WINDOW$/.test(p)))),
      protectedCleanupBytes: bytes(retained.filter((r) => r.protectionReasons.some((p) => /^(UNRESOLVED_CLEANUP|POST_CLEANUP_WINDOW|CLEANUP_RETENTION_UNTIL)$/.test(p)))),
      activeHolds: activeHolds.length, unreferencedObjects: unreferenced.length,
      unreferencedBytes: unreferenced.reduce((sum, o) => sum + (o.sizeBytes ?? 0), 0),
      orphanItems: snapshot.items.filter((item) => !snapshot.bundles.some((b) => b.id === item.bundleId)).length,
      oldestEligibleBundle: oldest ? { bundleId: oldest.bundleId, createdAt: oldest.createdAt } : null
    }, bundles: decisions
  };
  return { planId: createHash("sha256").update(JSON.stringify(result)).digest("hex"), ...result };
}
