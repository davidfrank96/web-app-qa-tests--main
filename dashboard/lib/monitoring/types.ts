export type MonitoringTriggerType = "manual" | "schedule" | "api" | "deployment" | "webhook" | "future";

export type MonitoringRunPolicy = "one_active_run" | "allow_parallel" | "queue" | "skip" | "retry";

export type MonitoringEvidencePolicy = "always" | "on_failure" | "never";

export type MonitoringNotificationPolicy = "critical" | "warning" | "info" | "silent";

export type MonitoringSeverity = "informational" | "low" | "medium" | "high" | "critical";

export type MonitoringRetryPolicy = {
  backoffMs: number;
  maxAttempts: number;
};

export type MonitoringSchedule = {
  dayOfWeek?: number;
  frequency: "hourly" | "daily" | "weekly";
  hour?: number;
  minute: number;
  timezone: string;
};

export type MonitoringDefinition = {
  campaignId: string;
  createdAt: string;
  enabled: boolean;
  environment: string;
  evidencePolicy: MonitoringEvidencePolicy;
  id: string;
  name: string;
  notificationPolicy: MonitoringNotificationPolicy;
  product: string;
  retryPolicy: MonitoringRetryPolicy;
  runPolicy: MonitoringRunPolicy;
  schedule: MonitoringSchedule | null;
  schemaVersion: 1;
  severity: MonitoringSeverity;
  timeout: number;
  triggerType: MonitoringTriggerType;
  updatedAt: string;
};
