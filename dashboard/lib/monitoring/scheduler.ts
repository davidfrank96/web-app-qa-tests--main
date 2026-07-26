import { getInssaRunStore } from "../inssa-ops/run-store";
import { startInssaPhase1Run } from "../inssa-ops/runner";
import { getInssaPhase1Command } from "../inssa-ops/command-registry";
import type { InssaRunRecord } from "../inssa-ops/types";
import { evaluateSchedule, getNextScheduledRun } from "./schedule-evaluator";
import { getSchedulerStore, type SchedulerStore } from "./scheduler-store";
import type { SchedulerDefinitionState } from "./scheduler-types";
import { getMonitoringDefinitionStore, type MonitoringDefinitionStore } from "./store";
import type { MonitoringDefinition } from "./types";

export type ScheduledJobResult =
  | { outcome: "queued"; runId: string }
  | { outcome: "deferred"; reason: string }
  | { outcome: "failed"; reason: string };

export type SchedulerEvaluationResult = {
  definitionsEvaluated: number;
  errors: string[];
  jobsQueued: number;
};

export async function evaluateSchedulerOnce(input: {
  at?: Date;
  definitionStore?: MonitoringDefinitionStore;
  enqueue?: (definition: MonitoringDefinition, occurrenceKey: string) => Promise<ScheduledJobResult>;
  schedulerId: string;
  schedulerStore?: SchedulerStore;
}): Promise<SchedulerEvaluationResult> {
  const at = input.at ?? new Date();
  const definitionStore = input.definitionStore ?? getMonitoringDefinitionStore();
  const schedulerStore = input.schedulerStore ?? getSchedulerStore();
  const enqueue = input.enqueue ?? enqueueScheduledRun;
  const page = await definitionStore.list({ enabled: true, triggerType: "schedule" }, 0, 100);
  const definitions = page.items;
  const errors: string[] = [];
  const definitionStates: SchedulerDefinitionState[] = [];
  const previousStates = new Map(
    (await schedulerStore.getStatus(Number.MAX_SAFE_INTEGER, at)).definitionStates.map((state) => [state.definitionId, state])
  );
  let jobsQueued = 0;

  for (const definition of definitions) {
    try {
      const window = evaluateSchedule(definition, at);
      if (!window) {
        definitionStates.push({
          definitionId: definition.id,
          lastRunAt: previousStates.get(definition.id)?.lastRunAt ?? null,
          nextRunAt: getNextScheduledRun(definition, at)
        });
        continue;
      }
      const claim = await schedulerStore.claimOccurrence({
        campaignId: definition.campaignId,
        claimedBy: input.schedulerId,
        definitionId: definition.id,
        occurrenceKey: window.occurrenceKey,
        scheduledFor: window.scheduledFor
      });
      let lastRunAt = claim.occurrence.status === "queued"
        ? claim.occurrence.scheduledFor
        : previousStates.get(definition.id)?.lastRunAt ?? null;
      if (claim.created) {
        const result = await enqueue(definition, window.occurrenceKey);
        if (result.outcome === "queued") {
          await schedulerStore.markQueued(window.occurrenceKey, result.runId);
          jobsQueued += 1;
          lastRunAt = window.scheduledFor;
        } else if (result.outcome === "deferred") {
          if (definition.runPolicy === "skip") {
            await schedulerStore.markSkipped(window.occurrenceKey, result.reason);
          }
        } else {
          await schedulerStore.markFailed(window.occurrenceKey, result.reason);
          errors.push(`${definition.id}: ${result.reason}`);
        }
      }
      definitionStates.push({ definitionId: definition.id, lastRunAt, nextRunAt: window.nextRunAt });
    } catch (error) {
      errors.push(`${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await schedulerStore.recordEvaluation({
    at,
    definitionStates,
    definitionsEvaluated: definitions.length,
    errorMessage: errors.length > 0 ? errors.join(" | ") : undefined,
    jobsQueued,
    schedulerId: input.schedulerId
  });
  return { definitionsEvaluated: definitions.length, errors, jobsQueued };
}

async function enqueueScheduledRun(definition: MonitoringDefinition, occurrenceKey: string): Promise<ScheduledJobResult> {
  const command = getInssaPhase1Command(definition.campaignId);
  if (!command) return { outcome: "failed", reason: `Unknown scheduled campaign: ${definition.campaignId}` };
  if (command.targetEnvironment && command.targetEnvironment !== definition.environment) {
    return {
      outcome: "failed",
      reason: `Monitoring environment ${definition.environment} does not match command target ${command.targetEnvironment}.`
    };
  }
  const active = (await getInssaRunStore().listRuns()).find(isActiveRun);
  if (active) return { outcome: "deferred", reason: `Active run ${active.id} prevents scheduling this occurrence.` };

  try {
    const result = await startInssaPhase1Run({
      campaignKey: definition.campaignId,
      idempotencyKey: `monitor:${occurrenceKey}`,
      requestedBy: `scheduler:${definition.id}`
    });
    if ("error" in result) {
      const reason = result.error ?? `Unable to enqueue scheduled campaign ${definition.campaignId}.`;
      return result.status === 409
        ? { outcome: "deferred", reason }
        : { outcome: "failed", reason };
    }
    return { outcome: "queued", runId: result.run.id };
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

function isActiveRun(run: InssaRunRecord) {
  return ["indexing_artifacts", "queued", "running", "starting"].includes(run.status);
}
