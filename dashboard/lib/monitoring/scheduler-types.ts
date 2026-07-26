export type SchedulerOccurrenceStatus = "claimed" | "queued" | "failed" | "skipped";

export type SchedulerOccurrence = {
  campaignId: string;
  claimedBy: string;
  createdAt: string;
  definitionId: string;
  errorMessage: string | null;
  id: string;
  occurrenceKey: string;
  runId: string | null;
  scheduledFor: string;
  schemaVersion: 1;
  status: SchedulerOccurrenceStatus;
  updatedAt: string;
};

export type SchedulerDefinitionState = {
  definitionId: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export type SchedulerRuntimeStatus = {
  definitionsEvaluated: number;
  definitionStates: SchedulerDefinitionState[];
  heartbeatAt: string | null;
  jobsQueued: number;
  jobsQueuedToday: number;
  lastError: string | null;
  lastEvaluationAt: string | null;
  running: boolean;
  schedulerId: string | null;
  schemaVersion: 1;
  startedAt: string | null;
  updatedAt: string;
};
