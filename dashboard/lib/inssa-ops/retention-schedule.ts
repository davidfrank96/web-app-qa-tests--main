const dublin = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const parts = (date: Date) => Object.fromEntries(dublin.formatToParts(date).map((p) => [p.type, p.value]));

// Day 1 is never a Dublin DST transition, so this local time is unambiguous.
export function monthlyRetentionAt(year: number, month: number) {
  const date = new Date(Date.UTC(year, month - 1, 1, 1, 30));
  if (parts(date).hour === "02") date.setUTCHours(0);
  return date;
}
export function nextMonthlyRetentionAt(now: Date) {
  const local = parts(now);
  const scheduled = monthlyRetentionAt(Number(local.year), Number(local.month));
  return scheduled > now ? scheduled : monthlyRetentionAt(Number(local.year), Number(local.month) + 1);
}
export function dueRetentionOccurrence(now: Date, schedulerStartedAt: Date) {
  const local = parts(now);
  if (local.day !== "01" || local.hour !== "01" || local.minute !== "30") return null;
  const scheduled = monthlyRetentionAt(Number(local.year), Number(local.month));
  // A process started during/after the occurrence must wait for the next month.
  return schedulerStartedAt < scheduled ? `monthly:${local.year}-${local.month}` : null;
}
