export type AuthenticationScheduleDefinition = {
  campaignId: string;
  enabled: boolean;
  environment: string;
  id: string;
  schedule: {
    frequency: "hourly" | "daily" | "weekly";
    hour?: number;
    minute: number;
    timezone: string;
  } | null;
  triggerType: string;
};

export type AuthenticationScheduleState = {
  definitionId: string;
  nextRunAt: string | null;
};

export type AuthenticationScheduleSummary = {
  enabledCount: number;
  nextRunAt: string | null;
  scheduleLabel: string;
  timesLabel: string;
  totalCount: number;
};

export function summarizeAuthenticationSchedule(
  definitions: AuthenticationScheduleDefinition[],
  definitionStates: AuthenticationScheduleState[],
  environment: "production" | "staging"
): AuthenticationScheduleSummary {
  const matching = definitions
    .filter(
      (definition) =>
        definition.campaignId === `monitor_inssa_auth_${environment}` &&
        definition.environment === environment &&
        definition.triggerType === "schedule" &&
        definition.schedule
    )
    .sort(compareScheduleDefinitions);
  const enabled = matching.filter((definition) => definition.enabled);
  const enabledIds = new Set(enabled.map((definition) => definition.id));
  const nextRunAt = definitionStates
    .filter((state) => enabledIds.has(state.definitionId) && state.nextRunAt)
    .map((state) => state.nextRunAt as string)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;

  return {
    enabledCount: enabled.length,
    nextRunAt,
    scheduleLabel: scheduleLabel(enabled.length, matching.length),
    timesLabel: timesLabel(matching),
    totalCount: matching.length
  };
}

export function workspaceLoadsMonitoringState(workspace: string) {
  return workspace === "authentication-monitoring" || workspace === "monitoring";
}

function compareScheduleDefinitions(left: AuthenticationScheduleDefinition, right: AuthenticationScheduleDefinition) {
  return scheduleMinutes(left) - scheduleMinutes(right);
}

function scheduleMinutes(definition: AuthenticationScheduleDefinition) {
  return (definition.schedule?.hour ?? 0) * 60 + (definition.schedule?.minute ?? 0);
}

function scheduleLabel(enabledCount: number, totalCount: number) {
  if (totalCount === 0) return "Not configured";
  if (enabledCount === 0) return "Disabled";
  if (enabledCount !== totalCount) return `${enabledCount} of ${totalCount} enabled`;
  if (enabledCount === 2) return "Twice daily";
  if (enabledCount === 1) return "Daily";
  return `${enabledCount} times daily`;
}

function timesLabel(definitions: AuthenticationScheduleDefinition[]) {
  if (definitions.length === 0) return "Not configured";
  const timezone = definitions[0].schedule?.timezone ?? "Unknown timezone";
  const sameTimezone = definitions.every((definition) => definition.schedule?.timezone === timezone);
  const labels = definitions.map((definition) => {
    const time = `${pad(definition.schedule?.hour ?? 0)}:${pad(definition.schedule?.minute ?? 0)}`;
    return definitions.every((candidate) => candidate.enabled === definition.enabled)
      ? time
      : `${time} ${definition.enabled ? "enabled" : "disabled"}`;
  });
  const joined = labels.length === 2 ? `${labels[0]} and ${labels[1]}` : labels.join(", ");
  const enabledCount = definitions.filter((definition) => definition.enabled).length;
  const disabledSuffix = enabledCount === 0 ? " (disabled)" : "";
  return `${joined}${sameTimezone ? ` ${timezone}` : ""}${disabledSuffix}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
