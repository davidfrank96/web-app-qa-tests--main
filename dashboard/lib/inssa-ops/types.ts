export type InssaCommandRiskLevel = "live_mutation" | "safe" | "read_only";

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
  adminOnly?: boolean;
  approvalRequired?: boolean;
  cleanupRequired?: boolean;
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
  requiresSecondaryAccount?: boolean;
  riskLevel: InssaCommandRiskLevel;
  supportsExecutionModes?: boolean;
  targetEnvironment?: "production" | "staging";
  timeoutMs: number;
};

export type InssaLiveExecutionMode = "create" | "resume";

export type InssaLiveExecutionContext = {
  approvalAcknowledgements: string[];
  approvalConfirmedAt: string;
  approvedBy: string;
  executionMode: InssaLiveExecutionMode | null;
  irreversibleFinalAction: boolean;
  cleanupPolicy?: InssaCleanupPolicySnapshot;
  resumeArtifact: ResolvedInssaLifecycleArtifactSelection | null;
  schemaVersion: 1;
  targetHost: "staging.inssa.us";
};

export type InssaCleanupStatus =
  | "cleanup_unavailable"
  | "completed"
  | "deferred"
  | "failed"
  | "manually_confirmed"
  | "not_required"
  | "pending";

export type InssaCleanupPolicySnapshot = {
  dedicatedQaAccountsConfirmed: boolean;
  deferredModeEnabled: boolean;
  maxMutationRunsPerDay: number;
  maxUnresolvedAgeDays: number;
  maxUnresolvedObjects: number;
  retentionDays: number;
};

export type InssaCleanupManifest = {
  affectedUsers: string[];
  automaticCleanupAvailable: boolean;
  cleanupMethod?: string | null;
  cleanupResult?: string | null;
  cleanupTimestamp?: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdArtifactIds: string[];
  createdCapsuleIds: string[];
  createdMediaIds: string[];
  dedicatedQaAccount?: boolean;
  evidencePaths?: string[];
  finalActionPerformed: boolean;
  instructions: string[];
  lifecycleState: string | null;
  mediaType?: "image" | "video" | null;
  ownerAccount?: string | null;
  reasonCode?: string | null;
  recordedAt?: string;
  relatedDefectId?: string | null;
  retentionUntil?: string | null;
  runId: string;
  safelyAccounted?: boolean;
  schemaVersion: 1 | 2;
  sensitiveValuesExcluded?: boolean;
  selectedRecipient?: string | null;
  status: InssaCleanupStatus;
  unexpectedData?: boolean;
  verificationMethods?: string[];
  verifiedAt?: string | null;
  verifier?: string | null;
};

export type InssaCleanupLedgerStatus = "cleanup_unavailable" | "completed" | "deferred" | "failed" | "pending";

export type InssaCleanupLedgerRecord = {
  affectedUsers: string[];
  campaignKey: string;
  createdAt: string;
  dedicatedQaAccount: boolean;
  deferredAt: string | null;
  environment: "staging";
  evidencePaths: string[];
  id: string;
  mediaType: "image" | "video" | null;
  notes: string | null;
  objectId: string;
  objectPath: string;
  objectType: "media" | "time_capsule";
  originatingRunId: string;
  ownerAccount: string | null;
  product: "INSSA";
  reasonCode: string | null;
  resultingState: string | null;
  resolvedAt: string | null;
  retentionUntil: string;
  safelyAccounted: boolean;
  schemaVersion: 1;
  securitySensitive: boolean;
  sensitiveValuesExcluded: boolean;
  selectedRecipient: string | null;
  status: InssaCleanupLedgerStatus;
  unexpectedData: boolean;
  updatedAt: string;
  verificationMethods: string[];
};

export type InssaLifecycleArtifactSelection = {
  mode: "explicit" | "latest";
  path?: string;
};

export type ResolvedInssaLifecycleArtifactSelection = {
  artifactId?: string | null;
  artifactType: string;
  filePath: string;
  lifecycleState?: string | null;
  owner?: string | null;
  scheduledAtIso?: string | null;
  timestamp: string;
};

export type InssaRunRecord = {
  campaignKey: string;
  commandSnapshot: InssaCommandDefinition;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  cleanup?: InssaCleanupManifest | null;
  executionContext?: InssaLiveExecutionContext | null;
  exitCode: number | null;
  id: string;
  requestedBy: string;
  startedAt: string | null;
  status: InssaRunStatus;
  updatedAt: string;
};

export type InssaExecutionJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "abandoned";

export type InssaExecutionJobRecord = {
  attempt: number;
  campaignKey: string;
  claimedAt: string | null;
  claimedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  heartbeatAt: string | null;
  id: string;
  idempotencyKey: string;
  executionContext?: InssaLiveExecutionContext | null;
  lastError: string | null;
  leaseExpiresAt: string | null;
  lifecycleArtifact: ResolvedInssaLifecycleArtifactSelection | null;
  maxAttempts: number;
  runId: string;
  schemaVersion: 1;
  status: InssaExecutionJobStatus;
  updatedAt: string;
};

export type NotificationOutboxStatus = "pending" | "processing" | "delivered" | "failed" | "dead_letter";

export type NotificationSeverity = "informational" | "low" | "medium" | "high" | "critical";

export type NotificationEventType =
  | "run_queued"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "worker_restarted"
  | "worker_lease_expired"
  | "job_recovery"
  | "evidence_upload_failed"
  | "execution_failed";

export type NotificationOutboxRecord = {
  attemptCount: number;
  campaignId: string | null;
  correlationId: string;
  createdAt: string;
  deduplicationKey: string;
  deliveredAt: string | null;
  environment: string;
  errorMessage: string | null;
  eventType: NotificationEventType;
  id: string;
  lastAttemptAt: string | null;
  message: string;
  payload: Record<string, unknown>;
  product: string;
  provider: string | null;
  providerMessageId: string | null;
  runId: string | null;
  schemaVersion: 1;
  severity: NotificationSeverity;
  status: NotificationOutboxStatus;
  title: string;
};

export type CreateNotificationOutboxInput = Pick<
  NotificationOutboxRecord,
  | "campaignId"
  | "correlationId"
  | "deduplicationKey"
  | "environment"
  | "eventType"
  | "message"
  | "payload"
  | "product"
  | "runId"
  | "severity"
  | "title"
>;

export type InssaRunOutputManifestEntry = {
  artifactType: string;
  contentType: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
};

export type InssaRunOutputManifest = {
  campaignKey: string;
  completedAt: string;
  entries: InssaRunOutputManifestEntry[];
  generatedAt: string;
  runId: string;
  schemaVersion: 1;
  startedAt: string;
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

export type InssaEvidenceBundleStatus = "indexed";

export type InssaEvidenceBundleType =
  | "artifact-validation"
  | "healthcheck"
  | "lifecycle"
  | "mixed"
  | "playwright"
  | "report"
  | "security"
  | "siem";

export type InssaEvidenceRetentionClass =
  | "cleanup-evidence"
  | "default"
  | "security-evidence"
  | "short-lived"
  | "siem-metadata";

export type InssaEvidenceStorageBackend = "local-filesystem" | "supabase-storage";

export type InssaEvidenceUploadStatus = "local_only" | "uploaded" | "failed";

export type InssaEvidenceBundleRecord = {
  bundleType: InssaEvidenceBundleType;
  campaignKey: string;
  checksumManifest: Record<string, string>;
  createdAt: string;
  environment: string;
  id: string;
  indexedAt: string;
  itemCount: number;
  product: string;
  retentionClass: InssaEvidenceRetentionClass;
  rootPath: string;
  runId: string;
  sensitive: boolean;
  sourceArtifactId: string | null;
  status: InssaEvidenceBundleStatus;
  storageBackend: InssaEvidenceStorageBackend;
  storagePrefix: string | null;
  title: string;
  totalBytes: number;
  uploadError: string | null;
  uploadStatus: InssaEvidenceUploadStatus;
  uploadedAt: string | null;
};

export type InssaEvidenceItemRecord = {
  artifactId: string;
  bundleId: string;
  campaignKey: string;
  contentType: string;
  createdAt: string;
  fileName: string;
  id: string;
  itemType: string;
  metadata: Record<string, unknown>;
  relativePath: string;
  renderInline: boolean;
  retentionClass: InssaEvidenceRetentionClass;
  runId: string;
  sensitive: boolean;
  sha256: string;
  sizeBytes: number;
  storageBackend: InssaEvidenceStorageBackend;
  storageKey: string;
  uploadError: string | null;
  uploadStatus: InssaEvidenceUploadStatus;
  uploadedAt: string | null;
};

export type InssaAuditEventType =
  | "login"
  | "logout"
  | "run_requested"
  | "run_queued"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "run_denied"
  | "role_violation_attempt"
  | "approval_opened"
  | "approval_confirmed"
  | "preflight_failed"
  | "cleanup_acknowledged"
  | "cleanup_deferred"
  | "cleanup_investigation_required"
  | "cleanup_verified"
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
  executionContext?: InssaLiveExecutionContext;
  requestedBy: string;
};

export type RunPatch = Partial<
  Pick<InssaRunRecord, "cleanup" | "completedAt" | "durationMs" | "exitCode" | "startedAt" | "status">
>;
