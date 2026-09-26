export type QuotaLevel = "HEALTHY" | "WARNING" | "CRITICAL" | "UNAVAILABLE";
export function quotaLevel(bytes: number | null, ceiling: number): QuotaLevel {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(ceiling) || ceiling <= 0) return "UNAVAILABLE";
  const ratio = bytes / ceiling;
  return ratio > 0.9 ? "CRITICAL" : ratio >= 0.8 ? "WARNING" : "HEALTHY";
}
export function quotaCeiling(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Invalid operational quota ceiling");
  return parsed;
}
