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

export const DEFINITION_CACHE_MS = 10 * 60_000;
export const SCHEDULER_STATUS_INTERVAL_MS = 120_000;
// Owned by one scheduler process. Restart always reloads durable configuration/status.
export class SchedulerEvaluationCache {
  definitions: MonitoringDefinition[] | null = null;
  loadedAt = 0;
  states: SchedulerDefinitionState[] | null = null;
  terminal = new Map<string, { key: string; lastRunAt: string | null }>();
  writtenAt = 0;
  writtenState = "";
}

export async function evaluateSchedulerOnce(input: {
  at?: Date;
  cache?: SchedulerEvaluationCache;
  definitionStore?: MonitoringDefinitionStore;
  enqueue?: (definition: MonitoringDefinition, occurrenceKey: string) => Promise<ScheduledJobResult>;
  schedulerId: string;
  schedulerStore?: SchedulerStore;
}): Promise<SchedulerEvaluationResult> {
  const at = input.at ?? new Date();
  const definitionStore = input.definitionStore ?? getMonitoringDefinitionStore();
  const schedulerStore = input.schedulerStore ?? getSchedulerStore();
  const enqueue = input.enqueue ?? enqueueScheduledRun;
  const cache = input.cache ?? new SchedulerEvaluationCache();
  if (!cache.definitions || at.getTime() - cache.loadedAt >= DEFINITION_CACHE_MS || at.getTime() < cache.loadedAt) {
    const fresh: MonitoringDefinition[] = [];
    let cursor = 0;
    for (;;) {
      const page = await definitionStore.list({ enabled: true, triggerType: "schedule" }, cursor, 100);
      fresh.push(...page.items);
      if (!page.pagination.hasMore) break;
      const next = Number(page.pagination.nextCursor);
      if (!Number.isInteger(next) || next <= cursor) throw new Error("Invalid monitoring definition cursor");
      cursor = next;
    }
    cache.definitions = fresh;
    cache.loadedAt = at.getTime();
    const ids = new Set(fresh.map((definition) => definition.id));
    for (const id of cache.terminal.keys()) if (!ids.has(id)) cache.terminal.delete(id);
  }
  const definitions = cache.definitions;
  const errors: string[] = [];
  const definitionStates: SchedulerDefinitionState[] = [];
  cache.states ??= (await schedulerStore.getStatus(Number.MAX_SAFE_INTEGER, at)).definitionStates;
  const previousStates = new Map(cache.states.map((state) => [state.definitionId, state]));
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
      const terminal = cache.terminal.get(definition.id);
      if (terminal?.key === window.occurrenceKey) {
        definitionStates.push({ definitionId: definition.id, lastRunAt: terminal.lastRunAt, nextRunAt: window.nextRunAt });
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
      let terminalOutcome = ["queued", "skipped"].includes(claim.occurrence.status);
      if (claim.created) {
        // A cached definition never authorizes enqueue: reload and validate on the server.
        const fresh = await definitionStore.get(definition.id);
        const freshWindow = fresh?.enabled && fresh.triggerType === "schedule" ? evaluateSchedule(fresh, at) : null;
        if (!fresh || JSON.stringify(fresh) !== JSON.stringify(definition) || freshWindow?.occurrenceKey !== window.occurrenceKey) {
          cache.definitions = null;
          await schedulerStore.markFailed(window.occurrenceKey, "Monitoring configuration changed; refresh before enqueue.");
          continue;
        }
        const result = await enqueue(fresh, window.occurrenceKey);
        if (result.outcome === "queued") {
          await schedulerStore.markQueued(window.occurrenceKey, result.runId);
          jobsQueued += 1;
          lastRunAt = window.scheduledFor;
          terminalOutcome = true;
        } else if (result.outcome === "deferred") {
          if (definition.runPolicy === "skip") {
            await schedulerStore.markSkipped(window.occurrenceKey, result.reason);
            terminalOutcome = true;
          }
        } else {
          await schedulerStore.markFailed(window.occurrenceKey, result.reason);
          errors.push(`${definition.id}: ${result.reason}`);
        }
      }
      if (terminalOutcome) cache.terminal.set(definition.id, { key: window.occurrenceKey, lastRunAt });
      definitionStates.push({ definitionId: definition.id, lastRunAt, nextRunAt: window.nextRunAt });
    } catch (error) {
      errors.push(`${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  cache.states = definitionStates;
  const state = JSON.stringify({ definitionStates, errors, count: definitions.length });
  if (jobsQueued || errors.length || state !== cache.writtenState || at.getTime() - cache.writtenAt >= SCHEDULER_STATUS_INTERVAL_MS || at.getTime() < cache.writtenAt) {
    await schedulerStore.recordEvaluation({
      at,
      definitionStates,
      definitionsEvaluated: definitions.length,
      errorMessage: errors.length > 0 ? errors.join(" | ") : undefined,
      jobsQueued,
      schedulerId: input.schedulerId
    });
    cache.writtenAt = at.getTime();
    cache.writtenState = state;
  }
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
