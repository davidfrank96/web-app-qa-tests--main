import { redactInssaLogLine } from "../inssa-ops/redaction";

export const AUTHENTICATION_MONITOR_METHODS = [
  "username-password",
  "google-oauth",
  "apple-sign-in"
] as const;

export type AuthenticationMonitoringMethod = (typeof AUTHENTICATION_MONITOR_METHODS)[number];
export type AuthenticationMonitoringCheckStatus =
  | "blocked_external"
  | "disabled"
  | "failed"
  | "missing_configuration"
  | "passed"
  | "timed_out";

export type AuthenticationMonitoringCheck = {
  completedAt: string;
  durationMs: number;
  error: string | null;
  method: AuthenticationMonitoringMethod;
  startedAt: string;
  status: AuthenticationMonitoringCheckStatus;
};

export type AuthenticationMonitoringEvidenceReference = {
  consoleLog?: string;
  result: string;
  screenshot?: string;
};

export type AuthenticationMonitoringSummary = {
  checks: Record<AuthenticationMonitoringMethod, AuthenticationMonitoringCheck>;
  completedAt: string;
  durationMs: number;
  environment: "production" | "staging";
  evidenceReferences?: {
    checks: Record<AuthenticationMonitoringMethod, AuthenticationMonitoringEvidenceReference>;
    report: string;
    summary: string;
  };
  overallStatus: "degraded" | "failed" | "passed";
  runId: string;
  schemaVersion: 1 | 2;
  startedAt: string;
  targetHost: string;
};

export type AuthenticationMonitoringResultState =
  | "available"
  | "evidence_upload_failed"
  | "processing"
  | "result_metadata_missing";

export type AuthenticationMonitoringResultResponse = {
  evidence: {
    bundleId: string | null;
    reportArtifactId: string | null;
    summaryEvidenceItemId: string | null;
    uploadStatus: "failed" | "local_only" | "missing" | "uploaded";
  };
  reason: string | null;
  result: AuthenticationMonitoringSummary | null;
  source: "evidence_file" | "evidence_metadata" | null;
  state: AuthenticationMonitoringResultState;
};

const CHECK_STATUSES = new Set<AuthenticationMonitoringCheckStatus>([
  "blocked_external",
  "disabled",
  "failed",
  "missing_configuration",
  "passed",
  "timed_out"
]);
const OVERALL_STATUSES = new Set(["degraded", "failed", "passed"]);

export function parseAuthenticationMonitoringSummary(value: unknown): AuthenticationMonitoringSummary {
  const summary = record(value, "Authentication monitoring summary");
  const checksValue = record(summary.checks, "Authentication monitoring checks");
  const checks = Object.fromEntries(
    AUTHENTICATION_MONITOR_METHODS.map((method) => [method, parseCheck(checksValue[method], method)])
  ) as Record<AuthenticationMonitoringMethod, AuthenticationMonitoringCheck>;
  const schemaVersion = integer(summary.schemaVersion, "schemaVersion");
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error(`Unsupported authentication monitoring schema version: ${schemaVersion}.`);
  }

  const environment = text(summary.environment, "environment");
  if (environment !== "staging" && environment !== "production") {
    throw new Error(`Unsupported authentication monitoring environment: ${environment}.`);
  }
  const overallStatus = text(summary.overallStatus, "overallStatus");
  if (!OVERALL_STATUSES.has(overallStatus)) {
    throw new Error(`Unsupported authentication monitoring overall status: ${overallStatus}.`);
  }

  return {
    checks,
    completedAt: timestamp(summary.completedAt, "completedAt"),
    durationMs: nonNegativeNumber(summary.durationMs, "durationMs"),
    environment,
    ...(summary.evidenceReferences
      ? { evidenceReferences: parseEvidenceReferences(summary.evidenceReferences) }
      : {}),
    overallStatus: overallStatus as AuthenticationMonitoringSummary["overallStatus"],
    runId: text(summary.runId, "runId"),
    schemaVersion,
    startedAt: timestamp(summary.startedAt, "startedAt"),
    targetHost: text(summary.targetHost, "targetHost")
  };
}

export function authenticationCheckPresentation(
  result: AuthenticationMonitoringCheck | undefined,
  missingReason = "Result metadata unavailable."
) {
  if (!result) {
    return {
      detail: missingReason,
      label: "NO DATA",
      tone: "failure" as const
    };
  }
  const labels: Record<AuthenticationMonitoringCheckStatus, string> = {
    blocked_external: "BLOCKED - PROVIDER",
    disabled: "DISABLED",
    failed: "FAILED",
    missing_configuration: "MISSING CONFIGURATION",
    passed: "PASSED",
    timed_out: "TIMED OUT"
  };
  return {
    detail: result.error,
    label: labels[result.status],
    tone: result.status === "passed"
      ? "success" as const
      : ["blocked_external", "disabled", "missing_configuration"].includes(result.status)
        ? "warning" as const
        : "failure" as const
  };
}

export function isAuthenticationMonitoringCampaign(campaignKey: string) {
  return campaignKey === "monitor_inssa_auth_staging" || campaignKey === "monitor_inssa_auth_production";
}

export function isTerminalAuthenticationMonitoringRun(status: string) {
  return ["cancelled", "failed", "failed_startup", "passed", "passed_with_warnings", "timed_out"].includes(status);
}

export function authenticationEvidencePresentation(input: {
  reportArtifactId: string | null;
  runStatus: string;
  uploadStatus: string | null;
}) {
  if (input.uploadStatus === "failed") {
    return { label: "Evidence Upload Failed", state: "failed" as const };
  }
  if (input.reportArtifactId && (input.uploadStatus === "uploaded" || input.uploadStatus === "local_only")) {
    return { label: "Open", state: "available" as const };
  }
  if (isTerminalAuthenticationMonitoringRun(input.runStatus)) {
    return { label: "Result metadata unavailable", state: "missing" as const };
  }
  return { label: "Processing", state: "processing" as const };
}

function parseCheck(value: unknown, expectedMethod: AuthenticationMonitoringMethod): AuthenticationMonitoringCheck {
  const check = record(value, `${expectedMethod} result`);
  const method = text(check.method, `${expectedMethod}.method`);
  if (method !== expectedMethod) {
    throw new Error(`Authentication monitoring result method mismatch: expected ${expectedMethod}, received ${method}.`);
  }
  const status = text(check.status, `${expectedMethod}.status`);
  if (!CHECK_STATUSES.has(status as AuthenticationMonitoringCheckStatus)) {
    throw new Error(`Unsupported authentication monitoring check status: ${status}.`);
  }
  return {
    completedAt: timestamp(check.completedAt, `${expectedMethod}.completedAt`),
    durationMs: nonNegativeNumber(check.durationMs, `${expectedMethod}.durationMs`),
    error: check.error === null || check.error === undefined
      ? null
      : redactInssaLogLine(text(check.error, `${expectedMethod}.error`)),
    method: expectedMethod,
    startedAt: timestamp(check.startedAt, `${expectedMethod}.startedAt`),
    status: status as AuthenticationMonitoringCheckStatus
  };
}

function parseEvidenceReferences(value: unknown) {
  const references = record(value, "evidenceReferences");
  const checks = record(references.checks, "evidenceReferences.checks");
  return {
    checks: Object.fromEntries(
      AUTHENTICATION_MONITOR_METHODS.map((method) => {
        const entry = record(checks[method], `evidenceReferences.checks.${method}`);
        return [method, {
          ...(entry.consoleLog ? { consoleLog: safeRelativePath(entry.consoleLog, `${method}.consoleLog`) } : {}),
          result: safeRelativePath(entry.result, `${method}.result`),
          ...(entry.screenshot ? { screenshot: safeRelativePath(entry.screenshot, `${method}.screenshot`) } : {})
        }];
      })
    ) as Record<AuthenticationMonitoringMethod, AuthenticationMonitoringEvidenceReference>,
    report: safeRelativePath(references.report, "evidenceReferences.report"),
    summary: safeRelativePath(references.summary, "evidenceReferences.summary")
  };
}

function safeRelativePath(value: unknown, label: string) {
  const candidate = text(value, label).replaceAll("\\", "/");
  if (candidate.startsWith("/") || candidate.split("/").includes("..")) {
    throw new Error(`Unsafe authentication monitoring evidence reference: ${label}.`);
  }
  return candidate;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function timestamp(value: unknown, label: string) {
  const candidate = text(value, label);
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${label} must be an ISO timestamp.`);
  return candidate;
}

function nonNegativeNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function integer(value: unknown, label: string) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return value as number;
}
