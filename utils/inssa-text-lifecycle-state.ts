export type InssaCleanupIdentityStatus = "captured" | "failed_cleanup_identity" | "not_finalized";

export function assertInssaContactSelectionTransition(input: {
  afterCount: number | null;
  beforeCount: number | null;
  targetIdentityVerified: boolean;
}) {
  if (input.beforeCount !== 0) {
    throw new Error(`Expected contact selection to begin at 0 selected; observed ${input.beforeCount ?? "unknown"}.`);
  }
  if (input.afterCount !== 1) {
    throw new Error(`Expected exactly 1 selected contact before finalization; observed ${input.afterCount ?? "unknown"}.`);
  }
  if (!input.targetIdentityVerified) {
    throw new Error("Selected contact does not match the approved secondary QA identity.");
  }
}

export function classifyInssaCleanupIdentity(input: {
  capsuleId: string | null;
  finalShareActionClicked: boolean;
  persistenceSucceeded: boolean;
}): InssaCleanupIdentityStatus {
  if (!input.finalShareActionClicked && !input.persistenceSucceeded) return "not_finalized";
  return input.capsuleId ? "captured" : "failed_cleanup_identity";
}

export function assertInssaCleanupOwnership(input: {
  capsuleId: string | null;
  cleanupInstruction: string;
  objectType: string | null;
  owner: string | null;
  resultingState: string | null;
}) {
  const missing = Object.entries(input)
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `failed_cleanup_identity: required cleanup ownership metadata is missing (${missing.join(", ")}). ` +
        "Cleanup Investigation Required; automatic retry is forbidden."
    );
  }
}
