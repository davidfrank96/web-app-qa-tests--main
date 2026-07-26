import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateSchedule, getNextScheduledRun } from "../lib/monitoring/schedule-evaluator";
import { getSchedulerStore } from "../lib/monitoring/scheduler-store";
import { evaluateSchedulerOnce } from "../lib/monitoring/scheduler";
import type { MonitoringDefinitionStore } from "../lib/monitoring/store";
import type { MonitoringDefinition, MonitoringSchedule } from "../lib/monitoring/types";

test("schedule evaluation supports hourly, daily, and weekly IANA-timezone occurrences", () => {
  assert.deepEqual(evaluateSchedule(definition({ frequency: "hourly", minute: 15, timezone: "UTC" }), new Date("2026-07-21T10:20:30.000Z")), {
    nextRunAt: "2026-07-21T11:15:00.000Z",
    occurrenceKey: "scheduler-test:2026-07-21T10:15[UTC]",
    scheduledFor: "2026-07-21T10:15:00.000Z"
  });
  assert.deepEqual(evaluateSchedule(definition({ frequency: "daily", hour: 3, minute: 0, timezone: "Europe/Dublin" }), new Date("2026-07-21T12:00:00.000Z")), {
    nextRunAt: "2026-07-22T02:00:00.000Z",
    occurrenceKey: "scheduler-test:2026-07-21T03:00[Europe/Dublin]",
    scheduledFor: "2026-07-21T02:00:00.000Z"
  });
  assert.deepEqual(evaluateSchedule(definition({ dayOfWeek: 2, frequency: "weekly", hour: 9, minute: 30, timezone: "UTC" }), new Date("2026-07-21T12:00:00.000Z")), {
    nextRunAt: "2026-07-28T09:30:00.000Z",
    occurrenceKey: "scheduler-test:2026-07-21T09:30[UTC]",
    scheduledFor: "2026-07-21T09:30:00.000Z"
  });
  const futureDefinition = {
    ...definition({ frequency: "daily", hour: 14, minute: 0, timezone: "UTC" }),
    createdAt: "2026-07-21T12:30:00.000Z"
  };
  assert.equal(evaluateSchedule(futureDefinition, new Date("2026-07-21T13:00:00.000Z")), null);
  assert.equal(getNextScheduledRun(futureDefinition, new Date("2026-07-21T13:00:00.000Z")), "2026-07-21T14:00:00.000Z");
});

test("a persisted occurrence is queued once across repeated evaluation and scheduler restart", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qa-scheduler-trigger-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;
  const schedulerStore = getSchedulerStore();
  const scheduledDefinition = definition({ frequency: "daily", hour: 10, minute: 0, timezone: "UTC" });
  const definitionStore = singleDefinitionStore(scheduledDefinition);
  const queued: string[] = [];
  const enqueue = async (_definition: MonitoringDefinition, occurrenceKey: string) => {
    queued.push(occurrenceKey);
    return { outcome: "queued" as const, runId: "923da931-d882-4ad2-bca6-e65cb49a1c23" };
  };

  try {
    await schedulerStore.start("scheduler-a", new Date("2026-07-21T10:05:00.000Z"));
    const first = await evaluateSchedulerOnce({
      at: new Date("2026-07-21T10:05:00.000Z"),
      definitionStore,
      enqueue,
      schedulerId: "scheduler-a",
      schedulerStore
    });
    const repeated = await evaluateSchedulerOnce({
      at: new Date("2026-07-21T10:05:30.000Z"),
      definitionStore,
      enqueue,
      schedulerId: "scheduler-a",
      schedulerStore
    });
    await schedulerStore.stop("scheduler-a", new Date("2026-07-21T10:06:00.000Z"));
    await schedulerStore.start("scheduler-b", new Date("2026-07-21T10:06:01.000Z"));
    const restarted = await evaluateSchedulerOnce({
      at: new Date("2026-07-21T10:06:01.000Z"),
      definitionStore,
      enqueue,
      schedulerId: "scheduler-b",
      schedulerStore
    });

    assert.equal(first.jobsQueued, 1);
    assert.equal(repeated.jobsQueued, 0);
    assert.equal(restarted.jobsQueued, 0);
    assert.deepEqual(queued, ["scheduler-test:2026-07-21T10:00[UTC]"]);

    const occurrence = await schedulerStore.getOccurrence(queued[0]);
    assert.equal(occurrence?.status, "queued");
    assert.equal(occurrence?.runId, "923da931-d882-4ad2-bca6-e65cb49a1c23");
    const status = await schedulerStore.getStatus(180_000, new Date("2026-07-21T10:06:02.000Z"));
    assert.equal(status.running, true);
    assert.equal(status.definitionsEvaluated, 1);
    assert.equal(status.jobsQueued, 1);
    assert.equal(status.jobsQueuedToday, 1);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

function definition(schedule: MonitoringSchedule): MonitoringDefinition {
  return {
    campaignId: "test_inssa_safe",
    createdAt: "2026-01-01T00:00:00.000Z",
    enabled: true,
    environment: "staging",
    evidencePolicy: "always",
    id: "scheduler-test",
    name: "Scheduler test",
    notificationPolicy: "warning",
    product: "INSSA",
    retryPolicy: { backoffMs: 60_000, maxAttempts: 2 },
    runPolicy: "one_active_run",
    schedule,
    schemaVersion: 1,
    severity: "medium",
    timeout: 600_000,
    triggerType: "schedule",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function singleDefinitionStore(item: MonitoringDefinition): MonitoringDefinitionStore {
  return {
    async get(id) {
      return id === item.id ? item : null;
    },
    async list() {
      return {
        items: [item],
        pagination: { hasMore: false, limit: 100, nextCursor: null, total: 1 }
      };
    }
  };
}
