import type { MonitoringDefinition, MonitoringSchedule } from "./types";

const MINUTE_MS = 60_000;
const WEEKDAY_INDEX: Record<string, number> = {
  Fri: 5,
  Mon: 1,
  Sat: 6,
  Sun: 0,
  Thu: 4,
  Tue: 2,
  Wed: 3
};

export type ScheduleWindow = {
  nextRunAt: string;
  occurrenceKey: string;
  scheduledFor: string;
};

export function evaluateSchedule(definition: MonitoringDefinition, now: Date): ScheduleWindow | null {
  if (!definition.enabled || definition.triggerType !== "schedule" || !definition.schedule) return null;
  validateSchedule(definition.schedule);

  const currentMinute = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const maximumScan = definition.schedule.frequency === "weekly" ? 8 * 24 * 60 : definition.schedule.frequency === "daily" ? 25 * 60 : 61;
  const scheduled = scanForMatch(currentMinute, definition.schedule, -1, maximumScan, true);
  const next = scanForMatch(currentMinute, definition.schedule, 1, maximumScan, false);
  if (!scheduled || !next || scheduled.getTime() < new Date(definition.createdAt).getTime()) return null;

  return {
    nextRunAt: next.toISOString(),
    occurrenceKey: `${definition.id}:${localOccurrenceKey(scheduled, definition.schedule.timezone)}`,
    scheduledFor: scheduled.toISOString()
  };
}

export function getNextScheduledRun(definition: MonitoringDefinition, now: Date): string | null {
  if (!definition.enabled || definition.triggerType !== "schedule" || !definition.schedule) return null;
  validateSchedule(definition.schedule);
  const currentMinute = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const maximumScan = definition.schedule.frequency === "weekly" ? 8 * 24 * 60 : definition.schedule.frequency === "daily" ? 25 * 60 : 61;
  return scanForMatch(currentMinute, definition.schedule, 1, maximumScan, false)?.toISOString() ?? null;
}

function scanForMatch(start: Date, schedule: MonitoringSchedule, direction: 1 | -1, maximumMinutes: number, includeStart: boolean) {
  for (let offset = includeStart ? 0 : 1; offset <= maximumMinutes; offset += 1) {
    const candidate = new Date(start.getTime() + direction * offset * MINUTE_MS);
    if (matchesSchedule(candidate, schedule)) return candidate;
  }
  return null;
}

function matchesSchedule(candidate: Date, schedule: MonitoringSchedule) {
  const parts = localParts(candidate, schedule.timezone);
  if (parts.minute !== schedule.minute) return false;
  if (schedule.frequency === "hourly") return true;
  if (parts.hour !== schedule.hour) return false;
  return schedule.frequency === "daily" || parts.dayOfWeek === schedule.dayOfWeek;
}

function localOccurrenceKey(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}[${timezone}]`;
}

function localParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    weekday: "short",
    year: "numeric"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    day: Number(parts.day),
    dayOfWeek: WEEKDAY_INDEX[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    year: Number(parts.year)
  };
}

function validateSchedule(schedule: MonitoringSchedule) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone }).format(new Date());
  } catch {
    throw new Error(`Unsupported monitoring timezone: ${schedule.timezone}`);
  }
  if (!Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) {
    throw new Error(`Invalid monitoring schedule minute: ${String(schedule.minute)}`);
  }
  if (schedule.frequency !== "hourly" && (!Number.isInteger(schedule.hour) || schedule.hour! < 0 || schedule.hour! > 23)) {
    throw new Error(`Invalid monitoring schedule hour: ${String(schedule.hour)}`);
  }
  if (schedule.frequency === "weekly" && (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek! < 0 || schedule.dayOfWeek! > 6)) {
    throw new Error(`Invalid monitoring schedule dayOfWeek: ${String(schedule.dayOfWeek)}`);
  }
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
