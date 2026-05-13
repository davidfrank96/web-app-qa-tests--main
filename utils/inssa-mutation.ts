import { createHash } from "crypto";

export const INSSA_QA_CAPSULE_PREFIX = "QA_TEST_CAPSULE";
export const INSSA_QA_CAPSULE_MARKER = "qa_test_capsule";
export const INSSA_MUTATION_ENV_FLAG = "INSSA_ENABLE_MUTATION_TESTS";
export const INSSA_MUTATION_RUN_TOKEN_ENV = "INSSA_MUTATION_RUN_TOKEN";

export type InssaCleanupCapabilities = {
  accountScopedCleanupVerified: boolean;
  apiCleanupEndpoint: boolean;
  composeRestoreSource: "session-storage-wizard";
  cleanupTransport: "firestore-write-channel" | "none-discovered";
  draftDiscardVerified: boolean;
  draftDiscardUi: boolean;
  draftsListDiscardVerified: boolean;
  draftsListRestoreVerified: boolean;
  directComposeReopenLoadsPersistedDraft: boolean;
  draftRecoveryDeterministic: boolean;
  draftWriteObserved: boolean;
  liveDiscoverySource: "authenticated-surface-audit";
  notes: string[];
  saveExitClearsComposeSessionCache: boolean;
  uiArchiveCapsule: boolean;
  uiDeleteCapsule: boolean;
  uiEditCapsule: boolean;
  uiHideCapsule: boolean;
  uiSaveExitDraft: boolean;
};

export type InssaMutationReadiness = {
  blockers: string[];
  draftOnlyReady: boolean;
  lifecycleReady: boolean;
  preferredCleanupPath: "draft-discard-ui" | "drafts-list-discard-ui" | "none-verified";
};

export type InssaMutationRunContext = {
  environmentTag: string;
  logicalKey: string;
  marker: string;
  runId: string;
  runToken: string;
  subjectPrefix: string;
};

const DEFAULT_RUN_TOKEN = createDefaultRunToken();

export type InssaQaCapsuleSeed = {
  message: string;
  subject: string;
};

const DISCOVERED_CLEANUP_CAPABILITIES: InssaCleanupCapabilities = {
  accountScopedCleanupVerified: false,
  apiCleanupEndpoint: false,
  composeRestoreSource: "session-storage-wizard",
  cleanupTransport: "firestore-write-channel",
  draftDiscardVerified: true,
  draftDiscardUi: true,
  draftsListDiscardVerified: true,
  draftsListRestoreVerified: true,
  directComposeReopenLoadsPersistedDraft: false,
  draftRecoveryDeterministic: false,
  draftWriteObserved: true,
  liveDiscoverySource: "authenticated-surface-audit",
  notes: [
    "Authenticated compose exposes Discard draft and Save & exit.",
    "The compose wizard caches draft state in sessionStorage under timecapsule-refresh:* and timecapsule-initial-draft:* keys.",
    "Draft persistence and cleanup are transported over Firestore Write/Listen channels rather than a dedicated app cleanup endpoint.",
    "Save & exit flushes the current draft and then explicitly removes the compose sessionStorage keys before returning home.",
    "Direct /timecapsule reopen after Save & exit does not load the persisted authored draft; it boots from route/query defaults and can seed a fresh template-backed draft session.",
    "Opening the same persisted draft id from /messages?tab=1&drafts=1 was verified, but the compose fields still reopened with template/location defaults instead of the authored QA subject/body values.",
    "Saved draft reopen, refresh, and re-login did not restore the QA-authored subject/body deterministically; compose came back with default location-based content instead.",
    "No delete, archive, hide, or edit capsule controls were verified on the audited stable surfaces.",
    "No dedicated capsule cleanup endpoint was discovered from the audited network traffic.",
    "Direct anonymous /timecapsule access redirects to /signin but does not preserve next= consistently."
  ],
  saveExitClearsComposeSessionCache: true,
  uiArchiveCapsule: false,
  uiDeleteCapsule: false,
  uiEditCapsule: false,
  uiHideCapsule: false,
  uiSaveExitDraft: true
};

export function getInssaCleanupCapabilities(): InssaCleanupCapabilities {
  return {
    ...DISCOVERED_CLEANUP_CAPABILITIES,
    notes: [...DISCOVERED_CLEANUP_CAPABILITIES.notes]
  };
}

export function getInssaMutationReadiness(
  capabilities: InssaCleanupCapabilities = getInssaCleanupCapabilities()
): InssaMutationReadiness {
  const blockers: string[] = [];

  if (!capabilities.draftDiscardUi) {
    blockers.push("Draft discard UI was not verified.");
  }

  if (!capabilities.draftDiscardVerified) {
    blockers.push("Draft discard has not been verified to remove the QA artifact after reopen.");
  }

  if (!capabilities.draftRecoveryDeterministic) {
    blockers.push("Saved drafts do not currently restore deterministic QA-authored content.");
  }

  if (!capabilities.directComposeReopenLoadsPersistedDraft) {
    blockers.push("Direct /timecapsule reopen uses session/template bootstrapping instead of hydrating the persisted authored draft.");
  }

  if (!capabilities.apiCleanupEndpoint && !capabilities.uiDeleteCapsule && !capabilities.uiArchiveCapsule) {
    blockers.push("No verified capsule cleanup path exists for created or published capsules.");
  }

  if (!capabilities.accountScopedCleanupVerified) {
    blockers.push("Cleanup permissions have not been verified as safely scoped to the QA account.");
  }

  return {
    blockers,
    draftOnlyReady:
      capabilities.draftsListRestoreVerified && capabilities.draftsListDiscardVerified && capabilities.draftWriteObserved,
    lifecycleReady:
      capabilities.draftsListRestoreVerified &&
      capabilities.draftsListDiscardVerified &&
      capabilities.draftRecoveryDeterministic &&
      capabilities.directComposeReopenLoadsPersistedDraft &&
      capabilities.accountScopedCleanupVerified &&
      (capabilities.apiCleanupEndpoint || capabilities.uiDeleteCapsule || capabilities.uiArchiveCapsule),
    preferredCleanupPath: capabilities.draftsListDiscardVerified
      ? "drafts-list-discard-ui"
      : capabilities.draftDiscardUi
        ? "draft-discard-ui"
        : "none-verified"
  };
}

export function createInssaMutationRunContext(input: {
  file?: string;
  projectName?: string;
  retry?: number;
  title?: string;
} = {}): InssaMutationRunContext {
  const logicalParts = [input.projectName ?? "inssa", input.file ?? "unknown-file", input.title ?? "unknown-title"];
  const logicalKey = createHash("sha1").update(logicalParts.join("\n")).digest("hex").slice(0, 12);
  const runToken = process.env[INSSA_MUTATION_RUN_TOKEN_ENV]?.trim() || DEFAULT_RUN_TOKEN;
  const retrySuffix = input.retry && input.retry > 0 ? `-r${input.retry}` : "";
  const runId = `${logicalKey}-${runToken}${retrySuffix}`;

  return {
    environmentTag: "staging",
    logicalKey,
    marker: INSSA_QA_CAPSULE_MARKER,
    runId,
    runToken,
    subjectPrefix: `${INSSA_QA_CAPSULE_PREFIX}_${runId}`
  };
}

export function buildInssaQaCapsuleSeed(
  runContext: InssaMutationRunContext,
  input: {
    bodySuffix?: string;
    subjectSuffix?: string;
  } = {}
): InssaQaCapsuleSeed {
  const subjectSuffix = sanitizeLabel(input.subjectSuffix ?? "text-only");
  const bodySuffix = sanitizeLabel(input.bodySuffix ?? "draft");

  return {
    message: [
      `${INSSA_QA_CAPSULE_PREFIX} run=${runContext.runId}`,
      `marker=${runContext.marker}`,
      `env=${runContext.environmentTag}`,
      `body=${bodySuffix}`
    ].join(" | "),
    subject: `${runContext.subjectPrefix}_${subjectSuffix}`
  };
}

export function assertInssaLifecycleMutationReady(
  capabilities: InssaCleanupCapabilities = getInssaCleanupCapabilities()
): void {
  const readiness = getInssaMutationReadiness(capabilities);
  if (!readiness.lifecycleReady) {
    throw new Error(
      `INSSA lifecycle mutation testing is not ready: ${readiness.blockers.join(" ")}`
    );
  }
}

export function assertInssaMutationFlagEnabled(): void {
  if (process.env[INSSA_MUTATION_ENV_FLAG] !== "1") {
    throw new Error(
      `INSSA mutation testing requires ${INSSA_MUTATION_ENV_FLAG}=1 to avoid accidental staging writes.`
    );
  }
}

export function isInssaQaArtifact(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  return (
    text.startsWith(INSSA_QA_CAPSULE_PREFIX) ||
    text.includes(INSSA_QA_CAPSULE_MARKER) ||
    /\bQA_TEST_CAPSULE_[a-f0-9]{12}-[a-f0-9]{10}(?:-r\d+)?\b/i.test(text)
  );
}

function createDefaultRunToken(): string {
  return createHash("sha1")
    .update([String(process.pid), new Date().toISOString()].join("\n"))
    .digest("hex")
    .slice(0, 10);
}

function sanitizeLabel(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "qa";
}
