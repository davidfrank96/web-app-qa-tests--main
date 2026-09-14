import { ExecutionLeaseOwnershipError } from "./execution-job-store";
import type { InssaExecutionJobRecord } from "./types";

export type EvidencePublicationOwner = { jobId: string; workerId: string };
export type EvidencePublicationGuard = { assertSafe: () => Promise<void>; signal?: AbortSignal };

export function assertEvidenceExecutionSafety(input: {
  job: InssaExecutionJobRecord | null;
  owner: EvidencePublicationOwner;
  runId: string;
  leaseLost: boolean;
  processAlive: boolean;
}) {
  const { job, owner } = input;
  if (input.leaseLost || !job || job.id !== owner.jobId || job.runId !== input.runId || job.claimedBy !== owner.workerId ||
      !["claimed", "running"].includes(job.status) || !job.leaseExpiresAt || !(Date.parse(job.leaseExpiresAt) > Date.now())) {
    throw new ExecutionLeaseOwnershipError(owner.jobId, owner.workerId);
  }
  if (input.processAlive) throw new Error("EVIDENCE_UNAVAILABLE: campaign process tree is not stable.");
}
