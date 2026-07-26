import { getNotificationOutboxStore } from "./notification-outbox";
import type {
  CreateNotificationOutboxInput,
  InssaExecutionJobRecord,
  InssaRunRecord,
  InssaRunStatus
} from "./types";

const PRODUCT = "INSSA";
const ENVIRONMENT = "staging";

export async function recordRunQueuedNotification(run: InssaRunRecord) {
  return emit({
    ...runContext(run),
    deduplicationKey: `run:${run.id}:run_queued`,
    eventType: "run_queued",
    message: `${run.commandSnapshot.displayName} was queued for execution.`,
    payload: { requestedBy: run.requestedBy, status: "queued" },
    severity: "informational",
    title: "Run queued"
  });
}

export async function recordRunStartedNotification(run: InssaRunRecord, attempt: number, workerId: string) {
  return emit({
    ...runContext(run),
    deduplicationKey: `run:${run.id}:run_started:${attempt}`,
    eventType: "run_started",
    message: `${run.commandSnapshot.displayName} started on the execution worker.`,
    payload: { attempt, workerId },
    severity: "informational",
    title: "Run started"
  });
}

export async function recordRunOutcomeNotification(
  run: InssaRunRecord,
  status: InssaRunStatus,
  durationMs: number,
  exitCode: number | null
) {
  const completed = status === "passed" || status === "passed_with_warnings";
  return emit({
    ...runContext(run),
    deduplicationKey: `run:${run.id}:${completed ? "run_completed" : "run_failed"}`,
    eventType: completed ? "run_completed" : "run_failed",
    message: `${run.commandSnapshot.displayName} finished with status ${status}.`,
    payload: { durationMs, exitCode, status },
    severity: completed ? (status === "passed_with_warnings" ? "low" : "informational") : "high",
    title: completed ? "Run completed" : "Run failed"
  });
}

export async function recordExecutionFailureNotification(run: InssaRunRecord, message: string) {
  return emit({
    ...runContext(run),
    deduplicationKey: `run:${run.id}:execution_failed`,
    eventType: "execution_failed",
    message: `The execution worker failed while processing ${run.commandSnapshot.displayName}: ${message}`,
    payload: { status: "failed_startup" },
    severity: "high",
    title: "Execution failure"
  });
}

export async function recordEvidenceUploadFailureNotification(run: InssaRunRecord, bundleId: string, message: string) {
  return emit({
    ...runContext(run),
    deduplicationKey: `run:${run.id}:evidence_upload_failed:${bundleId}`,
    eventType: "evidence_upload_failed",
    message: `Durable evidence upload failed for ${run.commandSnapshot.displayName}: ${message}`,
    payload: { bundleId },
    severity: "high",
    title: "Evidence upload failed"
  });
}

export async function recordWorkerRestartedNotification(workerId: string) {
  return emit({
    campaignId: null,
    correlationId: workerId,
    deduplicationKey: `worker:${workerId}:worker_restarted`,
    environment: ENVIRONMENT,
    eventType: "worker_restarted",
    message: "The INSSA execution worker started and is ready to claim jobs.",
    payload: { workerId },
    product: PRODUCT,
    runId: null,
    severity: "informational",
    title: "Worker restarted"
  });
}

export async function recordJobRecoveryNotifications(job: InssaExecutionJobRecord) {
  const context = {
    campaignId: job.campaignKey,
    correlationId: job.runId,
    environment: ENVIRONMENT,
    product: PRODUCT,
    runId: job.runId
  };
  await emit({
    ...context,
    deduplicationKey: `job:${job.id}:worker_lease_expired:${job.attempt}`,
    eventType: "worker_lease_expired",
    message: `The worker lease expired for execution attempt ${job.attempt}.`,
    payload: { attempt: job.attempt, jobId: job.id, recoveredStatus: job.status },
    severity: "high",
    title: "Worker lease expired"
  });
  await emit({
    ...context,
    deduplicationKey: `job:${job.id}:job_recovery:${job.attempt}`,
    eventType: "job_recovery",
    message: `Execution job recovery set the job status to ${job.status}.`,
    payload: { attempt: job.attempt, jobId: job.id, recoveredStatus: job.status },
    severity: job.status === "abandoned" ? "critical" : "medium",
    title: "Job recovery triggered"
  });
}

function runContext(run: InssaRunRecord) {
  return {
    campaignId: run.campaignKey,
    correlationId: run.id,
    environment: run.commandSnapshot.targetEnvironment ?? ENVIRONMENT,
    product: PRODUCT,
    runId: run.id
  };
}

async function emit(input: CreateNotificationOutboxInput) {
  try {
    return await getNotificationOutboxStore().create(input);
  } catch (error) {
    process.stderr.write(
      `Notification outbox persistence failed for ${input.eventType}: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return null;
  }
}
