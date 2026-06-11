export type InssaCommandRiskLevel = "safe" | "read_only";

export type InssaCommandType = "artifact_validation" | "campaign" | "export" | "healthcheck" | "report_render";

export type InssaRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "indexing_artifacts"
  | "passed"
  | "passed_with_warnings"
  | "failed"
  | "failed_startup"
  | "cancelled"
  | "timed_out";

export type InssaCommandDefinition = {
  commandType: InssaCommandType;
  displayName: string;
  key: string;
  mutatesStaging: boolean;
  npmScript: string;
  operatorDescription: string;
  phase1Enabled: boolean;
  playwrightSpec?: string;
  producesFindings: boolean;
  producesReports: boolean;
  requiresLifecycleArtifact?: boolean;
  riskLevel: InssaCommandRiskLevel;
  timeoutMs: number;
};

export type InssaLifecycleArtifactSelection = {
  mode: "explicit" | "latest";
  path?: string;
};

export type ResolvedInssaLifecycleArtifactSelection = {
  artifactType: string;
  filePath: string;
  timestamp: string;
};

export type InssaRunRecord = {
  campaignKey: string;
  commandSnapshot: InssaCommandDefinition;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  exitCode: number | null;
  id: string;
  requestedBy: string;
  startedAt: string | null;
  status: InssaRunStatus;
  updatedAt: string;
};

export type InssaRunLogRecord = {
  createdAt: string;
  id: string;
  message: string;
  runId: string;
  sequence: number;
  stream: "stdout" | "stderr" | "system";
};

export type InssaArtifactRecord = {
  artifactType: string;
  contentType: string;
  createdAt: string;
  filePath: string;
  fileSize: number;
  id: string;
  renderInline: boolean;
  runId: string;
  sensitive: boolean;
  sha256: string;
};

export type InssaAuditEventType =
  | "login"
  | "logout"
  | "run_requested"
  | "run_completed"
  | "run_failed"
  | "run_denied"
  | "role_violation_attempt"
  | "unauthorized_access_attempt";

export type InssaAuditEventRecord = {
  actorEmail: string | null;
  actorUserId: string | null;
  campaignKey: string | null;
  createdAt: string;
  eventType: InssaAuditEventType;
  id: string;
  metadata: Record<string, unknown>;
  role: string | null;
  runId: string | null;
  status: string | null;
};

export type CreateRunInput = {
  campaignKey: string;
  commandSnapshot: InssaCommandDefinition;
  requestedBy: string;
};

export type RunPatch = Partial<
  Pick<InssaRunRecord, "completedAt" | "durationMs" | "exitCode" | "startedAt" | "status">
>;
