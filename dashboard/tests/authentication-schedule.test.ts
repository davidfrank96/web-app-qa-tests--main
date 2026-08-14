import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeAuthenticationSchedule,
  workspaceLoadsMonitoringState,
  type AuthenticationScheduleDefinition
} from "../lib/monitoring/authentication-schedule";

const definitions: AuthenticationScheduleDefinition[] = [
  definition("midday", 12, true),
  definition("evening", 18, true)
];

test("Authentication Monitoring directly loads monitoring definitions and scheduler state", () => {
  assert.equal(workspaceLoadsMonitoringState("authentication-monitoring"), true);
  assert.equal(workspaceLoadsMonitoringState("monitoring"), true);
  assert.equal(workspaceLoadsMonitoringState("overview"), false);
});

test("twice-daily staging summary selects the earliest enabled occurrence", () => {
  const summary = summarizeAuthenticationSchedule(
    definitions,
    [
      { definitionId: "midday", nextRunAt: "2026-08-15T11:00:00.000Z" },
      { definitionId: "evening", nextRunAt: "2026-08-14T17:00:00.000Z" }
    ],
    "staging"
  );

  assert.equal(summary.enabledCount, 2);
  assert.equal(summary.scheduleLabel, "Twice daily");
  assert.equal(summary.timesLabel, "12:00 and 18:00 Europe/Dublin");
  assert.equal(summary.nextRunAt, "2026-08-14T17:00:00.000Z");
});

test("after the evening occurrence the next schedule is next-day midday", () => {
  const summary = summarizeAuthenticationSchedule(
    definitions,
    [
      { definitionId: "midday", nextRunAt: "2026-08-15T11:00:00.000Z" },
      { definitionId: "evening", nextRunAt: "2026-08-15T17:00:00.000Z" }
    ],
    "staging"
  );

  assert.equal(summary.nextRunAt, "2026-08-15T11:00:00.000Z");
});

test("a partially disabled schedule remains visible and truthful", () => {
  const summary = summarizeAuthenticationSchedule(
    [definition("midday", 12, true), definition("evening", 18, false)],
    [{ definitionId: "midday", nextRunAt: "2026-08-15T11:00:00.000Z" }],
    "staging"
  );

  assert.equal(summary.scheduleLabel, "1 of 2 enabled");
  assert.equal(summary.timesLabel, "12:00 enabled and 18:00 disabled Europe/Dublin");
  assert.equal(summary.nextRunAt, "2026-08-15T11:00:00.000Z");
});

function definition(id: string, hour: number, enabled: boolean): AuthenticationScheduleDefinition {
  return {
    campaignId: "monitor_inssa_auth_staging",
    enabled,
    environment: "staging",
    id,
    schedule: { frequency: "daily", hour, minute: 0, timezone: "Europe/Dublin" },
    triggerType: "schedule"
  };
}
