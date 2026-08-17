import type { InssaRevealTimestampEvidence } from "../pages/inssa/time-capsule.page";

export function hasPersistedRevealSchedule(evidence: InssaRevealTimestampEvidence | null): boolean {
  if (!evidence?.scheduledAtIso || !Number.isFinite(Date.parse(evidence.scheduledAtIso))) {
    return false;
  }

  return evidence.candidateTimestamps.some(
    (candidate) => candidate.normalizedIso === evidence.scheduledAtIso && candidate.source === "network"
  );
}
