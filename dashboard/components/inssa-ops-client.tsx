"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { summarizeAuthenticationSchedule, workspaceLoadsMonitoringState } from "../lib/monitoring/authentication-schedule";
import { describeAuthenticationMonitorIncompleteRun } from "../lib/monitoring/authentication-failure";

type CampaignDefinition = {
  commandType: "artifact_validation" | "campaign" | "export" | "healthcheck" | "report_render";
  displayName: string;
  key: string;
  mutatesStaging: boolean;
  adminOnly?: boolean;
  approvalRequired?: boolean;
  cleanupRequired?: boolean;
  npmScript: string;
  operatorDescription: string;
  phase1Enabled: boolean;
  producesFindings: boolean;
  producesReports: boolean;
  requiresLifecycleArtifact?: boolean;
  requiresSecondaryAccount?: boolean;
  riskLevel: string;
  targetEnvironment?: "production" | "staging";
  timeoutMs: number;
  supportsExecutionModes?: boolean;
};

type RunRecord = {
  campaignKey: string;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  cleanup?: {
    confirmedAt: string | null;
    createdArtifactIds: string[];
    createdCapsuleIds: string[];
    createdMediaIds?: string[];
    instructions: string[];
    reasonCode?: string | null;
    recordedAt?: string;
    status: string;
  } | null;
  exitCode: number | null;
  id: string;
  requestedBy: string;
  startedAt: string | null;
  status: string;
};

type RunLogRecord = {
  createdAt: string;
  id: string;
  message: string;
  sequence: number;
  stream: "stdout" | "stderr" | "system";
};

type NotificationOutboxRecord = {
  campaignId: string | null;
  createdAt: string;
  environment: string;
  eventType: string;
  id: string;
  message: string;
  product: string;
  runId: string | null;
  severity: string;
  status: string;
  title: string;
};

type MonitoringDefinition = {
  campaignId: string;
  createdAt: string;
  enabled: boolean;
  environment: string;
  evidencePolicy: string;
  id: string;
  name: string;
  notificationPolicy: string;
  product: string;
  retryPolicy: { backoffMs: number; maxAttempts: number };
  runPolicy: string;
  schedule: {
    dayOfWeek?: number;
    frequency: "hourly" | "daily" | "weekly";
    hour?: number;
    minute: number;
    timezone: string;
  } | null;
  severity: string;
  timeout: number;
  triggerType: string;
  updatedAt: string;
};

type SchedulerStatus = {
  definitionStates?: Array<{ definitionId: string; lastRunAt: string | null; nextRunAt: string | null }>;
  heartbeatAt: string | null;
  jobsQueuedToday: number;
  lastEvaluationAt: string | null;
  running: boolean;
};

type AuthenticationMonitoringCheck = {
  completedAt: string;
  durationMs: number;
  error: string | null;
  method: string;
  startedAt: string;
  status: "blocked_external" | "disabled" | "failed" | "missing_configuration" | "passed" | "timed_out";
};

type AuthenticationMonitoringSummary = {
  checks: Record<string, AuthenticationMonitoringCheck>;
  completedAt: string;
  durationMs: number;
  environment: "production" | "staging";
  overallStatus: "degraded" | "failed" | "passed";
  runId: string;
  schemaVersion: 1;
  startedAt: string;
  targetHost: string;
};

type ArtifactRecord = {
  artifactType: string;
  contentType: string;
  createdAt: string;
  filePath: string;
  fileSize: number;
  id: string;
  renderInline: boolean;
  runId: string;
  sensitive: boolean;
};

type CleanupLedgerRecord = {
  campaignKey: string;
  createdAt: string;
  dedicatedQaAccount: boolean;
  evidencePaths: string[];
  id: string;
  objectId: string;
  objectPath: string;
  originatingRunId: string;
  reasonCode: string | null;
  retentionUntil: string;
  safelyAccounted: boolean;
  status: "cleanup_unavailable" | "completed" | "deferred" | "failed" | "pending";
  updatedAt: string;
};

type EvidenceBundleRecord = {
  bundleType: string;
  campaignKey: string;
  checksumManifest: Record<string, string>;
  createdAt: string;
  environment: string;
  id: string;
  indexedAt: string;
  itemCount: number;
  product: string;
  retentionClass: string;
  rootPath: string;
  runId: string;
  sensitive: boolean;
  sourceArtifactId: string | null;
  status: string;
  storageBackend: string;
  storagePrefix: string | null;
  title: string;
  totalBytes: number;
  uploadError: string | null;
  uploadStatus: string;
  uploadedAt: string | null;
};

type EvidenceItemRecord = {
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
  retentionClass: string;
  runId: string;
  sensitive: boolean;
  sha256: string;
  sizeBytes: number;
  storageBackend: string;
  storageKey: string;
  uploadError: string | null;
  uploadStatus: string;
  uploadedAt: string | null;
};

type EvidenceByRun = Record<string, { bundles: EvidenceBundleRecord[]; items: EvidenceItemRecord[] }>;
type CampaignCategory = "Artifact Validation" | "Lifecycle" | "Operations" | "Safe Tests" | "Security" | "SIEM";
type ProductKey = "Future" | "INSSA" | "KBean" | "Localman";
type ThemeMode = "dark" | "light";

type ManagedCampaign = {
  approvalRequired: boolean;
  category: CampaignCategory;
  cleanupRequired: boolean;
  commandKey: string | null;
  description: string;
  definition: CampaignDefinition | null;
  disabledReason: string | null;
  environment: string;
  estimatedDuration: string;
  evidenceProduced: string[];
  executionEnabled: boolean;
  id: string;
  mutatesStaging: boolean;
  name: string;
  npmScript: string;
  prerequisites: string[];
  produces: string[];
  product: ProductKey;
  relatedReports: string[];
  relatedValidation: string[];
  risk: string;
  source: "disabled" | "registry";
  status: "Disabled" | "Executable";
};

type MetadataBackendSummary = {
  backend: "local-json" | "supabase";
  backendLabel: string;
  counts: {
    artifacts: number;
    logs: number;
    runs: number;
  } | null;
  error: string | null;
  storePath: string | null;
};

type ApiFailure = {
  endpoint: string;
  message: string;
  status: number | string;
  timestamp: string;
};

type LifecycleArtifactOption = {
  artifactId: string | null;
  artifactType: string;
  createdAt: string | null;
  filePath: string;
  fileSize: number;
  artifactValidationReady: boolean;
  modifiedAt: string;
  observedCreateSuccess: boolean;
  lifecycleState: string | null;
  owner: string | null;
  runId: string | null;
  scheduledAtIso: string | null;
  subject: string | null;
  timestamp: string;
};

type LiveApprovalPayload = {
  acknowledgements: string[];
  confirmationPhrase: string;
  executionMode?: "create" | "resume";
  resumeArtifactPath?: string;
};

type PreflightCheck = { detail: string; id: string; passed: boolean };

type LifecycleArtifactSelection = {
  mode: "explicit" | "latest";
  path?: string;
};

type InssaOpsClientProps = {
  currentUser: {
    email: string;
    id: string;
    role: "admin" | "operator" | "viewer";
  };
  initialCampaignDefinitions: CampaignDefinition[];
  initialLoadError: string | null;
  initialMetadataBackend: MetadataBackendSummary;
  initialRuns: RunRecord[];
};

type RunFilter = "all" | "running" | "passed" | "failed";
type ReportCategory = "Lifecycle" | "Playwright" | "Security" | "SIEM";
type EvidenceSortMode = "campaign" | "date" | "run";
type WorkspaceKey =
  | "campaigns"
  | "overview"
  | "testing"
  | "security"
  | "lifecycle"
  | "artifact-validation"
  | "execution"
  | "reports"
  | "siem"
  | "authentication-monitoring"
  | "monitoring"
  | "notifications"
  | "operations"
  | "runs";

type WorkspaceNavItem = {
  group?: string;
  key: WorkspaceKey;
  label: string;
};

const WORKSPACE_NAV: WorkspaceNavItem[] = [
  { key: "overview", label: "Overview" },
  { group: "Testing", key: "campaigns", label: "Campaign Library" },
  { key: "testing", label: "Testing" },
  { key: "security", label: "Security" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "execution", label: "Execution" },
  { group: "Evidence", key: "artifact-validation", label: "Artifact Validation" },
  { key: "reports", label: "Reports" },
  { group: "Integrations", key: "siem", label: "SIEM" },
  { group: "Operations", key: "authentication-monitoring", label: "Authentication Monitoring" },
  { key: "monitoring", label: "Monitoring" },
  { key: "notifications", label: "Notifications" },
  { key: "operations", label: "Operations" },
  { key: "runs", label: "Runs" }
];

const WORKSPACE_COPY: Record<WorkspaceKey, { eyebrow: string; title: string; subtitle: string }> = {
  "authentication-monitoring": {
    eyebrow: "Continuous monitoring",
    subtitle: "Review independent email/password, Google OAuth, and Apple Sign-In health checks across approved INSSA environments.",
    title: "Authentication Monitoring"
  },
  "artifact-validation": {
    eyebrow: "Evidence",
    subtitle: "Run read-only discovery, public-share, and cleanup checks against selected lifecycle artifacts.",
    title: "Artifact Validation"
  },
  campaigns: {
    eyebrow: "Campaign management",
    subtitle: "Browse managed campaign definitions by product, risk, environment, approval state, and execution readiness.",
    title: "Campaign Library"
  },
  lifecycle: {
    eyebrow: "Live staging",
    subtitle: "Review gated lifecycle campaigns that create staging data and require manual cleanup.",
    title: "Lifecycle"
  },
  monitoring: {
    eyebrow: "Operations",
    subtitle: "Review reusable campaign definitions and the read-only health of the schedule trigger service.",
    title: "Monitoring Framework"
  },
  notifications: {
    eyebrow: "Operations",
    subtitle: "Review durable execution and recovery events awaiting future delivery processing.",
    title: "Notification Outbox"
  },
  execution: {
    eyebrow: "Pipeline",
    subtitle: "Observe the selected campaign run from launch through logs, artifacts, reports, and completion.",
    title: "Execution Workspace"
  },
  operations: {
    eyebrow: "Platform",
    subtitle: "Inspect metadata backend health, API failures, diagnostics, and admin-only health checks.",
    title: "Operations"
  },
  overview: {
    eyebrow: "Command center",
    subtitle: "Monitor runner state, recent activity, backend status, and platform health at a glance.",
    title: "Overview"
  },
  reports: {
    eyebrow: "Evidence",
    subtitle: "Investigate evidence bundles, items, reports, integrity, storage, and SIEM outputs without executing tests.",
    title: "Evidence Workspace"
  },
  runs: {
    eyebrow: "Execution",
    subtitle: "Inspect run history, live logs, generated artifacts, and Playwright report links.",
    title: "Run Workspace"
  },
  security: {
    eyebrow: "Security",
    subtitle: "Execute read-only security campaigns and verification from existing approved commands.",
    title: "Security"
  },
  siem: {
    eyebrow: "Integration",
    subtitle: "Generate metadata-only SIEM exports while keeping external send actions disabled.",
    title: "SIEM"
  },
  testing: {
    eyebrow: "Safe execution",
    subtitle: "Run the non-mutating INSSA safe suite from the primary testing workspace.",
    title: "Safe Tests"
  }
};

const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "indexing_artifacts"]);
const PASSED_STATUSES = new Set(["passed", "passed_with_warnings"]);
const FAILED_STATUSES = new Set(["failed", "failed_startup", "cancelled", "timed_out"]);
const REPORT_ARCHIVE_ARTIFACT_TYPES = new Set(["Lifecycle Report", "Playwright Report", "Security Report", "SIEM Export"]);
const SAFE_COMMAND_KEYS = ["test_inssa_safe"];
const SECURITY_COMMAND_KEYS = [
  "test_inssa_campaign_security",
  "test_inssa_campaign_security_verify",
  "test_inssa_campaign_cross_user",
  "test_inssa_campaign_reveal_later_security"
];
const LIFECYCLE_COMMAND_KEYS = [
  "test_inssa_campaign_text",
  "test_inssa_campaign_media",
  "test_inssa_campaign_video",
  "test_inssa_campaign_reveal_later"
];
const ARTIFACT_VALIDATION_COMMAND_KEYS = [
  "test_inssa_discovery",
  "test_inssa_public_share",
  "test_inssa_cleanup_audit"
];
const SIEM_COMMAND_KEYS = ["siem_export"];
const OPERATIONS_COMMAND_KEYS = ["platform_healthcheck"];
const CAMPAIGN_CATEGORIES: CampaignCategory[] = ["Safe Tests", "Security", "Lifecycle", "Artifact Validation", "Operations", "SIEM"];
const PRODUCT_KEYS: ProductKey[] = ["INSSA", "Localman", "KBean", "Future"];

type DisabledCommandCard = {
  description: string;
  label: string;
  npmScript: string;
  reason: string;
  riskLevel: string;
};

const DISABLED_LIFECYCLE_COMMANDS: DisabledCommandCard[] = [];
const DISABLED_SECURITY_COMMANDS: DisabledCommandCard[] = [];

const DISABLED_SIEM_COMMANDS: DisabledCommandCard[] = [
  {
    description: "Sends the latest metadata-only SIEM export to the configured Wazuh ingestion endpoint.",
    label: "Send SIEM Export",
    npmScript: "siem:send",
    reason: "Disabled until endpoint preview, dry-run, and explicit send confirmation are implemented.",
    riskLevel: "external transmission"
  }
];

const THEME_STORAGE_KEY = "qa-ops-theme";

export function InssaOpsClient({
  currentUser,
  initialCampaignDefinitions,
  initialLoadError,
  initialMetadataBackend,
  initialRuns
}: InssaOpsClientProps) {
  const [campaignDefinitions, setCampaignDefinitions] = useState(initialCampaignDefinitions);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRunId, setSelectedRunId] = useState(initialRuns[0]?.id ?? "");
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [logs, setLogs] = useState<RunLogRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [cleanupLedger, setCleanupLedger] = useState<CleanupLedgerRecord[]>([]);
  const [apiFailures, setApiFailures] = useState<ApiFailure[]>(
    initialLoadError
      ? [
          {
            endpoint: "server:/",
            message: initialLoadError,
            status: "initial-load",
            timestamp: new Date().toISOString()
          }
        ]
      : []
  );
  const [metadataBackend, setMetadataBackend] = useState(initialMetadataBackend);
  const [evidenceByRun, setEvidenceByRun] = useState<EvidenceByRun>({});
  const [reportArtifacts, setReportArtifacts] = useState<ArtifactRecord[]>([]);
  const [lifecycleArtifacts, setLifecycleArtifacts] = useState<LifecycleArtifactOption[]>([]);
  const [lifecycleArtifactError, setLifecycleArtifactError] = useState("");
  const [artifactSelectionMode, setArtifactSelectionMode] = useState<"explicit" | "latest">("latest");
  const [selectedLifecycleArtifactPath, setSelectedLifecycleArtifactPath] = useState("");
  const [selectedArtifactValidationActionKey, setSelectedArtifactValidationActionKey] = useState("");
  const [selectedLifecycleActionKey, setSelectedLifecycleActionKey] = useState("");
  const [selectedReportCategory, setSelectedReportCategory] = useState<ReportCategory>("Security");
  const [selectedReportArtifactId, setSelectedReportArtifactId] = useState("");
  const [evidenceBundleSearch, setEvidenceBundleSearch] = useState("");
  const [evidenceBundleSort, setEvidenceBundleSort] = useState<EvidenceSortMode>("date");
  const [evidenceBundleTypeFilter, setEvidenceBundleTypeFilter] = useState("all");
  const [selectedEvidenceBundleId, setSelectedEvidenceBundleId] = useState("");
  const [selectedEvidenceItemId, setSelectedEvidenceItemId] = useState("");
  const [selectedSecurityActionKey, setSelectedSecurityActionKey] = useState("");
  const [selectedSiemActionKey, setSelectedSiemActionKey] = useState("");
  const [campaignLibraryProduct, setCampaignLibraryProduct] = useState<ProductKey>("INSSA");
  const [campaignLibraryCategory, setCampaignLibraryCategory] = useState<CampaignCategory | "All">("All");
  const [campaignLibrarySearch, setCampaignLibrarySearch] = useState("");
  const [selectedManagedCampaignId, setSelectedManagedCampaignId] = useState("");
  const [runDetailError, setRunDetailError] = useState("");
  const [runHistoryError, setRunHistoryError] = useState(initialLoadError ?? "");
  const [notifications, setNotifications] = useState<NotificationOutboxRecord[]>([]);
  const [notificationError, setNotificationError] = useState("");
  const [notificationStatusFilter, setNotificationStatusFilter] = useState("all");
  const [notificationSeverityFilter, setNotificationSeverityFilter] = useState("all");
  const [monitoringDefinitions, setMonitoringDefinitions] = useState<MonitoringDefinition[]>([]);
  const [monitoringError, setMonitoringError] = useState("");
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [schedulerStatusError, setSchedulerStatusError] = useState("");
  const [authenticationMonitoringEnvironment, setAuthenticationMonitoringEnvironment] = useState<"production" | "staging">("staging");
  const [authenticationMonitoringSummary, setAuthenticationMonitoringSummary] = useState<AuthenticationMonitoringSummary | null>(null);
  const [authenticationMonitoringError, setAuthenticationMonitoringError] = useState("");
  const [authenticationMonitoringIncompleteReason, setAuthenticationMonitoringIncompleteReason] = useState("");
  const [monitoringProductFilter, setMonitoringProductFilter] = useState("all");
  const [monitoringEnabledFilter, setMonitoringEnabledFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKey>("overview");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  });
  const [approvalCampaignKey, setApprovalCampaignKey] = useState("");
  const [approvalAcknowledgements, setApprovalAcknowledgements] = useState<string[]>([]);
  const [approvalPhrase, setApprovalPhrase] = useState("");
  const [approvalExecutionMode, setApprovalExecutionMode] = useState<"" | "create" | "resume">("");
  const [approvalArtifactPath, setApprovalArtifactPath] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const hasActiveRuns = runs.some((run) => ACTIVE_STATUSES.has(run.status));
  const reportArchiveRunSignature = runs
    .slice(0, 40)
    .map((run) => `${run.id}:${run.status}:${run.completedAt ?? ""}`)
    .join("|");
  const workspaceLoadsRunDetail = activeWorkspace === "execution" || activeWorkspace === "runs";

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (sessionExpired) return;
    void refreshCampaigns();
    void refreshLifecycleArtifacts();
    void refreshCleanupLedger();
    void refreshRuns();
  }, [sessionExpired]);

  useEffect(() => {
    if (sessionExpired) return;
    const refresh = () => {
      if (document.hidden) return;
      void refreshRuns();
      if (activeWorkspace === "lifecycle" || activeWorkspace === "overview") void refreshCleanupLedger();
      if (workspaceLoadsRunDetail && selectedRunId) void refreshRunDetail(selectedRunId);
    };
    const interval = window.setInterval(() => {
      refresh();
    }, hasActiveRuns ? 3_000 : 15_000);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeWorkspace, hasActiveRuns, selectedRunId, sessionExpired, workspaceLoadsRunDetail]);

  useEffect(() => {
    if (sessionExpired || activeWorkspace !== "reports") return;
    void refreshReportArchive(runs);
  }, [activeWorkspace, reportArchiveRunSignature, sessionExpired]);

  useEffect(() => {
    if (sessionExpired || activeWorkspace !== "notifications") return;
    void refreshNotifications();
    const interval = window.setInterval(() => void refreshNotifications(), 5_000);
    return () => window.clearInterval(interval);
  }, [activeWorkspace, sessionExpired]);

  useEffect(() => {
    if (sessionExpired || !workspaceLoadsMonitoringState(activeWorkspace)) return;
    void refreshMonitoringDefinitions();
    void refreshSchedulerStatus();
  }, [activeWorkspace, sessionExpired]);

  const authenticationMonitoringRuns = useMemo(() => {
    const key = authenticationMonitoringEnvironment === "production"
      ? "monitor_inssa_auth_production"
      : "monitor_inssa_auth_staging";
    return runs.filter((run) => run.campaignKey === key);
  }, [authenticationMonitoringEnvironment, runs]);
  const latestAuthenticationMonitoringRun = authenticationMonitoringRuns[0] ?? null;
  const authenticationMonitoringSchedule = useMemo(
    () =>
      summarizeAuthenticationSchedule(
        monitoringDefinitions,
        schedulerStatus?.definitionStates ?? [],
        authenticationMonitoringEnvironment
      ),
    [authenticationMonitoringEnvironment, monitoringDefinitions, schedulerStatus?.definitionStates]
  );
  const latestAuthenticationMonitoringReport = latestAuthenticationMonitoringRun
    ? reportArtifacts.find(
        (artifact) => artifact.runId === latestAuthenticationMonitoringRun.id && artifact.artifactType === "Playwright Report"
      ) ?? null
    : null;
  const lastAuthenticationSuccess = authenticationMonitoringRuns.find((run) => PASSED_STATUSES.has(run.status)) ?? null;
  const lastAuthenticationFailure = authenticationMonitoringRuns.find((run) => FAILED_STATUSES.has(run.status)) ?? null;

  useEffect(() => {
    if (sessionExpired || activeWorkspace !== "authentication-monitoring") return;
    if (!latestAuthenticationMonitoringReport) {
      setAuthenticationMonitoringSummary(null);
      setAuthenticationMonitoringError("");
      return;
    }
    void refreshAuthenticationMonitoringSummary(latestAuthenticationMonitoringReport);
  }, [activeWorkspace, latestAuthenticationMonitoringReport?.id, sessionExpired]);

  useEffect(() => {
    if (
      sessionExpired ||
      activeWorkspace !== "authentication-monitoring" ||
      !latestAuthenticationMonitoringRun ||
      !["failed", "failed_startup", "timed_out"].includes(latestAuthenticationMonitoringRun.status) ||
      latestAuthenticationMonitoringReport
    ) {
      setAuthenticationMonitoringIncompleteReason("");
      return;
    }
    const endpoint = `/api/runs/${latestAuthenticationMonitoringRun.id}/logs`;
    void apiFetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { error?: string; logs?: RunLogRecord[] };
        if (!response.ok) {
          recordApiFailure(endpoint, response.status, body.error ?? response.statusText);
          return;
        }
        startTransition(() =>
          setAuthenticationMonitoringIncompleteReason(describeAuthenticationMonitorIncompleteRun(body.logs ?? []))
        );
      })
      .catch((error) => recordApiFailure(endpoint, "network", error instanceof Error ? error.message : String(error)));
  }, [activeWorkspace, latestAuthenticationMonitoringReport?.id, latestAuthenticationMonitoringRun?.id, latestAuthenticationMonitoringRun?.status, sessionExpired]);

  useEffect(() => {
    if (sessionExpired || !workspaceLoadsRunDetail) return;
    if (selectedRunId) {
      void refreshRunDetail(selectedRunId);
    } else {
      setSelectedRun(null);
      setLogs([]);
      setArtifacts([]);
    }
  }, [selectedRunId, sessionExpired, workspaceLoadsRunDetail]);

  const overview = useMemo(() => {
    return {
      failed: runs.filter((run) => FAILED_STATUSES.has(run.status)).length,
      passed: runs.filter((run) => PASSED_STATUSES.has(run.status)).length,
      running: runs.filter((run) => ACTIVE_STATUSES.has(run.status)).length,
      total: runs.length
    };
  }, [runs]);

  const visibleRuns = useMemo(() => {
    return runs.filter((run) => {
      if (runFilter === "running") return ACTIVE_STATUSES.has(run.status);
      if (runFilter === "passed") return PASSED_STATUSES.has(run.status);
      if (runFilter === "failed") return FAILED_STATUSES.has(run.status);
      return true;
    });
  }, [runFilter, runs]);
  const visibleNotifications = useMemo(() => {
    return notifications.filter((notification) => {
      if (notificationStatusFilter !== "all" && notification.status !== notificationStatusFilter) return false;
      return notificationSeverityFilter === "all" || notification.severity === notificationSeverityFilter;
    });
  }, [notificationSeverityFilter, notificationStatusFilter, notifications]);
  const notificationCounts = useMemo(() => {
    return {
      deadLetter: notifications.filter((notification) => notification.status === "dead_letter").length,
      delivered: notifications.filter((notification) => notification.status === "delivered").length,
      failed: notifications.filter((notification) => notification.status === "failed").length,
      pending: notifications.filter((notification) => notification.status === "pending").length
    };
  }, [notifications]);
  const monitoringProducts = useMemo(() => {
    return Array.from(new Set(monitoringDefinitions.map((definition) => definition.product))).sort();
  }, [monitoringDefinitions]);
  const visibleMonitoringDefinitions = useMemo(() => {
    return monitoringDefinitions.filter((definition) => {
      if (monitoringProductFilter !== "all" && definition.product !== monitoringProductFilter) return false;
      if (monitoringEnabledFilter === "enabled" && !definition.enabled) return false;
      return monitoringEnabledFilter !== "disabled" || !definition.enabled;
    });
  }, [monitoringDefinitions, monitoringEnabledFilter, monitoringProductFilter]);
  const monitoringCounts = useMemo(() => {
    return {
      enabled: monitoringDefinitions.filter((definition) => definition.enabled).length,
      products: new Set(monitoringDefinitions.map((definition) => definition.product)).size,
      scheduledDefinitions: monitoringDefinitions.filter((definition) => definition.triggerType === "schedule").length,
      total: monitoringDefinitions.length
    };
  }, [monitoringDefinitions]);

  const playwrightReport = artifacts.find((artifact) => artifact.artifactType === "Playwright Report");
  const reportRenderCommands = campaignDefinitions.filter((campaign) => campaign.commandType === "report_render");
  const safeCommands = selectCommands(campaignDefinitions, SAFE_COMMAND_KEYS);
  const securityCommands = selectCommands(campaignDefinitions, SECURITY_COMMAND_KEYS);
  const lifecycleCommands = selectCommands(campaignDefinitions, LIFECYCLE_COMMAND_KEYS);
  const artifactValidationCommands = selectCommands(campaignDefinitions, ARTIFACT_VALIDATION_COMMAND_KEYS);
  const siemCommands = selectCommands(campaignDefinitions, SIEM_COMMAND_KEYS);
  const operationsCommands = selectCommands(campaignDefinitions, OPERATIONS_COMMAND_KEYS);
  const managedCampaigns = useMemo(() => buildManagedCampaigns(campaignDefinitions), [campaignDefinitions]);
  const visibleManagedCampaigns = useMemo(() => {
    const query = campaignLibrarySearch.trim().toLowerCase();
    return managedCampaigns.filter((campaign) => {
      if (campaign.product !== campaignLibraryProduct) return false;
      if (campaignLibraryCategory !== "All" && campaign.category !== campaignLibraryCategory) return false;
      if (!query) return true;
      return [
        campaign.name,
        campaign.description,
        campaign.category,
        campaign.risk,
        campaign.npmScript,
        campaign.status,
        campaign.environment,
        campaign.disabledReason ?? ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [campaignLibraryCategory, campaignLibraryProduct, campaignLibrarySearch, managedCampaigns]);
  const selectedManagedCampaign = useMemo(() => {
    return (
      visibleManagedCampaigns.find((campaign) => campaign.id === selectedManagedCampaignId) ??
      visibleManagedCampaigns[0] ??
      null
    );
  }, [selectedManagedCampaignId, visibleManagedCampaigns]);
  const usableLifecycleArtifacts = useMemo(() => {
    return lifecycleArtifacts.filter((artifact) => artifact.artifactValidationReady);
  }, [lifecycleArtifacts]);
  const latestLifecycleArtifact = usableLifecycleArtifacts[0] ?? null;
  const selectedLifecycleArtifact = useMemo(() => {
    if (artifactSelectionMode === "latest") return latestLifecycleArtifact;
    return usableLifecycleArtifacts.find((artifact) => artifact.filePath === selectedLifecycleArtifactPath) ?? null;
  }, [artifactSelectionMode, latestLifecycleArtifact, selectedLifecycleArtifactPath, usableLifecycleArtifacts]);
  const reportArchiveArtifacts = useMemo(() => {
    return reportArtifacts
      .filter((artifact) => REPORT_ARCHIVE_ARTIFACT_TYPES.has(artifact.artifactType))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [reportArtifacts]);
  const reportCategoryCounts = useMemo(() => {
    return {
      Lifecycle: reportArchiveArtifacts.filter((artifact) => artifact.artifactType === "Lifecycle Report").length,
      Playwright: reportArchiveArtifacts.filter((artifact) => artifact.artifactType === "Playwright Report").length,
      Security: reportArchiveArtifacts.filter((artifact) => artifact.artifactType === "Security Report").length,
      SIEM: reportArchiveArtifacts.filter((artifact) => artifact.artifactType === "SIEM Export").length
    };
  }, [reportArchiveArtifacts]);
  const visibleReportArtifacts = useMemo(() => {
    return reportArchiveArtifacts.filter((artifact) => reportCategoryForArtifact(artifact) === selectedReportCategory);
  }, [reportArchiveArtifacts, selectedReportCategory]);
  const selectedReportArtifact = useMemo(() => {
    return (
      visibleReportArtifacts.find((artifact) => artifact.id === selectedReportArtifactId) ??
      visibleReportArtifacts[0] ??
      null
    );
  }, [selectedReportArtifactId, visibleReportArtifacts]);
  const evidenceBundles = useMemo(() => {
    return Object.values(evidenceByRun).flatMap((entry) => entry.bundles);
  }, [evidenceByRun]);
  const evidenceItems = useMemo(() => {
    return Object.values(evidenceByRun).flatMap((entry) => entry.items);
  }, [evidenceByRun]);
  const evidenceBundleTypes = useMemo(() => {
    return ["all", ...Array.from(new Set(evidenceBundles.map((bundle) => bundle.bundleType))).sort()];
  }, [evidenceBundles]);
  const visibleEvidenceBundles = useMemo(() => {
    const query = evidenceBundleSearch.trim().toLowerCase();
    const filtered = evidenceBundles.filter((bundle) => {
      if (evidenceBundleTypeFilter !== "all" && bundle.bundleType !== evidenceBundleTypeFilter) return false;
      if (!query) return true;
      return [
        bundle.title,
        bundle.campaignKey,
        bundle.runId,
        bundle.environment,
        bundle.status,
        bundle.bundleType,
        bundle.storageBackend,
        bundle.uploadStatus,
        bundle.retentionClass
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    return filtered.sort((left, right) => {
      if (evidenceBundleSort === "campaign") {
        return `${left.campaignKey}:${right.createdAt}`.localeCompare(`${right.campaignKey}:${left.createdAt}`);
      }
      if (evidenceBundleSort === "run") {
        return `${left.runId}:${right.createdAt}`.localeCompare(`${right.runId}:${left.createdAt}`);
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [evidenceBundleSearch, evidenceBundleSort, evidenceBundleTypeFilter, evidenceBundles]);
  const selectedEvidenceBundle = useMemo(() => {
    return (
      visibleEvidenceBundles.find((bundle) => bundle.id === selectedEvidenceBundleId) ??
      visibleEvidenceBundles[0] ??
      null
    );
  }, [selectedEvidenceBundleId, visibleEvidenceBundles]);
  const selectedEvidenceRun = selectedEvidenceBundle
    ? runs.find((run) => run.id === selectedEvidenceBundle.runId) ?? null
    : null;
  const selectedEvidenceArtifacts = selectedEvidenceBundle
    ? reportArtifacts.filter((artifact) => artifact.runId === selectedEvidenceBundle.runId)
    : [];
  const selectedEvidenceItems = selectedEvidenceBundle
    ? evidenceItems
        .filter((item) => item.bundleId === selectedEvidenceBundle.id)
        .sort((left, right) => evidenceItemWeight(left) - evidenceItemWeight(right) || left.relativePath.localeCompare(right.relativePath))
    : [];
  const selectedEvidenceItem = useMemo(() => {
    return (
      selectedEvidenceItems.find((item) => item.id === selectedEvidenceItemId) ??
      selectedEvidenceItems.find((item) => item.itemType === "Playwright Report") ??
      selectedEvidenceItems[0] ??
      null
    );
  }, [selectedEvidenceItemId, selectedEvidenceItems]);
  const selectedEvidenceArtifact = selectedEvidenceItem
    ? selectedEvidenceArtifacts.find((artifact) => artifact.id === selectedEvidenceItem.artifactId) ?? null
    : null;
  const canStartRuns = currentUser.role === "operator" || currentUser.role === "admin";
  const approvalCampaign = campaignDefinitions.find((campaign) => campaign.key === approvalCampaignKey) ?? null;
  const revealLaterArtifacts = usableLifecycleArtifacts.filter((artifact) => artifact.artifactType === "reveal-later");
  const executionRun = selectedRun ?? runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const executionCampaign = executionRun
    ? campaignDefinitions.find((campaign) => campaign.key === executionRun.campaignKey) ?? null
    : null;
  const executionStages = buildExecutionStages(executionRun, logs, artifacts, executionCampaign);
  const currentExecutionStage = executionStages.find((stage) => stage.status === "current") ?? executionStages.at(-1) ?? null;
  const expectedOutputs = buildExpectedOutputs(executionCampaign, artifacts);
  const campaignAwareness = describeCampaignAwareness(executionCampaign, selectedLifecycleArtifact);

  async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
    const response = await fetch(input, init);
    if (response.status === 401 && !sessionExpired) {
      setSessionExpired(true);
      window.location.replace("/login?reason=session_expired");
    }
    return response;
  }

  async function refreshCampaigns() {
    const endpoint = "/api/campaign-definitions";
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        const body = await readJsonResponse(response);
        recordApiFailure(endpoint, response.status, body.error ?? response.statusText);
        return;
      }
      const body = (await response.json()) as { campaignDefinitions: CampaignDefinition[] };
      startTransition(() => setCampaignDefinitions(body.campaignDefinitions));
    } catch (error) {
      recordApiFailure(endpoint, "network", error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshRuns() {
    const endpoint = "/api/runs";
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        metadataBackend?: MetadataBackendSummary;
        runs?: RunRecord[];
      };
      if (body.metadataBackend) {
        startTransition(() => setMetadataBackend(body.metadataBackend as MetadataBackendSummary));
      }
      if (!response.ok) {
        const message = body.error ?? response.statusText;
        setRunHistoryError(message);
        recordApiFailure(endpoint, response.status, message);
        return;
      }

      const nextRuns = body.runs ?? [];
      startTransition(() => {
        setRunHistoryError("");
        setRuns(nextRuns);
        if (!selectedRunId && nextRuns[0]) {
          setSelectedRunId(nextRuns[0].id);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunHistoryError(message);
      recordApiFailure(endpoint, "network", message);
    }
  }

  async function refreshNotifications() {
    const endpoint = "/api/notifications?limit=100";
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        notifications?: NotificationOutboxRecord[];
      };
      if (!response.ok) {
        const failureMessage = body.error ?? response.statusText;
        setNotificationError(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return;
      }
      startTransition(() => {
        setNotificationError("");
        setNotifications(body.notifications ?? []);
      });
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      setNotificationError(failureMessage);
      recordApiFailure(endpoint, "network", failureMessage);
    }
  }

  async function refreshMonitoringDefinitions() {
    const endpoint = "/api/monitoring-definitions?limit=100";
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        monitoringDefinitions?: MonitoringDefinition[];
      };
      if (!response.ok) {
        const failureMessage = body.error ?? response.statusText;
        setMonitoringError(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return;
      }
      startTransition(() => {
        setMonitoringError("");
        setMonitoringDefinitions(body.monitoringDefinitions ?? []);
      });
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      setMonitoringError(failureMessage);
      recordApiFailure(endpoint, "network", failureMessage);
    }
  }

  async function refreshSchedulerStatus() {
    const endpoint = "/api/scheduler/status";
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        scheduler?: SchedulerStatus;
      };
      if (!response.ok) {
        const failureMessage = body.error ?? response.statusText;
        setSchedulerStatusError(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return;
      }
      startTransition(() => {
        setSchedulerStatus(body.scheduler ?? null);
        setSchedulerStatusError("");
      });
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      setSchedulerStatusError(failureMessage);
      recordApiFailure(endpoint, "network", failureMessage);
    }
  }

  async function refreshAuthenticationMonitoringSummary(report: ArtifactRecord) {
    const endpoint = `/api/artifacts/${report.id}/bundle/authentication-monitoring-summary.json`;
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as AuthenticationMonitoringSummary & { error?: string };
      if (!response.ok) {
        const failureMessage = body.error ?? response.statusText;
        setAuthenticationMonitoringError(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return;
      }
      startTransition(() => {
        setAuthenticationMonitoringError("");
        setAuthenticationMonitoringSummary(body);
      });
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      setAuthenticationMonitoringError(failureMessage);
      recordApiFailure(endpoint, "network", failureMessage);
    }
  }

  async function refreshLifecycleArtifacts() {
    const endpoint = "/api/lifecycle-artifacts";
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        artifacts?: LifecycleArtifactOption[];
        error?: string;
      };
      if (!response.ok) {
        const message = body.error ?? response.statusText;
        setLifecycleArtifactError(message);
        recordApiFailure(endpoint, response.status, message);
        return;
      }
      const artifacts = body.artifacts ?? [];
      startTransition(() => {
        setLifecycleArtifactError("");
        setLifecycleArtifacts(artifacts);
        const firstUsableArtifact = artifacts.find((artifact) => artifact.artifactValidationReady);
        if (!selectedLifecycleArtifactPath && firstUsableArtifact) {
          setSelectedLifecycleArtifactPath(firstUsableArtifact.filePath);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLifecycleArtifactError(message);
      recordApiFailure(endpoint, "network", message);
    }
  }

  async function refreshCleanupLedger() {
    const endpoint = "/api/cleanup-ledger";
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; records?: CleanupLedgerRecord[] };
      if (!response.ok) {
        recordApiFailure(endpoint, response.status, body.error ?? response.statusText);
        return;
      }
      startTransition(() => setCleanupLedger(body.records ?? []));
    } catch (error) {
      recordApiFailure(endpoint, "network", error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshRunDetail(runId: string) {
    let runResponse: Response;
    let logsResponse: Response;
    let artifactsResponse: Response;
    let evidenceResponse: Response;

    try {
      [runResponse, logsResponse, artifactsResponse, evidenceResponse] = await Promise.all([
        apiFetch(`/api/runs/${runId}`, { cache: "no-store" }),
        apiFetch(`/api/runs/${runId}/logs`, { cache: "no-store" }),
        apiFetch(`/api/runs/${runId}/artifacts`, { cache: "no-store" }),
        apiFetch(`/api/runs/${runId}/evidence`, { cache: "no-store" })
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordApiFailure(`/api/runs/${runId}/*`, "network", message);
      startTransition(() => {
        setRunDetailError(message);
        setSelectedRun(null);
        setLogs([]);
        setArtifacts([]);
      });
      return;
    }

    if (runResponse.ok) {
      const body = (await runResponse.json()) as { run: RunRecord };
      startTransition(() => {
        setRunDetailError("");
        setSelectedRun(body.run);
      });
    } else {
      const body = await readJsonResponse(runResponse);
      const message = body.error ?? runResponse.statusText;
      recordApiFailure(`/api/runs/${runId}`, runResponse.status, message);
      startTransition(() => {
        setRunDetailError(message);
        setSelectedRun(null);
        setLogs([]);
        setArtifacts([]);
      });
    }
    if (logsResponse.ok) {
      const body = (await logsResponse.json()) as { logs: RunLogRecord[] };
      startTransition(() => setLogs(body.logs));
    } else {
      const body = await readJsonResponse(logsResponse);
      recordApiFailure(`/api/runs/${runId}/logs`, logsResponse.status, body.error ?? logsResponse.statusText);
    }
    if (artifactsResponse.ok) {
      const body = (await artifactsResponse.json()) as { artifacts: ArtifactRecord[] };
      startTransition(() => setArtifacts(body.artifacts));
    } else {
      const body = await readJsonResponse(artifactsResponse);
      recordApiFailure(`/api/runs/${runId}/artifacts`, artifactsResponse.status, body.error ?? artifactsResponse.statusText);
    }
    if (evidenceResponse.ok) {
      const body = (await evidenceResponse.json()) as { bundles: EvidenceBundleRecord[]; items: EvidenceItemRecord[] };
      startTransition(() =>
        setEvidenceByRun((current) => ({
          ...current,
          [runId]: {
            bundles: body.bundles ?? [],
            items: body.items ?? []
          }
        }))
      );
    } else {
      const body = await readJsonResponse(evidenceResponse);
      recordApiFailure(`/api/runs/${runId}/evidence`, evidenceResponse.status, body.error ?? evidenceResponse.statusText);
    }
  }

  async function refreshReportArchive(runList: RunRecord[]) {
    const recentRuns = runList.slice(0, 40);
    const artifactLists = await Promise.all(
      recentRuns.map(async (run) => {
        const endpoint = `/api/runs/${run.id}/artifacts`;
        try {
          const response = await apiFetch(endpoint, { cache: "no-store" });
          if (!response.ok) {
            const body = await readJsonResponse(response);
            recordApiFailure(endpoint, response.status, body.error ?? response.statusText);
            return [];
          }
          const body = (await response.json()) as { artifacts: ArtifactRecord[] };
          return body.artifacts;
        } catch (error) {
          recordApiFailure(endpoint, "network", error instanceof Error ? error.message : String(error));
          return [];
        }
      })
    );
    const evidenceLists = await Promise.all(
      recentRuns.map(async (run) => {
        const endpoint = `/api/runs/${run.id}/evidence`;
        try {
          const response = await apiFetch(endpoint, { cache: "no-store" });
          if (!response.ok) {
            const body = await readJsonResponse(response);
            recordApiFailure(endpoint, response.status, body.error ?? response.statusText);
            return { runId: run.id, bundles: [], items: [] };
          }
          const body = (await response.json()) as { bundles: EvidenceBundleRecord[]; items: EvidenceItemRecord[] };
          return { runId: run.id, bundles: body.bundles ?? [], items: body.items ?? [] };
        } catch (error) {
          recordApiFailure(endpoint, "network", error instanceof Error ? error.message : String(error));
          return { runId: run.id, bundles: [], items: [] };
        }
      })
    );

    startTransition(() => {
      setReportArtifacts(artifactLists.flat());
      setEvidenceByRun(
        Object.fromEntries(
          evidenceLists.map((entry) => [
            entry.runId,
            {
              bundles: entry.bundles,
              items: entry.items
            }
          ])
        )
      );
    });
  }

  async function runCampaign(
    campaignKey: string,
    lifecycleArtifactSelection?: LifecycleArtifactSelection,
    liveApproval?: LiveApprovalPayload
  ) {
    setMessage(`Starting ${campaignKey}...`);
    const endpoint = "/api/runs";
    try {
      const response = await apiFetch(endpoint, {
        body: JSON.stringify({
          artifactSelection: lifecycleArtifactSelection,
          campaignKey,
          liveApproval
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; run?: RunRecord };
      if (!response.ok) {
        const failureMessage = body.error ?? "Run request failed.";
        setMessage(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return false;
      }

      if (!body.run?.id) {
        const failureMessage = "Run request succeeded but no run record was returned.";
        setMessage(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return false;
      }

      setMessage(`Run started: ${body.run.id}`);
      setSelectedRunId(body.run.id);
      setActiveWorkspace("execution");
      await refreshRuns();
      await refreshRunDetail(body.run.id);
      return true;
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      setMessage(failureMessage);
      recordApiFailure(endpoint, "network", failureMessage);
      return false;
    }
  }

  async function openLiveCampaignApproval(campaign: CampaignDefinition) {
    if (currentUser.role !== "admin") return;
    setApprovalCampaignKey(campaign.key);
    setApprovalAcknowledgements([]);
    setApprovalPhrase("");
    setApprovalExecutionMode("");
    setApprovalArtifactPath("");
    setApprovalError("");
    setPreflightChecks([]);
    const endpoint = "/api/campaign-approvals";
    const response = await apiFetch(endpoint, {
      body: JSON.stringify({ action: "opened", campaignKey: campaign.key }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }).catch(() => null);
    if (!response?.ok) {
      const status = response?.status ?? "network";
      const body = response ? await readJsonResponse(response) : { error: "Approval audit request failed." };
      recordApiFailure(endpoint, status, body.error ?? "Approval audit request failed.");
    }
  }

  async function submitLiveCampaignApproval(campaign: CampaignDefinition) {
    const liveApproval: LiveApprovalPayload = {
      acknowledgements: approvalAcknowledgements,
      confirmationPhrase: approvalPhrase,
      ...(campaign.supportsExecutionModes && approvalExecutionMode ? { executionMode: approvalExecutionMode } : {}),
      ...(approvalExecutionMode === "resume" ? { resumeArtifactPath: approvalArtifactPath } : {})
    };
    setApprovalSubmitting(true);
    setApprovalError("");
    const endpoint = "/api/campaign-approvals";
    try {
      const response = await apiFetch(endpoint, {
        body: JSON.stringify({ action: "preflight", campaignKey: campaign.key, liveApproval }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = (await response.json().catch(() => ({}))) as { checks?: PreflightCheck[]; error?: string };
      setPreflightChecks(body.checks ?? []);
      if (!response.ok) {
        setApprovalError(body.error ?? "Campaign preflight failed.");
        return;
      }
      const started = await runCampaign(campaign.key, undefined, liveApproval);
      if (started) setApprovalCampaignKey("");
    } finally {
      setApprovalSubmitting(false);
    }
  }

  async function confirmRunCleanup(run: RunRecord) {
    const endpoint = `/api/runs/${run.id}/cleanup`;
    const response = await apiFetch(endpoint, {
      body: JSON.stringify({ confirmed: true }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const body = await readJsonResponse(response);
    if (!response.ok) {
      recordApiFailure(endpoint, response.status, body.error ?? "Cleanup confirmation failed.");
      return;
    }
    await refreshRuns();
    await refreshRunDetail(run.id);
  }

  function recordApiFailure(endpoint: string, status: number | string, message: string) {
    setApiFailures((current) => [
      {
        endpoint,
        message,
        status,
        timestamp: new Date().toISOString()
      },
      ...current
    ].slice(0, 5));
  }

  const workspaceCopy = WORKSPACE_COPY[activeWorkspace];

  return (
    <main className="min-h-screen bg-background text-slate-100">
      <div className="ops-shell ops-shell-workspace">
        <header className="ops-topbar workspace-topbar">
          <div className="flex min-w-[18rem] items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-sm font-bold text-cyan-100">
              IQ
            </div>
            <div>
              <p className="text-base font-semibold tracking-[-0.02em]">INSSA QA Operations</p>
              <p className="text-xs text-slate-400">Safe campaign runner console</p>
            </div>
          </div>
          <div className="ops-status-strip">
            <TopMetric label="Environment" value="Staging" tone="pass" />
            <TopMetric label="Runner Status" value={overview.running > 0 ? "Running" : "Idle"} tone={overview.running > 0 ? "active" : "neutral"} />
            <TopMetric label="Metadata Backend" value={metadataBackend.backendLabel} tone="neutral" />
            <TopMetric label="Last Run" value={runs[0] ? formatRelativeTime(runs[0].createdAt) : "None"} tone="neutral" />
          </div>
          <div className="flex items-center gap-3 border-t border-slate-800/80 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <ThemeToggle onChange={setThemeMode} value={themeMode} />
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-sm font-semibold">
              {initialsForUser(currentUser.email || currentUser.id)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{currentUser.email || currentUser.id}</p>
              <p className="text-xs capitalize text-slate-400">{currentUser.role}</p>
            </div>
            <form action="/logout" method="post">
              <button className="icon-button" title="Logout" type="submit">Logout</button>
            </form>
          </div>
        </header>

        <div className="ops-body workspace-body">
          <aside className="ops-sidebar workspace-sidebar">
            <nav className="space-y-1">
              {WORKSPACE_NAV.map((item, index) => (
                <div key={item.key}>
                  {item.group && WORKSPACE_NAV[index - 1]?.group !== item.group ? (
                    <p className="side-label">{item.group}</p>
                  ) : null}
                  <button
                    className={`side-link w-full text-left ${activeWorkspace === item.key ? "side-link-active" : ""}`}
                    onClick={() => setActiveWorkspace(item.key)}
                    type="button"
                  >
                    {item.label}
                  </button>
                </div>
              ))}
            </nav>
          </aside>

          <section className="workspace-main">
            <div className="workspace-titlebar">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">{workspaceCopy.eyebrow}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] md:text-3xl">{workspaceCopy.title}</h1>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">{workspaceCopy.subtitle}</p>
              </div>
              {message ? <p className="workspace-message">{message}</p> : null}
            </div>

            <div className="workspace-content">
              {activeWorkspace === "overview" ? (
                <div className="space-y-5">
                  <section className="grid gap-3 md:grid-cols-4">
                    <OverviewCard label="Total Runs" value={overview.total} />
                    <OverviewCard label="Passed Runs" value={overview.passed} tone="pass" />
                    <OverviewCard label="Failed Runs" value={overview.failed} tone="fail" />
                    <OverviewCard label="Running Jobs" value={overview.running} tone="active" />
                  </section>

                  <section className="workspace-card">
                    <SectionHeader title="Latest Activity" subtitle="Most recent run activity from the operations metadata store." />
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {runs.slice(0, 3).map((run) => (
                        <button
                          className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-400/60"
                          key={run.id}
                          onClick={() => {
                            setSelectedRunId(run.id);
                            setActiveWorkspace("runs");
                          }}
                          type="button"
                        >
                          <StatusBadge status={run.status} />
                          <p className="mt-3 font-mono text-xs text-slate-400">{run.id}</p>
                          <p className="mt-2 text-sm font-medium">{run.campaignKey}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatDate(run.createdAt)}</p>
                        </button>
                      ))}
                      {runs.length === 0 ? (
                        <p className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
                          No runs recorded in the active metadata backend.
                        </p>
                      ) : null}
                    </div>
                  </section>

                  <section className="workspace-card">
                    <SectionHeader title="Metadata Backend" subtitle="Current Operations Platform metadata source and record counts." />
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <MetadataCard label="Backend" value={metadataBackend.backendLabel} />
                      <MetadataCard label="Runs" value={metadataBackend.counts ? String(metadataBackend.counts.runs) : "unavailable"} />
                      <MetadataCard label="Logs" value={metadataBackend.counts ? String(metadataBackend.counts.logs) : "unavailable"} />
                      <MetadataCard label="Artifacts" value={metadataBackend.counts ? String(metadataBackend.counts.artifacts) : "unavailable"} />
                    </div>
                    {metadataBackend.error ? (
                      <p className="mt-3 rounded-2xl border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-100">
                        Metadata backend error: {metadataBackend.error}
                      </p>
                    ) : null}
                    {metadataBackend.storePath ? (
                      <p className="mt-3 break-words font-mono text-xs text-slate-500">{metadataBackend.storePath}</p>
                    ) : null}
                  </section>

                  {apiFailures.length > 0 ? (
                    <section className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-5">
                      <h2 className="text-lg font-semibold text-amber-100">Dashboard API Failure</h2>
                      <p className="mt-1 text-sm text-amber-100/80">The dashboard is showing diagnostics instead of silently hiding failed requests.</p>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        {apiFailures.map((failure) => (
                          <div className="rounded-2xl border border-amber-300/20 bg-slate-950/70 p-3 text-sm" key={`${failure.timestamp}-${failure.endpoint}`}>
                            <p className="font-mono text-xs text-amber-100">{failure.endpoint}</p>
                            <p className="mt-1 text-slate-300">Status: {failure.status} · {formatDate(failure.timestamp)}</p>
                            <p className="mt-1 break-words text-slate-400">{failure.message}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {activeWorkspace === "campaigns" ? (
                <CampaignLibraryWorkspace
                  campaignCategory={campaignLibraryCategory}
                  campaignProduct={campaignLibraryProduct}
                  canStartRuns={canStartRuns}
                  currentUserRole={currentUser.role}
                  managedCampaigns={managedCampaigns}
                  onCategoryChange={setCampaignLibraryCategory}
                  onProductChange={setCampaignLibraryProduct}
                  onSearchChange={setCampaignLibrarySearch}
                  onSelectCampaign={setSelectedManagedCampaignId}
                  onReviewLiveCampaign={openLiveCampaignApproval}
                  runningCount={overview.running}
                  runCampaign={runCampaign}
                  runs={runs}
                  search={campaignLibrarySearch}
                  selectedCampaign={selectedManagedCampaign}
                  selectedCampaignId={selectedManagedCampaign?.id ?? ""}
                  visibleCampaigns={visibleManagedCampaigns}
                />
              ) : null}

              {activeWorkspace === "testing" ? (
                <section className="workspace-card">
                  <SectionHeader title="INSSA Safe Suite" subtitle="Non-mutating INSSA regression checks that are safe to run from the dashboard." />
                  <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
                    Campaigns execute tests. This workspace contains the safe baseline suite only.
                  </p>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {safeCommands.map((campaign) => (
                      <CommandCard
                        canStartRuns={canStartRuns}
                        campaign={campaign}
                        currentUserRole={currentUser.role}
                        key={campaign.key}
                        runningCount={overview.running}
                        runCampaign={runCampaign}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {activeWorkspace === "security" ? (
                <section className="workspace-card">
                  <SectionHeader title="Security Actions" subtitle="Black-box security campaigns and read-only verification against existing evidence." />
                  <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
                    Security campaigns execute tests and can generate findings. Live cross-user and reveal-later actions require staging-only admin approval.
                  </p>
                  <DeferredCleanupBanner />
                  <ActionSelectorPanel
                    canStartRuns={canStartRuns}
                    currentUserRole={currentUser.role}
                    disabledCommands={DISABLED_SECURITY_COMMANDS}
                    enabledCommands={securityCommands}
                    onSelect={setSelectedSecurityActionKey}
                    onReviewLiveCampaign={openLiveCampaignApproval}
                    runningCount={overview.running}
                    runs={runs}
                    runCampaign={runCampaign}
                    selectedKey={selectedSecurityActionKey}
                  />
                  <MutationCampaignReadiness
                    artifacts={reportArtifacts}
                    campaigns={securityCommands.filter((campaign) => campaign.mutatesStaging)}
                    cleanupLedger={cleanupLedger}
                    onOpenRun={(runId) => {
                      setSelectedRunId(runId);
                      setActiveWorkspace("runs");
                    }}
                    runs={runs}
                  />
                </section>
              ) : null}

              {activeWorkspace === "lifecycle" ? (
                <section className="workspace-card">
                  <SectionHeader title="Lifecycle Campaigns" subtitle="Governed live staging campaigns require explicit admin approval and cleanup ownership." />
                  <p className="mt-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                    Lifecycle commands create staging data. They require live flags, one-run execution, no retry around final actions, and manual cleanup evidence.
                  </p>
                  <DeferredCleanupBanner />
                  <ActionSelectorPanel
                    canStartRuns={canStartRuns}
                    currentUserRole={currentUser.role}
                    disabledCommands={DISABLED_LIFECYCLE_COMMANDS}
                    enabledCommands={lifecycleCommands}
                    onSelect={setSelectedLifecycleActionKey}
                    onReviewLiveCampaign={openLiveCampaignApproval}
                    runningCount={overview.running}
                    runs={runs}
                    runCampaign={runCampaign}
                    selectedKey={selectedLifecycleActionKey}
                  />
                  <MutationCampaignReadiness
                    artifacts={reportArtifacts}
                    campaigns={lifecycleCommands}
                    cleanupLedger={cleanupLedger}
                    onOpenRun={(runId) => {
                      setSelectedRunId(runId);
                      setActiveWorkspace("runs");
                    }}
                    runs={runs}
                  />
                </section>
              ) : null}

              {activeWorkspace === "artifact-validation" ? (
                <section className="workspace-card">
                  <SectionHeader title="Artifact Validation" subtitle="Read-only lifecycle checks that consume a known creation artifact." />
                  <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
                    Artifact Validation consumes existing artifacts. It must not create capsules and should show the exact artifact path before execution.
                  </p>
                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
                      <div>
                        <label className="text-xs uppercase tracking-[0.18em] text-slate-500" htmlFor="artifact-selection-mode">
                          Selection mode
                        </label>
                        <select
                          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          id="artifact-selection-mode"
                          onChange={(event) => setArtifactSelectionMode(event.target.value === "explicit" ? "explicit" : "latest")}
                          value={artifactSelectionMode}
                        >
                          <option value="latest">Use latest usable artifact</option>
                          <option value="explicit">Select explicit artifact</option>
                        </select>
                      </div>
                      <div className="min-w-0">
                        {artifactSelectionMode === "explicit" ? (
                          <>
                            <label className="text-xs uppercase tracking-[0.18em] text-slate-500" htmlFor="lifecycle-artifact">
                              Lifecycle artifact
                            </label>
                            <select
                              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                              id="lifecycle-artifact"
                              onChange={(event) => setSelectedLifecycleArtifactPath(event.target.value)}
                              value={selectedLifecycleArtifactPath}
                            >
                              {usableLifecycleArtifacts.length === 0 ? (
                                <option value="">No usable lifecycle artifacts found</option>
                              ) : (
                                usableLifecycleArtifacts.map((artifact) => (
                                  <option key={artifact.filePath} value={artifact.filePath}>
                                    {artifact.artifactType} · {artifact.timestamp} · {artifact.filePath}
                                  </option>
                                ))
                              )}
                            </select>
                          </>
                        ) : (
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Latest usable artifact</p>
                            <p className="mt-2 break-words rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-300">
                              {latestLifecycleArtifact?.filePath ?? "No usable lifecycle artifact found"}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedLifecycleArtifact ? (
                      <dl className="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-300 md:grid-cols-3">
                        <Metadata label="Artifact path" value={selectedLifecycleArtifact.filePath} mono />
                        <Metadata label="Artifact type" value={selectedLifecycleArtifact.artifactType} />
                        <Metadata label="Artifact timestamp" value={formatDate(selectedLifecycleArtifact.timestamp)} />
                      </dl>
                    ) : (
                      <p className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
                        Artifact Validation is locked until a successful lifecycle artifact is selected.
                      </p>
                    )}
                    {lifecycleArtifactError ? (
                      <p className="mt-3 rounded-xl border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-100">
                        Artifact catalog error: {lifecycleArtifactError}
                      </p>
                    ) : null}
                  </div>
                  <ArtifactValidationActionPanel
                    artifactSelection={buildLifecycleArtifactSelection(artifactSelectionMode, selectedLifecycleArtifact)}
                    canStartRuns={canStartRuns}
                    commands={artifactValidationCommands}
                    currentUserRole={currentUser.role}
                    onSelect={setSelectedArtifactValidationActionKey}
                    runningCount={overview.running}
                    runs={runs}
                    runCampaign={runCampaign}
                    selectedArtifact={selectedLifecycleArtifact}
                    selectedKey={selectedArtifactValidationActionKey}
                  />
                </section>
              ) : null}

              {activeWorkspace === "execution" ? (
                <section className="execution-workspace">
                  {executionRun ? (
                    <>
                      <div className="execution-summary">
                        <div className="execution-summary-main">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Campaign Summary</p>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                              {executionCampaign?.displayName ?? executionRun.campaignKey}
                            </h2>
                            <StatusBadge status={executionRun.status} />
                          </div>
                          <p className="mt-2 break-words font-mono text-xs text-slate-500">{executionRun.id}</p>
                          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                            {executionCampaign?.operatorDescription ?? "Campaign metadata is unavailable for this run."}
                          </p>
                        </div>
                        <div className="execution-summary-grid">
                          <MetadataCard label="Campaign" value={executionRun.campaignKey} />
                          <MetadataCard label="Environment" value={executionCampaign?.targetEnvironment ?? "staging"} />
                          <MetadataCard label="Runner Status" value={ACTIVE_STATUSES.has(executionRun.status) ? "running" : "idle"} />
                          <MetadataCard label="Started" value={executionRun.startedAt ? formatDate(executionRun.startedAt) : formatDate(executionRun.createdAt)} />
                          <MetadataCard label="Elapsed Time" value={formatDuration(getRunElapsedMs(executionRun))} />
                          <MetadataCard label="Estimated Duration" value={executionCampaign ? formatDuration(executionCampaign.timeoutMs) : "unknown"} />
                          <MetadataCard label="Current Stage" value={currentExecutionStage?.label ?? "Unknown"} />
                          <MetadataCard label="Expected Outputs" value={`${expectedOutputs.length} tracked`} />
                        </div>
                      </div>

                      <div className="execution-layout">
                        <div className="space-y-4">
                          <section className="execution-panel">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <SectionHeader title="Execution Timeline" subtitle="Pipeline stages are inferred from run state, logs, and indexed artifacts." />
                              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                                {completionLabelForRun(executionRun)}
                              </span>
                            </div>
                            <div className="execution-timeline">
                              {executionStages.map((stage) => (
                                <div className={`execution-stage execution-stage-${stage.status}`} key={stage.label}>
                                  <span className="execution-stage-icon">{stageIcon(stage.status)}</span>
                                  <div className="min-w-0">
                                    <p className="font-semibold">{stage.label}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {stage.timestamp ? formatDate(stage.timestamp) : stage.description}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>

                          <section className="execution-panel">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <SectionHeader title="Live Console" subtitle="Raw run logs remain available as supporting execution evidence." />
                              <p className="text-xs text-slate-500">{logs.length} entries</p>
                            </div>
                            <div className="execution-console">
                              {logs.length === 0 ? (
                                <div className="execution-log-empty">Waiting for runner output...</div>
                              ) : (
                                logs.map((log) => (
                                  <div className={`execution-log-line execution-log-${log.stream}`} key={log.id}>
                                    <span className="execution-log-sequence">{String(log.sequence).padStart(3, "0")}</span>
                                    <span className="execution-log-time">{formatLogTime(log.createdAt)}</span>
                                    <span className="execution-log-stream">{log.stream}</span>
                                    <span className="execution-log-message">{log.message}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </section>
                        </div>

                        <aside className="space-y-4">
                          <section className="execution-panel">
                            <SectionHeader title="Campaign Awareness" subtitle="Presentation adapts to the selected command type." />
                            <div className="mt-4 space-y-3">
                              {campaignAwareness.map((item) => (
                                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3" key={item.label}>
                                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                                  <p className="mt-1 break-words text-sm font-semibold text-slate-200">{item.value}</p>
                                </div>
                              ))}
                            </div>
                          </section>

                          <section className="execution-panel">
                            <SectionHeader title="Outputs" subtitle="Expected evidence appears here as it is indexed." />
                            <div className="mt-4 space-y-3">
                              {expectedOutputs.map((output) => (
                                <div className={`output-card ${output.available ? "output-card-ready" : "output-card-pending"}`} key={output.label}>
                                  <div className="min-w-0">
                                    <p className="font-semibold">{output.label}</p>
                                    <p className="mt-1 break-words text-xs text-slate-500">{output.detail}</p>
                                  </div>
                                  {output.href ? (
                                    <a className="secondary-action shrink-0 px-3 py-1.5 text-xs" href={output.href} rel="noreferrer" target="_blank">
                                      {output.download ? "Download" : "Open"}
                                    </a>
                                  ) : output.available ? (
                                    <span className="rounded-full bg-emerald-300/15 px-2.5 py-1 text-xs text-emerald-200 ring-1 ring-emerald-300/20">ready</span>
                                  ) : (
                                    <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">pending</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </section>

                          <section className="execution-panel">
                            <SectionHeader title="Completion Summary" subtitle="Primary review actions after the run finishes." />
                            <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
                              {completionSummaryForRun(executionRun)}
                            </p>
                            <div className="mt-4 flex flex-col gap-2">
                              {expectedOutputs
                                .filter((output): output is ExpectedOutput & { href: string } => Boolean(output.href))
                                .map((output) => (
                                  <a className="primary-action justify-center" href={output.href} key={output.label} rel="noreferrer" target="_blank">
                                    {output.download ? "Download" : "Open"} {output.label}
                                  </a>
                                ))}
                              <button
                                className="secondary-action justify-center"
                                onClick={() => setActiveWorkspace("runs")}
                                type="button"
                              >
                                Open Run Details
                              </button>
                            </div>
                          </section>
                        </aside>
                      </div>
                    </>
                  ) : (
                    <div className="workspace-card">
                      <SectionHeader title="No Execution Selected" subtitle="Start a campaign or select a run to observe execution state." />
                      <button className="primary-action mt-4" onClick={() => setActiveWorkspace("testing")} type="button">
                        Open Safe Tests
                      </button>
                    </div>
                  )}
                </section>
              ) : null}

              {activeWorkspace === "reports" ? (
                <EvidenceWorkspace
                  bundleSearch={evidenceBundleSearch}
                  bundleSort={evidenceBundleSort}
                  bundleTypeFilter={evidenceBundleTypeFilter}
                  bundleTypes={evidenceBundleTypes}
                  canStartRuns={canStartRuns}
                  evidenceArtifacts={selectedEvidenceArtifacts}
                  evidenceBundles={visibleEvidenceBundles}
                  evidenceItems={selectedEvidenceItems}
                  reportCategory={selectedReportCategory}
                  reportCategoryCounts={reportCategoryCounts}
                  reportRenderCommands={reportRenderCommands}
                  reports={visibleReportArtifacts}
                  runCampaign={runCampaign}
                  runs={runs}
                  selectedArtifact={selectedEvidenceArtifact}
                  selectedBundle={selectedEvidenceBundle}
                  selectedItem={selectedEvidenceItem}
                  selectedReport={selectedReportArtifact}
                  selectedRun={selectedEvidenceRun}
                  setBundleSearch={setEvidenceBundleSearch}
                  setBundleSort={setEvidenceBundleSort}
                  setBundleTypeFilter={setEvidenceBundleTypeFilter}
                  setReportCategory={setSelectedReportCategory}
                  setSelectedBundleId={setSelectedEvidenceBundleId}
                  setSelectedItemId={setSelectedEvidenceItemId}
                  setSelectedReportId={setSelectedReportArtifactId}
                />
              ) : null}

              {activeWorkspace === "siem" ? (
                <section className="workspace-card">
                  <SectionHeader title="SIEM" subtitle="Generate metadata-only Wazuh payloads from existing campaign outputs." />
                  <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
                    SIEM export is read-only. SIEM send is an external transmission action and remains disabled until explicit confirmation exists.
                  </p>
                  <ActionSelectorPanel
                    canStartRuns={canStartRuns}
                    currentUserRole={currentUser.role}
                    disabledCommands={DISABLED_SIEM_COMMANDS}
                    enabledCommands={siemCommands}
                    onSelect={setSelectedSiemActionKey}
                    runningCount={overview.running}
                    runs={runs}
                    runCampaign={runCampaign}
                    selectedKey={selectedSiemActionKey}
                  />
                </section>
              ) : null}

              {activeWorkspace === "authentication-monitoring" ? (
                <div className="space-y-5">
                  <section className="workspace-card">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <SectionHeader title="Authentication Health" subtitle="Independent checks use real provider flows and existing evidence infrastructure." />
                      <label className="text-xs text-slate-400">
                        Environment
                        <select
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                          onChange={(event) => setAuthenticationMonitoringEnvironment(event.target.value as "production" | "staging")}
                          value={authenticationMonitoringEnvironment}
                        >
                          <option value="staging">INSSA Staging</option>
                          <option value="production">INSSA Production</option>
                        </select>
                      </label>
                    </div>

                    {monitoringError || schedulerStatusError ? (
                      <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                        <p className="font-semibold">Authentication monitoring schedule failed to load.</p>
                        <p className="mt-1 break-words">{monitoringError || schedulerStatusError}</p>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <MetadataCard
                        label="Schedule"
                        tone={
                          authenticationMonitoringSchedule.enabledCount === authenticationMonitoringSchedule.totalCount && authenticationMonitoringSchedule.enabledCount > 0
                            ? "pass"
                            : authenticationMonitoringSchedule.enabledCount > 0
                              ? "warn"
                              : "neutral"
                        }
                        value={authenticationMonitoringSchedule.scheduleLabel}
                      />
                      <MetadataCard label="Times" value={authenticationMonitoringSchedule.timesLabel} />
                      <MetadataCard
                        label="Next Scheduled"
                        value={
                          authenticationMonitoringSchedule.nextRunAt
                            ? formatDate(authenticationMonitoringSchedule.nextRunAt)
                            : authenticationMonitoringSchedule.enabledCount > 0
                              ? "Pending evaluation"
                              : authenticationMonitoringSchedule.scheduleLabel
                        }
                      />
                    </div>

                    {authenticationMonitoringError ? (
                      <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
                        <p className="font-semibold">Authentication monitoring evidence failed to load.</p>
                        <p className="mt-1 break-words">{authenticationMonitoringError}</p>
                      </div>
                    ) : latestAuthenticationMonitoringRun ? (
                      <>
                        {authenticationMonitoringIncompleteReason ? (
                          <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
                            <p className="font-semibold">Authentication monitor did not complete provider results.</p>
                            <p className="mt-1 break-words">Reason: {authenticationMonitoringIncompleteReason}</p>
                          </div>
                        ) : null}
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <MetadataCard
                            label="Overall Status"
                            tone={
                              authenticationMonitoringSummary?.overallStatus === "passed"
                                ? "pass"
                                : authenticationMonitoringSummary?.overallStatus === "degraded"
                                  ? "active"
                                  : "fail"
                            }
                            value={authenticationMonitoringSummary ? humanizePolicy(authenticationMonitoringSummary.overallStatus) : humanizePolicy(latestAuthenticationMonitoringRun.status)}
                          />
                          <MetadataCard label="Execution Time" value={formatDuration(authenticationMonitoringSummary?.durationMs ?? latestAuthenticationMonitoringRun.durationMs)} />
                          <MetadataCard label="Last Success" value={lastAuthenticationSuccess ? formatDate(lastAuthenticationSuccess.completedAt ?? lastAuthenticationSuccess.createdAt) : "None"} />
                          <MetadataCard label="Last Failure" value={lastAuthenticationFailure ? formatDate(lastAuthenticationFailure.completedAt ?? lastAuthenticationFailure.createdAt) : "None"} />
                        </div>
                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          <AuthenticationCheckCard label="Username & Password" result={authenticationMonitoringSummary?.checks["username-password"]} />
                          <AuthenticationCheckCard label="Google OAuth" result={authenticationMonitoringSummary?.checks["google-oauth"]} />
                          <AuthenticationCheckCard label="Apple Sign-In" result={authenticationMonitoringSummary?.checks["apple-sign-in"]} />
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
                          <span className="text-slate-400">Environment</span>
                          <span className="font-semibold capitalize text-slate-100">{authenticationMonitoringEnvironment}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-400">Target</span>
                          <span className="font-mono text-xs text-slate-200">{authenticationMonitoringSummary?.targetHost ?? "evidence pending"}</span>
                          {latestAuthenticationMonitoringReport ? (
                            <a className="primary-action ml-auto" href={`/api/artifacts/${latestAuthenticationMonitoringReport.id}/file`} rel="noreferrer" target="_blank">
                              Open Evidence
                            </a>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
                        <p className="font-semibold text-slate-100">No authentication monitoring runs exist for this environment.</p>
                        <p className="mt-1">The scheduler or an approved operator must execute the environment-specific monitoring campaign first.</p>
                      </div>
                    )}
                  </section>

                  <section className="workspace-card">
                    <SectionHeader title="Historical Runs" subtitle={`${authenticationMonitoringRuns.length} authentication monitoring runs for ${authenticationMonitoringEnvironment}.`} />
                    <div className="monitoring-table-scroll mt-4">
                      <table className="w-full min-w-[48rem] text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Run</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Started</th>
                            <th className="px-4 py-3">Duration</th>
                            <th className="px-4 py-3">Evidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {authenticationMonitoringRuns.map((run) => {
                            const report = reportArtifacts.find((artifact) => artifact.runId === run.id && artifact.artifactType === "Playwright Report");
                            return (
                              <tr className="text-slate-300" key={run.id}>
                                <td className="px-4 py-3 font-mono text-xs">{run.id}</td>
                                <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                                <td className="px-4 py-3 text-xs">{formatDate(run.startedAt ?? run.createdAt)}</td>
                                <td className="px-4 py-3">{formatDuration(run.durationMs)}</td>
                                <td className="px-4 py-3">{report ? <a className="text-cyan-200 hover:text-cyan-100" href={`/api/artifacts/${report.id}/file`} rel="noreferrer" target="_blank">Open</a> : "Pending"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              ) : null}

              {activeWorkspace === "monitoring" ? (
                <div className="space-y-5">
                  <section className="workspace-card">
                    <SectionHeader title="Monitoring Framework" subtitle="Managed observation definitions for campaigns across products and environments." />
                    <p className="mt-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                      Schedule triggers enqueue durable execution jobs only. Campaign execution remains isolated in the existing worker, and notification delivery is not implemented.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetadataCard label="Definitions" value={String(monitoringCounts.total)} />
                      <MetadataCard label="Enabled Definitions" value={String(monitoringCounts.enabled)} />
                      <MetadataCard label="Products" value={String(monitoringCounts.products)} />
                      <MetadataCard label="Schedule Definitions" value={String(monitoringCounts.scheduledDefinitions)} />
                    </div>
                  </section>

                  <section className="workspace-card">
                    <SectionHeader title="Scheduler Status" subtitle="Read-only health for the schedule trigger service." />
                    {schedulerStatusError ? (
                      <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
                        <p className="font-semibold">Scheduler status failed to load.</p>
                        <p className="mt-1 break-words">{schedulerStatusError}</p>
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <MetadataCard label="Running" tone={schedulerStatus?.running ? "pass" : "warn"} value={schedulerStatus?.running ? "Yes" : "No"} />
                        <MetadataCard label="Heartbeat" value={schedulerStatus?.heartbeatAt ? formatDate(schedulerStatus.heartbeatAt) : "Not observed"} />
                        <MetadataCard label="Last Evaluation" value={schedulerStatus?.lastEvaluationAt ? formatDate(schedulerStatus.lastEvaluationAt) : "Not evaluated"} />
                        <MetadataCard label="Jobs Queued Today" value={String(schedulerStatus?.jobsQueuedToday ?? 0)} />
                      </div>
                    )}
                  </section>

                  <section className="workspace-card">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <SectionHeader title="Monitors" subtitle={`${visibleMonitoringDefinitions.length} of ${monitoringDefinitions.length} definitions shown.`} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs text-slate-400">
                          Product
                          <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" onChange={(event) => setMonitoringProductFilter(event.target.value)} value={monitoringProductFilter}>
                            <option value="all">All products</option>
                            {monitoringProducts.map((product) => <option key={product} value={product}>{product}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-slate-400">
                          Definition status
                          <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" onChange={(event) => setMonitoringEnabledFilter(event.target.value)} value={monitoringEnabledFilter}>
                            <option value="all">All definitions</option>
                            <option value="enabled">Enabled</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    {monitoringError ? (
                      <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
                        <p className="font-semibold">Monitoring definitions failed to load.</p>
                        <p className="mt-1 break-words">{monitoringError}</p>
                      </div>
                    ) : (
                      <div className="monitoring-table-scroll mt-4">
                        {visibleMonitoringDefinitions.length === 0 ? (
                          <div className="p-6 text-sm text-slate-400">
                            <p className="font-semibold text-slate-200">No monitoring definitions match the current filters.</p>
                            <p className="mt-1">Definitions are provisioned through platform metadata, not from this read-only workspace.</p>
                          </div>
                        ) : (
                          <table className="w-full min-w-[78rem] text-left text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Monitor</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Product</th>
                                <th className="px-4 py-3">Campaign</th>
                                <th className="px-4 py-3">Environment</th>
                                <th className="px-4 py-3">Trigger</th>
                                <th className="px-4 py-3">Enabled</th>
                                <th className="px-4 py-3">Evidence</th>
                                <th className="px-4 py-3">Notification</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                              {visibleMonitoringDefinitions.map((definition) => (
                                <tr className="align-top text-slate-300" key={definition.id}>
                                  <td className="max-w-xs px-4 py-4">
                                    <p className="font-semibold text-slate-100">{definition.name}</p>
                                    <p className="mt-1 font-mono text-xs text-slate-500">{definition.id}</p>
                                    <p className="mt-2 text-xs text-slate-500">{formatMonitoringPolicySummary(definition)}</p>
                                  </td>
                                  <td className="px-4 py-4"><span className={`report-chip ${definition.enabled ? "" : "report-chip-warn"}`}>{monitoringDefinitionStatus(definition)}</span></td>
                                  <td className="px-4 py-4 font-semibold">{definition.product}</td>
                                  <td className="max-w-xs break-all px-4 py-4 font-mono text-xs">{definition.campaignId}</td>
                                  <td className="px-4 py-4 capitalize">{definition.environment}</td>
                                  <td className="px-4 py-4 capitalize">{humanizePolicy(definition.triggerType)}</td>
                                  <td className="px-4 py-4">{definition.enabled ? "Yes" : "No"}</td>
                                  <td className="px-4 py-4 capitalize">{humanizePolicy(definition.evidencePolicy)}</td>
                                  <td className="px-4 py-4 capitalize">{humanizePolicy(definition.notificationPolicy)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {activeWorkspace === "notifications" ? (
                <div className="space-y-5">
                  <section className="workspace-card">
                    <SectionHeader title="Notification Outbox" subtitle="Durable platform events only. External delivery is not implemented." />
                    <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
                      This workspace is read only. There is no send action and no notification provider is called by the execution worker.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetadataCard label="Pending" value={String(notificationCounts.pending)} />
                      <MetadataCard label="Failed" value={String(notificationCounts.failed)} />
                      <MetadataCard label="Delivered" value={String(notificationCounts.delivered)} />
                      <MetadataCard label="Dead Letter" value={String(notificationCounts.deadLetter)} />
                    </div>
                  </section>

                  <section className="workspace-card">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <SectionHeader title="Event Journal" subtitle={`${visibleNotifications.length} of ${notifications.length} events shown.`} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs text-slate-400">
                          Status
                          <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" onChange={(event) => setNotificationStatusFilter(event.target.value)} value={notificationStatusFilter}>
                            <option value="all">All statuses</option>
                            <option value="pending">Pending</option>
                            <option value="processing">Processing</option>
                            <option value="delivered">Delivered</option>
                            <option value="failed">Failed</option>
                            <option value="dead_letter">Dead Letter</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-400">
                          Severity
                          <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" onChange={(event) => setNotificationSeverityFilter(event.target.value)} value={notificationSeverityFilter}>
                            <option value="all">All severities</option>
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                            <option value="informational">Informational</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    {notificationError ? (
                      <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
                        <p className="font-semibold">Notification outbox failed to load.</p>
                        <p className="mt-1 break-words">{notificationError}</p>
                      </div>
                    ) : (
                      <div className="notification-table-scroll mt-4">
                        {visibleNotifications.length === 0 ? (
                          <p className="p-5 text-sm text-slate-400">No notification events match the current filters.</p>
                        ) : (
                          <table className="w-full min-w-[64rem] text-left text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Time</th>
                                <th className="px-4 py-3">Severity</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Event</th>
                                <th className="px-4 py-3">Run</th>
                                <th className="px-4 py-3">Campaign</th>
                                <th className="px-4 py-3">Environment</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                              {visibleNotifications.map((notification) => (
                                <tr className="align-top text-slate-300" key={notification.id}>
                                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDate(notification.createdAt)}</td>
                                  <td className="px-4 py-3"><span className={`notification-severity notification-severity-${notification.severity}`}>{notification.severity}</span></td>
                                  <td className="px-4 py-3"><span className="report-chip report-chip-blue">{notification.status.replace("_", " ")}</span></td>
                                  <td className="max-w-md px-4 py-3">
                                    <p className="font-semibold text-slate-100">{notification.title}</p>
                                    <p className="mt-1 break-words text-xs text-slate-500">{notification.eventType} · {notification.message}</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    {notification.runId ? (
                                      <button className="break-all font-mono text-xs text-cyan-200 hover:underline" onClick={() => { setSelectedRunId(notification.runId ?? ""); setActiveWorkspace("runs"); }} type="button">
                                        {notification.runId}
                                      </button>
                                    ) : <span className="text-slate-600">none</span>}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs">{notification.campaignId ?? "platform"}</td>
                                  <td className="px-4 py-3"><p>{notification.environment}</p><p className="text-xs text-slate-500">{notification.product}</p></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {activeWorkspace === "operations" ? (
                <div className="space-y-5">
                  <section className="workspace-card">
                    <SectionHeader title="Operations" subtitle="Platform health checks and operational diagnostics." />
                    <p className="mt-2 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
                      Operations commands validate local platform wiring. The healthcheck remains governed by the existing admin-only authorization rule.
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {operationsCommands.map((campaign) => (
                        <CommandCard
                          canStartRuns={canStartRuns}
                          campaign={campaign}
                          currentUserRole={currentUser.role}
                          key={campaign.key}
                          runningCount={overview.running}
                          runCampaign={runCampaign}
                        />
                      ))}
                    </div>
                  </section>

                  <section className="workspace-card">
                    <SectionHeader title="Diagnostics" subtitle="Current backend state and recent API failures." />
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <MetadataCard label="Backend" value={metadataBackend.backendLabel} />
                      <MetadataCard label="Runs" value={metadataBackend.counts ? String(metadataBackend.counts.runs) : "unavailable"} />
                      <MetadataCard label="Logs" value={metadataBackend.counts ? String(metadataBackend.counts.logs) : "unavailable"} />
                      <MetadataCard label="Artifacts" value={metadataBackend.counts ? String(metadataBackend.counts.artifacts) : "unavailable"} />
                    </div>
                    {apiFailures.length > 0 ? (
                      <div className="mt-4 grid gap-2 lg:grid-cols-2">
                        {apiFailures.map((failure) => (
                          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm" key={`${failure.timestamp}-${failure.endpoint}`}>
                            <p className="font-mono text-xs text-amber-100">{failure.endpoint}</p>
                            <p className="mt-1 text-slate-300">Status: {failure.status} · {formatDate(failure.timestamp)}</p>
                            <p className="mt-1 break-words text-slate-400">{failure.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-100">
                        No dashboard API failures recorded in this session.
                      </p>
                    )}
                  </section>
                </div>
              ) : null}

              {activeWorkspace === "runs" ? (
                <section className="run-workspace">
                  <div className="run-history-pane">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                      <SectionHeader title="Run History" subtitle="Filter by coarse execution state." />
                      <div className="flex flex-wrap gap-2">
                        {(["all", "running", "passed", "failed"] as RunFilter[]).map((filter) => (
                          <button
                            className={`rounded-full px-3 py-1.5 text-sm ${runFilter === filter ? "bg-cyan-300 text-slate-950" : "bg-slate-950 text-slate-300 ring-1 ring-slate-800"}`}
                            key={filter}
                            onClick={() => setRunFilter(filter)}
                            type="button"
                          >
                            {filter}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
                      {runHistoryError ? (
                        <div className="bg-rose-300/10 p-4 text-sm text-rose-100">
                          <p className="font-semibold">Run History failed to load.</p>
                          <p className="mt-1 break-words">{runHistoryError}</p>
                          <p className="mt-2 text-rose-100/80">
                            Backend: {metadataBackend.backendLabel} · Runs: {metadataBackend.counts ? metadataBackend.counts.runs : "unavailable"}
                          </p>
                        </div>
                      ) : (
                        <div className="run-history-list">
                          {visibleRuns.length === 0 ? (
                            <p className="bg-slate-950/50 p-4 text-sm text-slate-400">
                              No runs found in the current metadata backend.
                            </p>
                          ) : (
                            visibleRuns.map((run) => (
                              <button
                                className={`w-full rounded-none border-b border-slate-800 px-4 py-4 text-left text-sm transition last:border-b-0 hover:bg-slate-800/50 ${selectedRunId === run.id ? "bg-cyan-400/10" : "bg-slate-900/30"}`}
                                key={run.id}
                                onClick={() => setSelectedRunId(run.id)}
                                type="button"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <span className="break-all font-mono text-xs text-slate-300">{run.id}</span>
                                  <StatusBadge status={run.status} />
                                </div>
                                <p className="mt-2 font-medium">{run.campaignKey}</p>
                                <p className="mt-1 text-xs text-slate-500">{formatDate(run.createdAt)} · {formatDuration(run.durationMs)}</p>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="run-detail-pane">
                    <SectionHeader title="Run Detail" subtitle={selectedRun ? selectedRun.id : selectedRunId ? selectedRunId : "Select a run to inspect."} />
                    {selectedRun ? (
                      <div className="mt-4 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
                        <div className="min-w-0 space-y-5">
                          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <MetadataCard label="Status" value={selectedRun.status} />
                            <MetadataCard label="Duration" value={formatDuration(selectedRun.durationMs)} />
                            <MetadataCard label="Exit Code" value={selectedRun.exitCode === null ? "pending" : String(selectedRun.exitCode)} />
                            <MetadataCard label="Artifacts" value={String(artifacts.length)} />
                          </div>

                          {selectedRun.cleanup && selectedRun.cleanup.status !== "not_required" ? (
                            <section className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <h3 className="font-semibold text-amber-100">Cleanup {selectedRun.cleanup.status.replaceAll("_", " ")}</h3>
                                  <p className="mt-1 text-sm text-amber-100/80">
                                    {selectedRun.cleanup.createdCapsuleIds.length} capsule target(s) · {selectedRun.cleanup.createdArtifactIds.length} artifact reference(s)
                                  </p>
                                </div>
                                {currentUser.role === "admin" && selectedRun.cleanup.status === "pending" && !ACTIVE_STATUSES.has(selectedRun.status) ? (
                                  <button className="rounded-xl border border-amber-200/40 px-4 py-2 text-sm font-semibold text-amber-100" onClick={() => void confirmRunCleanup(selectedRun)} type="button">
                                    Confirm Manual Cleanup
                                  </button>
                                ) : null}
                              </div>
                              {selectedRun.cleanup.instructions.map((instruction) => <p className="mt-2 break-words text-sm text-amber-100/80" key={instruction}>{instruction}</p>)}
                            </section>
                          ) : null}

                          <div className="log-card">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <h3 className="font-semibold">Live Logs</h3>
                              <p className="text-xs text-slate-500">{logs.length} entries</p>
                            </div>
                            <div className="log-scroll">
                              {logs.length === 0 ? (
                                <p className="text-slate-500">No logs captured yet.</p>
                              ) : (
                                <div className="min-w-0 divide-y divide-slate-900/80">
                                  {logs.map((log) => (
                                    <div
                                      className={`grid min-w-0 grid-cols-[2.75rem_4.75rem_minmax(0,1fr)] gap-2 py-1.5 ${log.stream === "stderr" ? "text-amber-200" : log.stream === "system" ? "text-cyan-200" : "text-slate-300"}`}
                                      key={log.id}
                                    >
                                      <span className="text-right text-slate-600">{String(log.sequence).padStart(3, "0")}</span>
                                      <span className="truncate text-slate-500">{log.stream}</span>
                                      <span className="min-w-0 whitespace-pre-wrap break-words">{log.message}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <aside className="run-artifact-sidebar">
                          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                            <h3 className="font-semibold">Playwright Report</h3>
                            {playwrightReport ? (
                              <a className="mt-3 block break-words rounded-xl border border-cyan-300/40 bg-cyan-300/10 p-3 text-sm text-cyan-100" href={`/api/artifacts/${playwrightReport.id}/file`} target="_blank" rel="noreferrer">
                                {playwrightReport.filePath}
                              </a>
                            ) : (
                              <p className="mt-3 text-sm text-slate-400">No Playwright report artifact indexed for this run.</p>
                            )}
                          </div>

                          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="font-semibold">Artifacts</h3>
                              <p className="text-xs text-slate-500">{artifacts.length} total</p>
                            </div>
                            <div className="artifact-scroll">
                              {artifacts.length === 0 ? (
                                <p className="text-sm text-slate-400">No artifacts indexed yet.</p>
                              ) : (
                                artifacts.map((artifact) => (
                                  <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3" key={artifact.id}>
                                    <div className="flex items-start justify-between gap-3">
                                      <p className="min-w-0 break-words text-sm font-medium">{artifact.artifactType}</p>
                                      <p className="shrink-0 text-xs text-slate-500">{formatBytes(artifact.fileSize)}</p>
                                    </div>
                                    <p className="mt-1 min-w-0 break-words font-mono text-xs text-slate-400">{artifact.filePath}</p>
                                    <p className="mt-2 break-words text-xs text-slate-500">
                                      {artifact.contentType} · sensitive: {artifact.sensitive ? "yes" : "no"} · inline: {artifact.renderInline ? "yes" : "no"}
                                    </p>
                                    {canOpenArtifact(artifact) ? (
                                      <a
                                        className="mt-3 inline-flex rounded-lg border border-cyan-300/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10"
                                        href={`/api/artifacts/${artifact.id}/file`}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        {artifact.artifactType === "SIEM Export" ? "Download" : "Open"}
                                      </a>
                                    ) : null}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </aside>
                      </div>
                    ) : runDetailError ? (
                      <div className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-300/10 p-4 text-sm text-rose-100">
                        <p className="font-semibold">Selected run could not be loaded.</p>
                        <p className="mt-1 break-words">{runDetailError}</p>
                        <p className="mt-2 font-mono text-xs text-rose-100/80">{selectedRunId}</p>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-slate-400">No run selected.</p>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        </div>

        <footer className="ops-footer">
          <span>Environment: staging</span>
          <span>Runner: {overview.running > 0 ? "running" : "idle"}</span>
          <span>Backend: {metadataBackend.backendLabel}</span>
          <span>Role: {currentUser.role}</span>
          <span>Last run: {runs[0] ? formatRelativeTime(runs[0].createdAt) : "none"}</span>
        </footer>
        {approvalCampaign ? (
          <LiveCampaignApprovalModal
            acknowledgements={approvalAcknowledgements}
            artifactPath={approvalArtifactPath}
            campaign={approvalCampaign}
            checks={preflightChecks}
            error={approvalError}
            executionMode={approvalExecutionMode}
            onAcknowledgementsChange={setApprovalAcknowledgements}
            onArtifactPathChange={setApprovalArtifactPath}
            onClose={() => setApprovalCampaignKey("")}
            onExecutionModeChange={setApprovalExecutionMode}
            onPhraseChange={setApprovalPhrase}
            onSubmit={() => void submitLiveCampaignApproval(approvalCampaign)}
            phrase={approvalPhrase}
            revealLaterArtifacts={revealLaterArtifacts}
            runningCount={overview.running}
            submitting={approvalSubmitting}
          />
        ) : null}
      </div>
    </main>
  );
}

function LiveCampaignApprovalModal({
  acknowledgements,
  artifactPath,
  campaign,
  checks,
  error,
  executionMode,
  onAcknowledgementsChange,
  onArtifactPathChange,
  onClose,
  onExecutionModeChange,
  onPhraseChange,
  onSubmit,
  phrase,
  revealLaterArtifacts,
  runningCount,
  submitting
}: {
  acknowledgements: string[];
  artifactPath: string;
  campaign: CampaignDefinition;
  checks: PreflightCheck[];
  error: string;
  executionMode: "" | "create" | "resume";
  onAcknowledgementsChange: (value: string[]) => void;
  onArtifactPathChange: (value: string) => void;
  onClose: () => void;
  onExecutionModeChange: (value: "" | "create" | "resume") => void;
  onPhraseChange: (value: string) => void;
  onSubmit: () => void;
  phrase: string;
  revealLaterArtifacts: LifecycleArtifactOption[];
  runningCount: number;
  submitting: boolean;
}) {
  const acknowledgementOptions = [
    ["modifies_staging", "I understand this campaign modifies staging data."],
    ["target_verified", "I have verified the target is staging."],
    ["cleanup_understood", "I understand cleanup may be required."],
    ["evidence_review_required", "I will review the evidence and cleanup result."],
    ["no_automatic_final_action_retry", "I understand final lifecycle actions must not be automatically retried."]
  ] as const;
  const modeReady = !campaign.supportsExecutionModes || (executionMode === "create" || (executionMode === "resume" && Boolean(artifactPath)));
  const approvalReady = acknowledgementOptions.every(([id]) => acknowledgements.includes(id)) && phrase === "RUN STAGING MUTATION" && modeReady;
  const selectedRevealArtifact = revealLaterArtifacts.find((artifact) => artifact.filePath === artifactPath);

  return (
    <div aria-modal="true" className="live-approval-backdrop" role="dialog">
      <section className="live-approval-panel">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Admin approval · staging only</p>
            <h2 className="mt-2 text-xl font-semibold">Review and Run: {campaign.displayName}</h2>
            <p className="mt-1 font-mono text-xs text-slate-500">npm run {campaign.npmScript}</p>
          </div>
          <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300" onClick={onClose} type="button">Close</button>
        </div>
        <div className="live-approval-scroll">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetadataCard label="Environment" value="STAGING" tone="warn" />
            <MetadataCard label="Target" value="staging.inssa.us" />
            <MetadataCard label="Risk" value="live mutation" tone="warn" />
            <MetadataCard label="Active Runs" value={String(runningCount)} tone={runningCount ? "warn" : "pass"} />
            <MetadataCard label="Estimated Duration" value={formatDuration(campaign.timeoutMs)} />
            <MetadataCard label="Reports" value={campaign.producesReports ? "Generated" : "None"} />
            <MetadataCard label="Credentials" value={campaign.requiresSecondaryAccount ? "Primary + secondary QA" : "Primary QA"} />
            <MetadataCard label="Final Action Retry" value="Disabled" tone="warn" />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <CampaignDetailList title="Purpose" items={[campaign.operatorDescription]} />
            <CampaignDetailList title="Expected Evidence" items={["Immutable Playwright evidence", "Campaign and lifecycle summaries", "Cleanup manifest", campaign.producesFindings ? "Security findings" : "Run diagnostics"]} />
            <CampaignDetailList title="Data Changed" items={["One or more QA-tagged staging artifacts", "Staging account lifecycle/history surfaces", campaign.requiresSecondaryAccount ? "Primary and secondary QA account visibility" : "Primary QA account visibility"]} />
            <CampaignDetailList title="Cleanup" items={["Manual cleanup ownership remains with the approving admin", "Evidence is retained and is never deleted by cleanup confirmation"]} />
          </div>

          {campaign.supportsExecutionModes ? (
            <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <h3 className="text-sm font-semibold">Execution Mode</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="rounded-xl border border-slate-700 p-3 text-sm"><input checked={executionMode === "create"} name="execution-mode" onChange={() => onExecutionModeChange("create")} type="radio" /> <span className="ml-2">Create new test artifact</span></label>
                <label className="rounded-xl border border-slate-700 p-3 text-sm"><input checked={executionMode === "resume"} name="execution-mode" onChange={() => onExecutionModeChange("resume")} type="radio" /> <span className="ml-2">Resume existing approved artifact</span></label>
              </div>
              {executionMode === "resume" ? (
                <>
                  <select className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm" onChange={(event) => onArtifactPathChange(event.target.value)} value={artifactPath}>
                    <option value="">Select approved reveal-later artifact</option>
                    {revealLaterArtifacts.map((artifact) => <option key={artifact.filePath} value={artifact.filePath}>{artifact.filePath} · {formatDate(artifact.timestamp)}</option>)}
                  </select>
                  {selectedRevealArtifact ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <Metadata label="Artifact ID" value={selectedRevealArtifact.artifactId ?? "unavailable"} mono />
                      <Metadata label="Owner" value={selectedRevealArtifact.owner ?? "unavailable"} />
                      <Metadata label="Reveal time" value={selectedRevealArtifact.scheduledAtIso ? formatDate(selectedRevealArtifact.scheduledAtIso) : "unavailable"} />
                      <Metadata label="Lifecycle state" value={selectedRevealArtifact.lifecycleState ?? "unavailable"} />
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          <section className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4">
            <h3 className="font-semibold text-amber-100">Required Acknowledgements</h3>
            <div className="mt-3 space-y-3">
              {acknowledgementOptions.map(([id, label]) => (
                <label className="flex gap-3 text-sm text-amber-50" key={id}>
                  <input checked={acknowledgements.includes(id)} onChange={(event) => onAcknowledgementsChange(event.target.checked ? [...acknowledgements, id] : acknowledgements.filter((item) => item !== id))} type="checkbox" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label className="mt-4 block text-xs uppercase tracking-[0.15em] text-amber-200" htmlFor="mutation-confirmation">Type RUN STAGING MUTATION</label>
            <input className="mt-2 w-full rounded-xl border border-amber-200/30 bg-slate-950 px-3 py-2 font-mono text-sm" id="mutation-confirmation" onChange={(event) => onPhraseChange(event.target.value)} value={phrase} />
          </section>

          {checks.length ? <div className="mt-4 grid gap-2">{checks.map((check) => <p className={`rounded-xl border p-3 text-sm ${check.passed ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-rose-300/20 bg-rose-300/10 text-rose-100"}`} key={check.id}>{check.passed ? "PASS" : "FAIL"}: {check.detail}</p>)}</div> : null}
          {error ? <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p> : null}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-slate-800 p-5">
          <p className="text-xs text-slate-500">The confirmation phrase is validated but never persisted.</p>
          <button className="rounded-xl bg-amber-300 px-5 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" disabled={!approvalReady || runningCount > 0 || submitting} onClick={onSubmit} type="button">{submitting ? "Running Preflight..." : "Run Staging Mutation"}</button>
        </div>
      </section>
    </div>
  );
}

function ThemeToggle({ onChange, value }: { onChange: (value: ThemeMode) => void; value: ThemeMode }) {
  return (
    <div aria-label="Theme" className="flex rounded-xl border border-slate-800 bg-slate-950/70 p-1">
      {(["dark", "light"] as const).map((theme) => (
        <button
          aria-pressed={value === theme}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === theme ? "bg-cyan-300 text-slate-950" : "text-slate-400 hover:text-cyan-100"
          }`}
          key={theme}
          onClick={() => onChange(theme)}
          type="button"
        >
          {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
        </button>
      ))}
    </div>
  );
}

function TopMetric({
  label,
  tone = "neutral",
  value
}: {
  label: string;
  tone?: "active" | "neutral" | "pass";
  value: string;
}) {
  const toneClass = {
    active: "text-cyan-200 before:bg-cyan-300",
    neutral: "text-slate-100 before:bg-slate-500",
    pass: "text-emerald-200 before:bg-emerald-300"
  }[tone];

  return (
    <div className="min-w-[9rem] border-slate-800/80 lg:border-l lg:px-6">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 flex items-center gap-2 text-sm font-semibold ${toneClass} before:block before:h-2 before:w-2 before:rounded-full`}>
        {value}
      </p>
    </div>
  );
}

function SectionHeader({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
    </div>
  );
}

function OverviewCard({ label, tone = "neutral", value }: { label: string; tone?: "active" | "fail" | "neutral" | "pass"; value: number }) {
  const toneClass = {
    active: "text-cyan-200",
    fail: "text-rose-200",
    neutral: "text-slate-100",
    pass: "text-emerald-200"
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className={`mt-4 text-3xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function CommandCard({
  campaign,
  canStartRuns,
  currentUserRole,
  runningCount,
  runCampaign
}: {
  campaign: CampaignDefinition;
  canStartRuns: boolean;
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  runningCount: number;
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
}) {
  const disabled =
    !canStartRuns ||
    !campaign.phase1Enabled ||
    campaign.mutatesStaging ||
    runningCount > 0 ||
    (currentUserRole !== "admin" && campaign.key === "platform_healthcheck");

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{campaign.displayName}</h3>
          <p className="mt-1 font-mono text-xs text-slate-400">{campaign.key}</p>
        </div>
        <RiskBadge risk={campaign.riskLevel} />
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
        <Metadata label="NPM script" value={campaign.npmScript} mono />
        <Metadata label="Type" value={formatCommandType(campaign.commandType)} />
        <Metadata label="Mutates staging" value={campaign.mutatesStaging ? "yes" : "no"} />
        <Metadata label="Fresh findings" value={campaign.producesFindings ? "yes" : "no"} />
        <Metadata label="Reports" value={campaign.producesReports ? "yes" : "no"} />
        <Metadata label="Timeout" value={`${Math.round(campaign.timeoutMs / 1000)}s`} />
      </dl>
      <p className="mt-4 text-sm leading-6 text-slate-400">{campaign.operatorDescription}</p>
      <button
        className="mt-5 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        disabled={disabled}
        onClick={() => void runCampaign(campaign.key)}
        type="button"
      >
        {canStartRuns ? actionLabelForCommand(campaign) : "Viewer role cannot run"}
      </button>
    </article>
  );
}

type ActionOption =
  | {
      campaign: CampaignDefinition;
      description: string;
      disabled: false;
      key: string;
      label: string;
      npmScript: string;
      riskLevel: string;
    }
  | {
      command: DisabledCommandCard;
      description: string;
      disabled: true;
      key: string;
      label: string;
      npmScript: string;
      riskLevel: string;
    };

function CampaignLibraryWorkspace({
  campaignCategory,
  campaignProduct,
  canStartRuns,
  currentUserRole,
  managedCampaigns,
  onCategoryChange,
  onProductChange,
  onReviewLiveCampaign,
  onSearchChange,
  onSelectCampaign,
  runningCount,
  runCampaign,
  runs,
  search,
  selectedCampaign,
  selectedCampaignId,
  visibleCampaigns
}: {
  campaignCategory: CampaignCategory | "All";
  campaignProduct: ProductKey;
  canStartRuns: boolean;
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  managedCampaigns: ManagedCampaign[];
  onCategoryChange: (category: CampaignCategory | "All") => void;
  onProductChange: (product: ProductKey) => void;
  onReviewLiveCampaign: (campaign: CampaignDefinition) => Promise<void>;
  onSearchChange: (value: string) => void;
  onSelectCampaign: (campaignId: string) => void;
  runningCount: number;
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
  runs: RunRecord[];
  search: string;
  selectedCampaign: ManagedCampaign | null;
  selectedCampaignId: string;
  visibleCampaigns: ManagedCampaign[];
}) {
  const executableCount = managedCampaigns.filter((campaign) => campaign.executionEnabled).length;
  const disabledCount = managedCampaigns.filter((campaign) => !campaign.executionEnabled).length;
  const liveMutationCount = managedCampaigns.filter((campaign) => campaign.mutatesStaging).length;
  const cleanupCount = managedCampaigns.filter((campaign) => campaign.cleanupRequired).length;

  return (
    <section className="campaign-library">
      <div className="campaign-library-header">
        <div>
          <SectionHeader
            title="Campaign Library"
            subtitle="Managed campaign definitions for current and future products. Execution still uses approved registry commands only."
          />
          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-400">
            Campaigns execute tests. Reports review evidence. Governed lifecycle commands are staging-only and require admin approval plus cleanup ownership.
          </p>
        </div>
        <div className="campaign-library-metrics">
          <MetadataCard label="Executable" value={String(executableCount)} tone="pass" />
          <MetadataCard label="Disabled" value={String(disabledCount)} />
          <MetadataCard label="Live Mutation" value={String(liveMutationCount)} tone="warn" />
          <MetadataCard label="Cleanup Required" value={String(cleanupCount)} tone="warn" />
        </div>
      </div>

      <div className="campaign-product-strip">
        {PRODUCT_KEYS.map((product) => {
          const count = managedCampaigns.filter((campaign) => campaign.product === product).length;
          const futureProduct = product !== "INSSA";
          return (
            <button
              className={`campaign-product-card ${campaignProduct === product ? "campaign-product-card-active" : ""}`}
              key={product}
              onClick={() => {
                onProductChange(product);
                onSelectCampaign("");
              }}
              type="button"
            >
              <span className="text-sm font-semibold">{product}</span>
              <span className="mt-1 block text-xs text-slate-500">
                {futureProduct ? "Future onboarding" : `${count} managed campaigns`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="campaign-library-grid">
        <aside className="campaign-library-explorer">
          <div className="grid gap-3">
            <input
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search campaigns..."
              value={search}
            />
            <select
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              onChange={(event) => {
                onCategoryChange(event.target.value === "All" ? "All" : (event.target.value as CampaignCategory));
                onSelectCampaign("");
              }}
              value={campaignCategory}
            >
              <option value="All">All categories</option>
              {CAMPAIGN_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="campaign-library-list">
            {visibleCampaigns.map((campaign) => (
              <button
                className={`campaign-library-item ${selectedCampaignId === campaign.id ? "campaign-library-item-active" : ""}`}
                key={campaign.id}
                onClick={() => onSelectCampaign(campaign.id)}
                type="button"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{campaign.name}</p>
                    <p className="mt-1 truncate font-mono text-xs text-slate-500">{campaign.npmScript}</p>
                  </div>
                  <RiskBadge risk={campaign.risk} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="report-chip report-chip-blue">{campaign.category}</span>
                  <span className={campaign.executionEnabled ? "report-chip" : "report-chip report-chip-warn"}>
                    {campaign.status}
                  </span>
                </div>
              </button>
            ))}
            {visibleCampaigns.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 p-5 text-sm leading-6 text-slate-400">
                {campaignProduct === "INSSA"
                  ? "No INSSA campaigns match the current filters."
                  : `${campaignProduct} campaign definitions are not onboarded yet. The library is product-aware, but execution remains INSSA-only in the current phase.`}
              </div>
            ) : null}
          </div>
        </aside>

        <CampaignDetailPanel
          campaign={selectedCampaign}
          canStartRuns={canStartRuns}
          currentUserRole={currentUserRole}
          latestRun={selectedCampaign?.commandKey ? findLatestRunForCommand(runs, selectedCampaign.commandKey) : null}
          onReviewLiveCampaign={onReviewLiveCampaign}
          runningCount={runningCount}
          runCampaign={runCampaign}
        />
      </div>
    </section>
  );
}

function CampaignDetailPanel({
  campaign,
  canStartRuns,
  currentUserRole,
  latestRun,
  onReviewLiveCampaign,
  runningCount,
  runCampaign
}: {
  campaign: ManagedCampaign | null;
  canStartRuns: boolean;
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  latestRun: RunRecord | null;
  onReviewLiveCampaign: (campaign: CampaignDefinition) => Promise<void>;
  runningCount: number;
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
}) {
  if (!campaign) {
    return (
      <article className="campaign-detail-panel">
        <div className="evidence-preview-empty">
          Select a managed campaign to inspect purpose, prerequisites, cleanup requirements, outputs, and execution readiness.
        </div>
      </article>
    );
  }

  const executionDisabled =
    !campaign.executionEnabled ||
    !campaign.commandKey ||
    !canStartRuns ||
    runningCount > 0 ||
    (currentUserRole !== "admin" && (campaign.commandKey === "platform_healthcheck" || campaign.mutatesStaging));
  const registryCommand = campaign.definition;

  return (
    <article className="campaign-detail-panel">
      <div className="campaign-detail-hero">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="report-chip report-chip-blue">{campaign.product}</span>
            <span className="report-chip">{campaign.category}</span>
            {!campaign.executionEnabled ? <span className="report-chip report-chip-warn">Approval Required</span> : null}
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">{campaign.name}</h2>
          <p className="mt-2 break-words font-mono text-xs text-slate-500">{campaign.npmScript}</p>
          <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-400">{campaign.description}</p>
        </div>
        <RiskBadge risk={campaign.risk} />
      </div>

      <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetadataCard label="Environment" value={campaign.environment} />
        <MetadataCard label="Status" value={campaign.status} tone={campaign.executionEnabled ? "pass" : "warn"} />
        <MetadataCard label="Estimated Duration" value={campaign.estimatedDuration} />
        <MetadataCard label="Last Run" value={latestRun ? formatCampaignExecutionState(latestRun) : "none"} />
        <MetadataCard label="Mutates Staging" value={campaign.mutatesStaging ? "yes" : "no"} tone={campaign.mutatesStaging ? "warn" : "pass"} />
        <MetadataCard label="Cleanup Required" value={campaign.cleanupRequired ? "yes" : "no"} tone={campaign.cleanupRequired ? "warn" : "pass"} />
        <MetadataCard label="Approval Required" value={campaign.approvalRequired ? "yes" : "no"} tone={campaign.approvalRequired ? "warn" : "pass"} />
        <MetadataCard label="Produces" value={campaign.produces.join(", ") || "metadata"} />
      </dl>

      {campaign.disabledReason ? (
        <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
          {campaign.disabledReason}
        </p>
      ) : null}

      <div className="campaign-detail-grid">
        <CampaignDetailList title="Purpose" items={[campaign.description]} />
        <CampaignDetailList title="Prerequisites" items={campaign.prerequisites} />
        <CampaignDetailList title="Expected Outputs" items={campaign.produces} />
        <CampaignDetailList title="Cleanup Requirements" items={campaign.cleanupRequired ? ["Manual cleanup evidence and owner responsibility required."] : ["No cleanup required."]} />
        <CampaignDetailList title="Evidence Produced" items={campaign.evidenceProduced} />
        <CampaignDetailList title="Related Validation" items={campaign.relatedValidation} />
        <CampaignDetailList title="Related Reports" items={campaign.relatedReports} />
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Execution Readiness</p>
          <p className="mt-1 text-sm text-slate-400">
            {campaign.executionEnabled
              ? campaign.mutatesStaging
                ? "Admin review, explicit acknowledgements, and server-side preflight are required before the durable job is created."
                : "This command is already enabled in the approved registry."
              : "This campaign is managed for visibility only and cannot be executed in the current phase."}
          </p>
        </div>
        <button
          className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          disabled={executionDisabled}
          onClick={() => {
            if (!campaign.commandKey) return;
            if (campaign.mutatesStaging && registryCommand) void onReviewLiveCampaign(registryCommand);
            else void runCampaign(campaign.commandKey);
          }}
          type="button"
        >
          {campaign.executionEnabled
            ? campaign.mutatesStaging
              ? currentUserRole === "admin" ? "Review and Run" : "Admin approval required"
              : canStartRuns ? "Run Campaign" : "Viewer role cannot run"
            : "Disabled"}
        </button>
      </div>
    </article>
  );
}

function CampaignDetailList({ items, title }: { items: string[]; title: string }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
        {(items.length ? items : ["Not specified."]).map((item) => (
          <li className="break-words" key={item}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActionSelectorPanel({
  canStartRuns,
  currentUserRole,
  disabledCommands,
  enabledCommands,
  onSelect,
  onReviewLiveCampaign,
  runningCount,
  runs,
  runCampaign,
  selectedKey
}: {
  canStartRuns: boolean;
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  disabledCommands: DisabledCommandCard[];
  enabledCommands: CampaignDefinition[];
  onSelect: (key: string) => void;
  onReviewLiveCampaign?: (campaign: CampaignDefinition) => Promise<void>;
  runningCount: number;
  runs: RunRecord[];
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
  selectedKey: string;
}) {
  const options = buildActionOptions(enabledCommands, disabledCommands);
  const selected = options.find((option) => option.key === selectedKey) ?? options[0] ?? null;
  const latestRun = selected && !selected.disabled ? findLatestRunForCommand(runs, selected.campaign.key) : null;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ActionSelector options={options} selectedKey={selected?.key ?? ""} onSelect={onSelect} />
      {selected ? (
        <ActionDetail
          canStartRuns={canStartRuns}
          currentUserRole={currentUserRole}
          latestRun={latestRun}
          onReviewLiveCampaign={onReviewLiveCampaign}
          option={selected}
          runningCount={runningCount}
          runCampaign={runCampaign}
        />
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
          No actions are available in this section.
        </div>
      )}
    </div>
  );
}

function ActionSelector({
  onSelect,
  options,
  selectedKey
}: {
  onSelect: (key: string) => void;
  options: ActionOption[];
  selectedKey: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="px-2 pb-2 text-xs uppercase tracking-[0.18em] text-slate-500">Action Selector</p>
      <div className="space-y-2">
        {options.map((option) => (
          <button
            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
              selectedKey === option.key
                ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
                : "border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600"
            }`}
            key={option.key}
            onClick={() => onSelect(option.key)}
            type="button"
          >
            <span className="block text-sm font-semibold">{option.label}</span>
            <span className="mt-1 block font-mono text-xs text-slate-500">{option.npmScript}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionDetail({
  canStartRuns,
  currentUserRole,
  latestRun,
  onReviewLiveCampaign,
  option,
  runningCount,
  runCampaign
}: {
  canStartRuns: boolean;
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  latestRun: RunRecord | null;
  onReviewLiveCampaign?: (campaign: CampaignDefinition) => Promise<void>;
  option: ActionOption;
  runningCount: number;
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
}) {
  const campaign = option.disabled ? null : option.campaign;
  const disabled =
    option.disabled ||
    !campaign ||
    !canStartRuns ||
    !campaign.phase1Enabled ||
    runningCount > 0 ||
    (currentUserRole !== "admin" && (campaign.key === "platform_healthcheck" || campaign.mutatesStaging));

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{option.label}</h3>
          <p className="mt-1 break-words font-mono text-xs text-slate-400">{option.npmScript}</p>
        </div>
        <RiskBadge risk={option.riskLevel} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-400">{option.description}</p>
      <dl className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
        <Metadata label="Risk level" value={option.riskLevel} />
        <Metadata label="Produces reports" value={campaign?.producesReports ? "yes" : option.disabled ? "not enabled" : "no"} />
        <Metadata label="Produces findings" value={campaign?.producesFindings ? "yes" : option.disabled ? "not enabled" : "no"} />
        <Metadata label="Mutates staging" value={campaign?.mutatesStaging ? "yes" : option.disabled && option.riskLevel.includes("mutation") ? "yes" : "no"} />
        <Metadata label="Cleanup required" value={cleanupRequiredForAction(option) ? "yes" : "no"} />
        <Metadata label="Estimated duration" value={campaign ? formatDuration(campaign.timeoutMs) : "not available"} />
        <Metadata label="Execution status" value={latestRun ? formatCampaignExecutionState(latestRun) : option.disabled ? "disabled in current phase" : "not run yet"} />
        <Metadata label="Last run" value={latestRun ? latestRun.id : "none"} mono />
        <Metadata label="Disabled reason" value={option.disabled ? disabledReasonSummary(option.command) : "not disabled"} />
      </dl>
      {option.disabled ? (
        <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
          {option.command.reason}
        </p>
      ) : null}
      <button
        className="mt-5 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        disabled={disabled}
        onClick={() => campaign && (campaign.mutatesStaging ? void onReviewLiveCampaign?.(campaign) : void runCampaign(campaign.key))}
        type="button"
      >
        {option.disabled || !campaign
          ? "Disabled"
          : campaign.mutatesStaging
            ? currentUserRole === "admin" ? "Review and Run" : "Admin approval required"
            : canStartRuns ? actionLabelForCommand(campaign) : "Viewer role cannot run"}
      </button>
    </article>
  );
}

function DeferredCleanupBanner() {
  return (
    <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
      <p className="font-semibold">INSSA staging cleanup is deferred because direct database access is unavailable.</p>
      <p className="mt-1 text-amber-100/75">
        Deferred objects remain unresolved INSSA staging data. The ledger records ownership, age, evidence, and retention; it does not delete product data.
      </p>
    </div>
  );
}

function MutationCampaignReadiness({
  artifacts,
  campaigns,
  cleanupLedger,
  onOpenRun,
  runs
}: {
  artifacts: ArtifactRecord[];
  campaigns: CampaignDefinition[];
  cleanupLedger: CleanupLedgerRecord[];
  onOpenRun: (runId: string) => void;
  runs: RunRecord[];
}) {
  if (campaigns.length === 0) return null;
  return (
    <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-semibold text-slate-100">Mutation deployment readiness</h3>
          <p className="text-sm text-slate-400">Run outcome and unresolved-object accounting from immutable campaign evidence.</p>
        </div>
        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">read only</span>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {campaigns.map((campaign) => {
          const latestRun = findLatestRunForCommand(runs, campaign.key);
          const campaignRecords = cleanupLedger
            .filter((record) => record.campaignKey === campaign.key)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          const runRecords = latestRun
            ? campaignRecords.filter((record) => record.originatingRunId === latestRun.id)
            : campaignRecords.slice(0, 1);
          const unresolvedRecords = runRecords.filter((record) => record.status !== "completed");
          const playwrightReport = latestRun
            ? artifacts.find((artifact) => artifact.runId === latestRun.id && artifact.artifactType === "Playwright Report") ?? null
            : null;
          const video = latestRun
            ? artifacts.find(
                (artifact) =>
                  artifact.runId === latestRun.id &&
                  artifact.artifactType === "Video" &&
                  artifact.filePath.includes("/playwright-report/")
              ) ?? null
            : null;
          const videoHref = playwrightReport && video ? playwrightBundleAssetHref(playwrightReport, video.filePath) : null;
          const cleanupStatus = runRecords[0]?.status ?? latestRun?.cleanup?.status ?? "not recorded";
          const reason = runRecords.find((record) => record.reasonCode)?.reasonCode ?? latestRun?.cleanup?.reasonCode ?? null;
          return (
            <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4" key={campaign.key}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-100">{campaign.displayName}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">{campaign.npmScript}</p>
                </div>
                <StatusBadge status={mutationReadiness(latestRun, runRecords)} />
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <Metadata label="Last result" value={latestRun ? humanizePolicy(latestRun.status) : "not run"} />
                <Metadata label="Cleanup status" value={humanizePolicy(cleanupStatus)} />
                <Metadata
                  label="Created objects"
                  value={runRecords.length ? runRecords.map((record) => record.objectPath).join(", ") : "none recorded"}
                  mono
                />
                <Metadata label="Unresolved age" value={unresolvedAge(unresolvedRecords)} />
                <Metadata label="Known issue" value={reason ?? (latestRun && FAILED_STATUSES.has(latestRun.status) ? "Review failed run evidence" : "none recorded")} />
                <Metadata label="Current readiness" value={humanizePolicy(mutationReadiness(latestRun, runRecords))} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {videoHref ? (
                  <a className="secondary-action" href={videoHref} rel="noreferrer" target="_blank">Open Video</a>
                ) : (
                  <span className="secondary-action cursor-not-allowed opacity-50">Video unavailable</span>
                )}
                {playwrightReport ? (
                  <a className="secondary-action" href={`/api/artifacts/${playwrightReport.id}/bundle/index.html`} rel="noreferrer" target="_blank">
                    Open Evidence
                  </a>
                ) : null}
                {latestRun ? (
                  <button className="secondary-action" onClick={() => onOpenRun(latestRun.id)} type="button">Open Run</button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function mutationReadiness(run: RunRecord | null, records: CleanupLedgerRecord[]) {
  if (!run) return "blocked";
  if (ACTIVE_STATUSES.has(run.status)) return "unstable";
  if (records.some((record) => !record.safelyAccounted || record.status === "pending" || record.status === "failed")) return "blocked";
  if (FAILED_STATUSES.has(run.status)) return "unstable";
  if (records.some((record) => record.status === "deferred" || record.status === "cleanup_unavailable")) {
    return "ready_with_known_issues";
  }
  return PASSED_STATUSES.has(run.status) ? "ready" : "blocked";
}

function unresolvedAge(records: CleanupLedgerRecord[]) {
  if (records.length === 0) return "none";
  const oldest = Math.min(...records.map((record) => new Date(record.createdAt).getTime()));
  const ageMs = Date.now() - oldest;
  if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  const hours = Math.floor(ageMs / 3_600_000);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function playwrightBundleAssetHref(report: ArtifactRecord, filePath: string) {
  const marker = "/playwright-report/";
  const markerIndex = filePath.indexOf(marker);
  if (markerIndex < 0) return null;
  const relativePath = filePath.slice(markerIndex + marker.length).split("/").map(encodeURIComponent).join("/");
  return `/api/artifacts/${report.id}/bundle/${relativePath}`;
}

function ArtifactValidationActionPanel({
  artifactSelection,
  canStartRuns,
  commands,
  currentUserRole,
  onSelect,
  runningCount,
  runs,
  runCampaign,
  selectedArtifact,
  selectedKey
}: {
  artifactSelection: LifecycleArtifactSelection | null;
  canStartRuns: boolean;
  commands: CampaignDefinition[];
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  onSelect: (key: string) => void;
  runningCount: number;
  runs: RunRecord[];
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
  selectedArtifact: LifecycleArtifactOption | null;
  selectedKey: string;
}) {
  const options = buildActionOptions(commands, []);
  const selected = options.find((option) => option.key === selectedKey) ?? options[0] ?? null;
  const campaign = selected?.disabled ? null : selected?.campaign ?? null;
  const latestRun = campaign ? findLatestRunForCommand(runs, campaign.key) : null;
  const disabled =
    !campaign ||
    !canStartRuns ||
    !selectedArtifact ||
    !artifactSelection ||
    !campaign.phase1Enabled ||
    campaign.mutatesStaging ||
    runningCount > 0 ||
    (currentUserRole !== "admin" && campaign.key === "platform_healthcheck");

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ActionSelector options={options} selectedKey={selected?.key ?? ""} onSelect={onSelect} />
      {selected && campaign ? (
        <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">{campaign.displayName}</h3>
              <p className="mt-1 break-words font-mono text-xs text-slate-400">{campaign.npmScript}</p>
            </div>
            <RiskBadge risk={campaign.riskLevel} />
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-400">{campaign.operatorDescription}</p>
          <dl className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
            <Metadata label="Risk level" value={campaign.riskLevel} />
            <Metadata label="Produces reports" value={campaign.producesReports ? "yes" : "no"} />
            <Metadata label="Produces findings" value={campaign.producesFindings ? "yes" : "no"} />
            <Metadata label="Mutates staging" value={campaign.mutatesStaging ? "yes" : "no"} />
            <Metadata label="Cleanup required" value="no" />
            <Metadata label="Estimated duration" value={formatDuration(campaign.timeoutMs)} />
            <Metadata label="Execution status" value={latestRun ? latestRun.status : "not run yet"} />
            <Metadata label="Last run" value={latestRun ? latestRun.id : "none"} mono />
            <Metadata label="Disabled reason" value={selectedArtifact ? "not disabled" : "requires lifecycle artifact selection"} />
          </dl>
          <dl className="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-300 md:grid-cols-2">
            <Metadata label="Selected artifact" value={selectedArtifact?.filePath ?? "required before execution"} mono />
            <Metadata label="Artifact mode" value={artifactSelection?.mode ?? "not selected"} />
            <Metadata label="Artifact type" value={selectedArtifact?.artifactType ?? "not selected"} />
            <Metadata label="Artifact timestamp" value={selectedArtifact ? formatDate(selectedArtifact.timestamp) : "not selected"} />
          </dl>
          <button
            className="mt-5 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            disabled={disabled}
            onClick={() => artifactSelection && void runCampaign(campaign.key, artifactSelection)}
            type="button"
          >
            {canStartRuns ? "Run Validation" : "Viewer role cannot run"}
          </button>
        </article>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
          No artifact validation actions are available.
        </div>
      )}
    </div>
  );
}

function ArtifactValidationCommandCard({
  artifactSelection,
  campaign,
  canStartRuns,
  currentUserRole,
  runningCount,
  runCampaign,
  selectedArtifact
}: {
  artifactSelection: LifecycleArtifactSelection | null;
  campaign: CampaignDefinition;
  canStartRuns: boolean;
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  runningCount: number;
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
  selectedArtifact: LifecycleArtifactOption | null;
}) {
  const disabled =
    !canStartRuns ||
    !selectedArtifact ||
    !artifactSelection ||
    !campaign.phase1Enabled ||
    campaign.mutatesStaging ||
    runningCount > 0 ||
    (currentUserRole !== "admin" && campaign.key === "platform_healthcheck");

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{campaign.displayName}</h3>
          <p className="mt-1 font-mono text-xs text-slate-400">{campaign.npmScript}</p>
        </div>
        <RiskBadge risk={campaign.riskLevel} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-400">{campaign.operatorDescription}</p>
      <dl className="mt-4 grid gap-2 text-sm text-slate-300">
        <Metadata label="Consumes artifact" value={selectedArtifact?.filePath ?? "required before execution"} mono />
        <Metadata label="Mode" value={artifactSelection ? artifactSelection.mode : "not selected"} />
        <Metadata label="Mutates staging" value={campaign.mutatesStaging ? "yes" : "no"} />
      </dl>
      <button
        className="mt-5 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        disabled={disabled}
        onClick={() => artifactSelection && void runCampaign(campaign.key, artifactSelection)}
        type="button"
      >
        {canStartRuns ? "Run Validation" : "Viewer role cannot run"}
      </button>
    </article>
  );
}

function DisabledCommandCardView({ command }: { command: DisabledCommandCard }) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 opacity-90">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-200">{command.label}</h3>
          <p className="mt-1 font-mono text-xs text-slate-500">{command.npmScript}</p>
        </div>
        <RiskBadge risk={command.riskLevel} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-400">{command.description}</p>
      <p className="mt-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-300">{command.reason}</p>
      <button
        className="mt-5 cursor-not-allowed rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-500"
        disabled
        type="button"
      >
        Disabled
      </button>
    </article>
  );
}

function Metadata({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className={`mt-1 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function MetadataCard({ label, tone = "neutral", value }: { label: string; tone?: "active" | "fail" | "neutral" | "pass" | "warn"; value: string }) {
  const toneClass =
    tone === "pass"
      ? "text-emerald-100"
      : tone === "warn"
        ? "text-amber-100"
        : tone === "fail"
          ? "text-rose-100"
          : tone === "active"
            ? "text-cyan-100"
            : "text-slate-100";
  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className={`mt-3 break-words text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  return <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs uppercase tracking-[0.16em] text-slate-300">{risk}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const className = ACTIVE_STATUSES.has(status)
    ? "bg-cyan-300/15 text-cyan-200 ring-cyan-300/20"
    : PASSED_STATUSES.has(status)
      ? "bg-emerald-300/15 text-emerald-200 ring-emerald-300/20"
      : FAILED_STATUSES.has(status)
        ? "bg-rose-300/15 text-rose-200 ring-rose-300/20"
        : "bg-slate-700 text-slate-300 ring-slate-600";

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ring-1 ${className}`}>{status}</span>;
}

function AuthenticationCheckCard({ label, result }: { label: string; result?: AuthenticationMonitoringCheck }) {
  const passed = result?.status === "passed";
  const warning = result && ["blocked_external", "disabled", "missing_configuration"].includes(result.status);
  const statusLabel = result?.status === "blocked_external"
    ? "BLOCKED - PROVIDER"
    : result?.status === "missing_configuration"
      ? "MISSING CONFIGURATION"
      : result?.status === "disabled"
        ? "NOT CERTIFIED / DISABLED"
        : result?.status.replaceAll("_", " ").toUpperCase() ?? "NO DATA";
  return (
    <article
      className={`rounded-2xl border p-4 ${
        passed
          ? "border-emerald-300/20 bg-emerald-300/5"
          : warning
            ? "border-amber-300/20 bg-amber-300/5"
            : "border-rose-300/20 bg-rose-300/5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-slate-100">{label}</h3>
        <span className={`report-chip ${passed ? "" : "report-chip-warn"}`}>{statusLabel}</span>
      </div>
      <p className="mt-3 text-sm text-slate-400">Timing: {result ? formatDuration(result.durationMs) : "not recorded"}</p>
      {result?.error ? (
        <p className={`mt-2 break-words text-xs leading-5 ${warning ? "text-amber-200" : "text-rose-200"}`}>{result.error}</p>
      ) : null}
    </article>
  );
}

function EvidenceWorkspace({
  bundleSearch,
  bundleSort,
  bundleTypeFilter,
  bundleTypes,
  canStartRuns,
  evidenceArtifacts,
  evidenceBundles,
  evidenceItems,
  reportCategory,
  reportCategoryCounts,
  reportRenderCommands,
  reports,
  runCampaign,
  runs,
  selectedArtifact,
  selectedBundle,
  selectedItem,
  selectedReport,
  selectedRun,
  setBundleSearch,
  setBundleSort,
  setBundleTypeFilter,
  setReportCategory,
  setSelectedBundleId,
  setSelectedItemId,
  setSelectedReportId
}: {
  bundleSearch: string;
  bundleSort: EvidenceSortMode;
  bundleTypeFilter: string;
  bundleTypes: string[];
  canStartRuns: boolean;
  evidenceArtifacts: ArtifactRecord[];
  evidenceBundles: EvidenceBundleRecord[];
  evidenceItems: EvidenceItemRecord[];
  reportCategory: ReportCategory;
  reportCategoryCounts: Record<ReportCategory, number>;
  reportRenderCommands: CampaignDefinition[];
  reports: ArtifactRecord[];
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection, liveApproval?: LiveApprovalPayload) => Promise<boolean>;
  runs: RunRecord[];
  selectedArtifact: ArtifactRecord | null;
  selectedBundle: EvidenceBundleRecord | null;
  selectedItem: EvidenceItemRecord | null;
  selectedReport: ArtifactRecord | null;
  selectedRun: RunRecord | null;
  setBundleSearch: (value: string) => void;
  setBundleSort: (value: EvidenceSortMode) => void;
  setBundleTypeFilter: (value: string) => void;
  setReportCategory: (value: ReportCategory) => void;
  setSelectedBundleId: (value: string) => void;
  setSelectedItemId: (value: string) => void;
  setSelectedReportId: (value: string) => void;
}) {
  const selectedReportHref = selectedReport ? `/api/artifacts/${selectedReport.id}/file` : null;
  const selectedItemHref = selectedItem ? evidenceItemHref(selectedItem, selectedArtifact, evidenceArtifacts) : null;
  const playableEvidence = evidenceItems.filter((item) => isPreviewableEvidenceItem(item, evidenceArtifacts));
  const reportArtifactsForRun = evidenceArtifacts.filter((artifact) => REPORT_ARCHIVE_ARTIFACT_TYPES.has(artifact.artifactType));
  const siemArtifact = evidenceArtifacts.find((artifact) => artifact.artifactType === "SIEM Export") ?? null;

  return (
    <section className="evidence-workspace">
      <aside className="evidence-explorer-pane">
        <div className="flex items-start justify-between gap-3">
          <SectionHeader title="Evidence Explorer" subtitle="Group evidence by campaign, run, bundle, date, environment, status, and type." />
          <span className="report-chip">{evidenceBundles.length} bundles</span>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Search</span>
            <input
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
              onChange={(event) => setBundleSearch(event.target.value)}
              placeholder="Campaign, run, status, storage..."
              type="search"
              value={bundleSearch}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Sort</span>
              <select
                className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                onChange={(event) => setBundleSort(event.target.value as EvidenceSortMode)}
                value={bundleSort}
              >
                <option value="date">Newest</option>
                <option value="campaign">Campaign</option>
                <option value="run">Run</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Bundle Type</span>
              <select
                className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                onChange={(event) => setBundleTypeFilter(event.target.value)}
                value={bundleTypeFilter}
              >
                {bundleTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="evidence-explorer-list">
          {evidenceBundles.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
              No Evidence Bundles are currently indexed. Run a safe campaign or select a historical run with evidence metadata.
            </div>
          ) : (
            evidenceBundles.map((bundle) => {
              const run = runs.find((candidate) => candidate.id === bundle.runId);
              const selected = selectedBundle?.id === bundle.id;
              return (
                <button
                  className={`evidence-bundle-card ${selected ? "evidence-bundle-card-active" : ""}`}
                  key={bundle.id}
                  onClick={() => {
                    setSelectedBundleId(bundle.id);
                    setSelectedItemId("");
                  }}
                  type="button"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{bundle.title}</span>
                      <span className="mt-1 block break-words font-mono text-xs text-slate-500">{bundle.campaignKey}</span>
                    </span>
                    <EvidenceHealthBadge bundle={bundle} items={[]} />
                  </span>
                  <span className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <span>{bundle.bundleType}</span>
                    <span>{bundle.environment}</span>
                    <span>{bundle.itemCount} items</span>
                    <span>{formatBytes(bundle.totalBytes)}</span>
                  </span>
                  <span className="mt-3 block truncate font-mono text-xs text-slate-600">{run?.id ?? bundle.runId}</span>
                  <span className="mt-1 block text-xs text-slate-500">{formatDate(bundle.createdAt)}</span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="evidence-detail-pane">
        {selectedBundle ? (
          <>
            <div className="evidence-hero">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/80">Evidence Bundle</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h2 className="min-w-0 break-words text-2xl font-semibold tracking-[-0.04em]">{selectedBundle.title}</h2>
                  <EvidenceHealthBadge bundle={selectedBundle} items={evidenceItems} />
                  <span className="report-chip">{selectedBundle.bundleType}</span>
                </div>
                <p className="mt-2 break-words font-mono text-xs text-slate-500">{selectedBundle.id}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                <MetadataCard label="Campaign" value={selectedBundle.campaignKey} />
                <MetadataCard label="Run" value={selectedBundle.runId.slice(0, 18)} />
                <MetadataCard label="Evidence Count" value={String(evidenceItems.length)} />
                <MetadataCard label="Bundle Size" value={formatBytes(selectedBundle.totalBytes)} />
                <MetadataCard label="Storage Backend" value={selectedBundle.storageBackend} />
                <MetadataCard label="Upload Status" value={selectedBundle.uploadStatus} />
                <MetadataCard label="Retention" value={selectedBundle.retentionClass} />
                <MetadataCard label="Integrity" value={evidenceIntegrityLabel(selectedBundle, evidenceItems)} />
              </div>
            </div>

            <div className="evidence-chain">
              {[
                { label: "Campaign", value: selectedBundle.campaignKey },
                { label: "Run", value: selectedRun?.status ?? selectedBundle.runId },
                { label: "Evidence Bundle", value: selectedBundle.bundleType },
                { label: "Evidence Items", value: `${evidenceItems.length} indexed` },
                { label: "Reports", value: `${reportArtifactsForRun.length} reports` },
                { label: "SIEM Export", value: siemArtifact ? "available" : "not generated" }
              ].map((step, index) => (
                <div className="evidence-chain-step" key={step.label}>
                  <span className="evidence-chain-index">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-xs uppercase tracking-[0.18em] text-slate-500">{step.label}</span>
                    <span className="mt-1 block truncate text-sm font-semibold text-slate-200">{step.value}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="evidence-main-grid">
              <div className="space-y-4">
                <section className="evidence-panel">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <SectionHeader title="Evidence Items" subtitle="Every indexed item in the selected bundle." />
                    <span className="text-xs text-slate-500">{playableEvidence.length} preview-capable</span>
                  </div>
                  <div className="evidence-item-list">
                    {evidenceItems.length === 0 ? (
                      <p className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
                        This bundle has no item metadata.
                      </p>
                    ) : (
                      evidenceItems.map((item) => {
                        const selected = selectedItem?.id === item.id;
                        const href = evidenceItemHref(item, evidenceArtifacts.find((artifact) => artifact.id === item.artifactId) ?? null, evidenceArtifacts);
                        return (
                          <button
                            className={`evidence-item-card ${selected ? "evidence-item-card-active" : ""}`}
                            key={item.id}
                            onClick={() => setSelectedItemId(item.id)}
                            type="button"
                          >
                            <span className="report-file-icon" aria-hidden="true">{evidenceIcon(item)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{item.itemType}</span>
                                <span className="report-chip">{evidenceFormatLabel(item)}</span>
                                {href ? <span className="report-chip report-chip-blue">preview</span> : null}
                              </span>
                              <span className="mt-1 block break-words font-mono text-xs text-slate-500">{item.relativePath}</span>
                              <span className="mt-2 block text-xs text-slate-400">
                                {formatBytes(item.sizeBytes)} · {item.storageBackend} · {item.uploadStatus}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className="evidence-panel">
                  <SectionHeader title="Evidence Preview" subtitle="Preview supported evidence inline without changing storage or report generation." />
                  <EvidencePreview item={selectedItem} artifact={selectedArtifact} artifacts={evidenceArtifacts} />
                </section>
              </div>

              <aside className="space-y-4">
                <section className="evidence-panel">
                  <SectionHeader title="Bundle Details" subtitle="Storage, integrity, retention, and lifecycle metadata." />
                  <dl className="mt-4 space-y-3 text-sm text-slate-300">
                    <Metadata label="Status" value={selectedBundle.status} />
                    <Metadata label="Storage Prefix" value={selectedBundle.storagePrefix ?? "local filesystem"} mono />
                    <Metadata label="Uploaded At" value={selectedBundle.uploadedAt ? formatDate(selectedBundle.uploadedAt) : "not uploaded"} />
                    <Metadata label="SHA Manifest" value={`${Object.keys(selectedBundle.checksumManifest ?? {}).length} checksums`} />
                    <Metadata label="Sensitive" value={selectedBundle.sensitive ? "yes" : "no"} />
                    <Metadata label="Source Artifact" value={selectedBundle.sourceArtifactId ?? "none"} mono />
                  </dl>
                  {selectedBundle.uploadError ? (
                    <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-100">
                      {selectedBundle.uploadError}
                    </p>
                  ) : null}
                </section>

                <section className="evidence-panel">
                  <SectionHeader title="Selected Item Integrity" subtitle="Per-item hash, storage key, and preview status." />
                  {selectedItem ? (
                    <dl className="mt-4 space-y-3 text-sm text-slate-300">
                      <Metadata label="SHA256" value={selectedItem.sha256} mono />
                      <Metadata label="Storage Key" value={selectedItem.storageKey} mono />
                      <Metadata label="Content Type" value={selectedItem.contentType} />
                      <Metadata label="Render Inline" value={selectedItem.renderInline ? "yes" : "no"} />
                      <Metadata label="Sensitive" value={selectedItem.sensitive ? "yes" : "no"} />
                      <Metadata label="Health" value={selectedItem.uploadStatus === "failed" ? "upload failed" : "verified metadata"} />
                    </dl>
                  ) : (
                    <p className="mt-4 text-sm text-slate-400">Select an evidence item to inspect integrity details.</p>
                  )}
                </section>

                <section className="evidence-panel">
                  <SectionHeader title="Related Evidence" subtitle="Reports, artifacts, SIEM export, and source run links." />
                  <div className="mt-4 space-y-3">
                    {selectedRun ? (
                      <RelatedEvidenceRow label="Related Run" value={selectedRun.id} meta={selectedRun.status} />
                    ) : null}
                    {reportArtifactsForRun.map((artifact) => (
                      <RelatedEvidenceRow
                        href={canOpenArtifact(artifact) ? `/api/artifacts/${artifact.id}/file` : undefined}
                        key={artifact.id}
                        label={artifact.artifactType}
                        meta={formatBytes(artifact.fileSize)}
                        value={artifact.filePath}
                      />
                    ))}
                    {reportArtifactsForRun.length === 0 ? (
                      <p className="text-sm text-slate-400">No report artifacts are linked to this bundle yet.</p>
                    ) : null}
                  </div>
                </section>

                <section className="evidence-panel">
                  <SectionHeader title="Report Archive" subtitle="Derived report views remain available as evidence views." />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(["Playwright", "Security", "Lifecycle", "SIEM"] as ReportCategory[]).map((category) => (
                      <button
                        className={`rounded-full px-3 py-1.5 text-xs transition ${
                          reportCategory === category
                            ? "bg-cyan-300 text-slate-950"
                            : "bg-slate-950 text-slate-300 ring-1 ring-slate-800 hover:ring-cyan-300/40"
                        }`}
                        key={category}
                        onClick={() => {
                          setReportCategory(category);
                          setSelectedReportId("");
                        }}
                        type="button"
                      >
                        {category} ({reportCategoryCounts[category]})
                      </button>
                    ))}
                  </div>
                  <div className="evidence-report-list">
                    {reports.length === 0 ? (
                      <p className="text-sm text-slate-400">No {reportCategory.toLowerCase()} reports indexed.</p>
                    ) : (
                      reports.map((report) => (
                        <button
                          className={`report-list-item ${selectedReport?.id === report.id ? "report-list-item-active" : ""}`}
                          key={report.id}
                          onClick={() => setSelectedReportId(report.id)}
                          type="button"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{reportTitle(report)}</span>
                            <span className="mt-1 block break-words font-mono text-xs text-slate-500">{report.filePath}</span>
                          </span>
                          <span className="text-xs text-slate-400">{formatBytes(report.fileSize)}</span>
                        </button>
                      ))
                    )}
                  </div>
                  {selectedReport && selectedReportHref ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <a className="primary-action" href={selectedReportHref} rel="noreferrer" target="_blank">
                        Open Report ↗
                      </a>
                      {selectedReport.artifactType === "SIEM Export" ? (
                        <a className="secondary-action" download href={selectedReportHref}>
                          Download SIEM JSON
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="evidence-panel">
                  <SectionHeader title="Report Tools" subtitle="Re-render existing evidence views without executing tests." />
                  <div className="mt-4 space-y-3">
                    {reportRenderCommands.map((campaign) => (
                      <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3" key={campaign.key}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h5 className="font-medium">{campaign.displayName}</h5>
                            <p className="mt-1 font-mono text-xs text-slate-500">{campaign.npmScript}</p>
                          </div>
                          <RiskBadge risk={campaign.riskLevel} />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-400">{campaign.operatorDescription}</p>
                        <button
                          className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                          disabled={!canStartRuns}
                          onClick={() => void runCampaign(campaign.key)}
                          type="button"
                        >
                          {canStartRuns ? "Re-render Report" : "Viewer role cannot run"}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          </>
        ) : (
          <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-8 text-center">
            <p className="text-lg font-semibold">No Evidence Bundle Selected</p>
            <p className="mt-2 text-sm text-slate-400">
              Evidence bundles appear after runs index artifacts. Reports remain accessible when report artifacts exist.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}

function EvidencePreview({
  artifact,
  artifacts,
  item
}: {
  artifact: ArtifactRecord | null;
  artifacts: ArtifactRecord[];
  item: EvidenceItemRecord | null;
}) {
  if (!item) {
    return (
      <div className="evidence-preview-empty">
        Select an evidence item to preview HTML, JSON, Markdown, image, video, or text evidence.
      </div>
    );
  }

  const href = evidenceItemHref(item, artifact, artifacts);
  const kind = evidencePreviewKind(item);
  if (!href) {
    return (
      <div className="evidence-preview-empty">
        <p className="font-semibold text-slate-200">{item.itemType}</p>
        <p className="mt-2 break-words font-mono text-xs">{item.relativePath}</p>
        <p className="mt-4">
          This item is indexed as evidence but is not previewable through current serving rules. Sensitive screenshots,
          traces, and videos remain protected unless they are part of the authenticated Playwright bundle.
        </p>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="evidence-preview-frame">
        <img alt={item.fileName} className="max-h-[36rem] w-full object-contain" src={href} />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="evidence-preview-frame">
        <video className="max-h-[36rem] w-full" controls src={href}>
          <track kind="captions" />
        </video>
      </div>
    );
  }

  if (kind === "download") {
    return (
      <div className="evidence-preview-empty">
        <p className="font-semibold text-slate-200">{item.itemType}</p>
        <p className="mt-2 break-words font-mono text-xs">{item.relativePath}</p>
        <a className="primary-action mt-5" download href={href}>
          Download Evidence
        </a>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <span className="font-semibold">{item.itemType} Preview</span>
        <a className="text-xs font-semibold text-cyan-200 hover:text-cyan-100" href={href} rel="noreferrer" target="_blank">
          Open in New Tab ↗
        </a>
      </div>
      <iframe className="h-[36rem] w-full bg-white" src={href} title={`${item.itemType} preview`} />
    </div>
  );
}

function EvidenceHealthBadge({ bundle, items }: { bundle: EvidenceBundleRecord; items: EvidenceItemRecord[] }) {
  const failed = bundle.uploadStatus === "failed" || items.some((item) => item.uploadStatus === "failed");
  const uploaded = bundle.uploadStatus === "uploaded";
  const label = failed ? "attention" : uploaded ? "verified" : "local";
  const className = failed
    ? "bg-rose-300/15 text-rose-200 ring-rose-300/20"
    : uploaded
      ? "bg-emerald-300/15 text-emerald-200 ring-emerald-300/20"
      : "bg-slate-800 text-slate-300 ring-slate-700";

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${className}`}>{label}</span>;
}

function RelatedEvidenceRow({
  href,
  label,
  meta,
  value
}: {
  href?: string;
  label: string;
  meta: string;
  value: string;
}) {
  const content = (
    <>
      <span className="block text-xs uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <span className="mt-1 block break-words font-mono text-xs text-slate-300">{value}</span>
      <span className="mt-2 block text-xs text-slate-500">{meta}</span>
    </>
  );

  return href ? (
    <a className="block rounded-xl border border-slate-800 bg-slate-900/70 p-3 transition hover:border-cyan-300/40" href={href} rel="noreferrer" target="_blank">
      {content}
    </a>
  ) : (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">{content}</div>
  );
}

function evidenceIntegrityLabel(bundle: EvidenceBundleRecord, items: EvidenceItemRecord[]) {
  if (bundle.uploadStatus === "failed" || items.some((item) => item.uploadStatus === "failed")) return "needs review";
  if (bundle.uploadStatus === "uploaded" && items.every((item) => item.uploadStatus === "uploaded")) return "verified";
  if (Object.keys(bundle.checksumManifest ?? {}).length > 0) return "checksummed";
  return "metadata only";
}

function evidenceItemHref(item: EvidenceItemRecord, artifact: ArtifactRecord | null, artifacts: ArtifactRecord[]) {
  if (item.relativePath.startsWith("playwright-report/")) {
    const relativePath = item.relativePath.replace(/^playwright-report\/?/, "") || "index.html";
    return `/api/artifacts/${item.artifactId}/bundle/${relativePath}`;
  }

  if (artifact && canOpenArtifact(artifact)) {
    return `/api/artifacts/${artifact.id}/file`;
  }

  if (!item.sensitive && item.renderInline && item.artifactId) {
    return `/api/artifacts/${item.artifactId}/file`;
  }

  return null;
}

function evidencePreviewKind(item: EvidenceItemRecord) {
  if (item.contentType.startsWith("image/")) return "image";
  if (item.contentType.startsWith("video/")) return "video";
  if (item.contentType.includes("zip")) return "download";
  return "frame";
}

function isPreviewableEvidenceItem(item: EvidenceItemRecord, artifacts: ArtifactRecord[]) {
  return Boolean(evidenceItemHref(item, artifacts.find((artifact) => artifact.id === item.artifactId) ?? null, artifacts));
}

function evidenceIcon(item: EvidenceItemRecord) {
  if (item.contentType.startsWith("image/")) return "▧";
  if (item.contentType.startsWith("video/")) return "▶";
  if (item.contentType.includes("json")) return "{}";
  if (item.contentType.includes("html")) return "HTML";
  if (item.contentType.includes("markdown")) return "MD";
  if (item.contentType.includes("zip")) return "ZIP";
  return "▤";
}

function evidenceFormatLabel(item: EvidenceItemRecord) {
  if (item.contentType.includes("json")) return "JSON";
  if (item.contentType.includes("html")) return "HTML";
  if (item.contentType.startsWith("image/")) return "Image";
  if (item.contentType.startsWith("video/")) return "Video";
  if (item.contentType.includes("markdown")) return "Markdown";
  if (item.contentType.includes("zip")) return "Trace";
  return "File";
}

function evidenceItemWeight(item: EvidenceItemRecord) {
  if (item.itemType === "Playwright Report") return 0;
  if (item.contentType.includes("html")) return 1;
  if (item.contentType.includes("json")) return 2;
  if (item.contentType.startsWith("image/")) return 3;
  if (item.contentType.startsWith("video/")) return 4;
  if (item.contentType.includes("zip")) return 5;
  return 6;
}

type ExecutionStageStatus = "current" | "done" | "failed" | "pending";

type ExecutionStage = {
  description: string;
  label: string;
  status: ExecutionStageStatus;
  timestamp: string | null;
};

type ExpectedOutput = {
  available: boolean;
  detail: string;
  download?: boolean;
  href: string | null;
  label: string;
};

type AwarenessItem = {
  label: string;
  value: string;
};

function buildExecutionStages(
  run: RunRecord | null,
  logs: RunLogRecord[],
  artifacts: ArtifactRecord[],
  campaign: CampaignDefinition | null
): ExecutionStage[] {
  const firstLog = logs[0] ?? null;
  const firstArtifact = artifacts[0] ?? null;
  const reportArtifact = artifacts.find((artifact) => REPORT_ARCHIVE_ARTIFACT_TYPES.has(artifact.artifactType)) ?? null;
  const isTerminal = run ? PASSED_STATUSES.has(run.status) || FAILED_STATUSES.has(run.status) : false;
  const isFailed = run ? FAILED_STATUSES.has(run.status) : false;
  const activeIndex = inferActiveStageIndex(run, logs, artifacts, campaign);
  const definitions = [
    {
      description: "Runner accepted the run request.",
      label: "Runner Initialized",
      timestamp: run?.createdAt ?? null
    },
    {
      description: "Dashboard and command environment are being validated.",
      label: "Environment Validation",
      timestamp: run?.startedAt ?? null
    },
    {
      description: "The registered npm command is being launched.",
      label: "Launch Playwright",
      timestamp: firstLog?.createdAt ?? run?.startedAt ?? null
    },
    {
      description: "Campaign command is executing and streaming logs.",
      label: executionLabelForCampaign(campaign),
      timestamp: firstLog?.createdAt ?? null
    },
    {
      description: "Generated files are being indexed into run metadata.",
      label: "Collecting Artifacts",
      timestamp: firstArtifact?.createdAt ?? null
    },
    {
      description: "Report artifacts are becoming available for review.",
      label: "Generating Reports",
      timestamp: reportArtifact?.createdAt ?? null
    },
    {
      description: "Metadata-only SIEM output is prepared when available.",
      label: "Preparing SIEM Export",
      timestamp: artifacts.find((artifact) => artifact.artifactType === "SIEM Export")?.createdAt ?? null
    },
    {
      description: "The run has reached a terminal state.",
      label: "Finished",
      timestamp: run?.completedAt ?? null
    }
  ];

  return definitions.map((definition, index) => {
    let status: ExecutionStageStatus = "pending";
    if (run) {
      if (isTerminal && index === definitions.length - 1) {
        status = isFailed ? "failed" : "done";
      } else if (isTerminal || index < activeIndex) {
        status = "done";
      } else if (index === activeIndex) {
        status = isFailed ? "failed" : "current";
      }
    }

    return {
      ...definition,
      status
    };
  });
}

function inferActiveStageIndex(
  run: RunRecord | null,
  logs: RunLogRecord[],
  artifacts: ArtifactRecord[],
  campaign: CampaignDefinition | null
) {
  if (!run) return 0;
  if (PASSED_STATUSES.has(run.status) || FAILED_STATUSES.has(run.status)) return 7;
  if (run.status === "indexing_artifacts") return 4;
  if (artifacts.some((artifact) => artifact.artifactType === "SIEM Export")) return 6;
  if (artifacts.some((artifact) => REPORT_ARCHIVE_ARTIFACT_TYPES.has(artifact.artifactType))) return 5;
  if (artifacts.length > 0) return 4;
  if (logs.length > 0) return 3;
  if (campaign?.npmScript.includes("playwright") || run.status === "running") return 2;
  if (run.startedAt) return 1;
  return 0;
}

function executionLabelForCampaign(campaign: CampaignDefinition | null) {
  if (!campaign) return "Executing Campaign";
  if (campaign.commandType === "artifact_validation") return "Executing Artifact Validation";
  if (campaign.key.includes("security")) return "OWASP Validation";
  if (campaign.key.includes("siem")) return "Preparing Metadata Export";
  if (campaign.commandType === "healthcheck") return "Executing Healthcheck";
  if (campaign.mutatesStaging) return "Executing Lifecycle";
  return "Executing Campaign";
}

function buildExpectedOutputs(campaign: CampaignDefinition | null, artifacts: ArtifactRecord[]): ExpectedOutput[] {
  const artifactCount = artifacts.length;
  const playwrightReport = artifacts.find((artifact) => artifact.artifactType === "Playwright Report");
  const securityReport = artifacts.find((artifact) => artifact.artifactType === "Security Report");
  const lifecycleReport = artifacts.find((artifact) => artifact.artifactType === "Lifecycle Report");
  const siemExport = artifacts.find((artifact) => artifact.artifactType === "SIEM Export");
  const outputList: ExpectedOutput[] = [
    {
      available: artifactCount > 0,
      detail: artifactCount > 0 ? `${artifactCount} artifact${artifactCount === 1 ? "" : "s"} indexed` : "Waiting for artifact indexing",
      href: null,
      label: "Artifacts"
    },
    {
      available: Boolean(playwrightReport),
      detail: playwrightReport?.filePath ?? "Playwright HTML report has not been indexed yet",
      href: playwrightReport ? `/api/artifacts/${playwrightReport.id}/file` : null,
      label: "Playwright Report"
    },
    {
      available: Boolean(securityReport),
      detail: securityReport?.filePath ?? outputPlaceholderForCampaign(campaign, "Security Report"),
      href: securityReport ? `/api/artifacts/${securityReport.id}/file` : null,
      label: "Security Report"
    },
    {
      available: Boolean(lifecycleReport),
      detail: lifecycleReport?.filePath ?? outputPlaceholderForCampaign(campaign, "Lifecycle Report"),
      href: lifecycleReport ? `/api/artifacts/${lifecycleReport.id}/file` : null,
      label: "Lifecycle Report"
    },
    {
      available: Boolean(siemExport),
      detail: siemExport?.filePath ?? outputPlaceholderForCampaign(campaign, "SIEM Export"),
      download: true,
      href: siemExport ? `/api/artifacts/${siemExport.id}/file` : null,
      label: "SIEM Export"
    }
  ];

  return outputList;
}

function outputPlaceholderForCampaign(campaign: CampaignDefinition | null, label: string) {
  if (!campaign) return `${label} is not available for this run yet`;
  if (label === "Security Report" && !campaign.key.includes("security")) return "Generated only when security evidence exists";
  if (label === "Lifecycle Report" && !campaign.key.includes("lifecycle") && !campaign.mutatesStaging) {
    return "Generated only when lifecycle evidence exists";
  }
  if (label === "SIEM Export" && !campaign.key.includes("siem")) return "Generated by SIEM export commands";
  return `${label} has not been indexed yet`;
}

function describeCampaignAwareness(
  campaign: CampaignDefinition | null,
  selectedArtifact: LifecycleArtifactOption | null
): AwarenessItem[] {
  if (!campaign) {
    return [
      { label: "Campaign Type", value: "unknown" },
      { label: "Execution Model", value: "metadata unavailable" },
      { label: "Risk", value: "unknown" }
    ];
  }

  if (campaign.commandType === "artifact_validation") {
    return [
      { label: "Mode", value: "Artifact Validation" },
      { label: "Selected Artifact", value: selectedArtifact?.filePath ?? "latest or explicit artifact at run time" },
      { label: "Discovery Status", value: "Consumes existing evidence only" }
    ];
  }

  if (campaign.key.includes("security")) {
    return [
      { label: "Mode", value: "Security Campaign" },
      { label: "Validation", value: "OWASP/access-control focused" },
      { label: "Expected Evidence", value: "Security findings and reports" }
    ];
  }

  if (campaign.mutatesStaging) {
    return [
      { label: "Mode", value: "Lifecycle" },
      { label: "Live Mutation", value: "Creates staging data" },
      { label: "Cleanup", value: "Manual cleanup required" }
    ];
  }

  if (campaign.commandType === "export") {
    return [
      { label: "Mode", value: "SIEM Export" },
      { label: "Transmission", value: "Metadata-only export; no send from this command" },
      { label: "Expected Evidence", value: "Wazuh-compatible JSON" }
    ];
  }

  if (campaign.commandType === "healthcheck") {
    return [
      { label: "Mode", value: "Operations" },
      { label: "Validation", value: "Dashboard/runtime prerequisites" },
      { label: "Risk", value: campaign.riskLevel }
    ];
  }

  return [
    { label: "Mode", value: "Safe Suite" },
    { label: "Validation", value: "Playwright regression checks" },
    { label: "Mutates Staging", value: campaign.mutatesStaging ? "yes" : "no" }
  ];
}

function getRunElapsedMs(run: RunRecord | null) {
  if (!run) return null;
  const start = new Date(run.startedAt ?? run.createdAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function completionLabelForRun(run: RunRecord) {
  if (run.status === "passed_with_warnings") return "Passed with Findings";
  if (PASSED_STATUSES.has(run.status)) return "Completed";
  if (FAILED_STATUSES.has(run.status)) return "Failed";
  if (ACTIVE_STATUSES.has(run.status)) return "Running";
  return run.status;
}

function completionSummaryForRun(run: RunRecord) {
  if (run.status === "passed_with_warnings") {
    return "Run completed with warnings or findings. Review generated reports and artifacts before closing the investigation.";
  }
  if (PASSED_STATUSES.has(run.status)) {
    return "Run completed successfully. Review generated reports and artifacts for evidence.";
  }
  if (FAILED_STATUSES.has(run.status)) {
    return "Run failed. Review the timeline and live console before rerunning.";
  }
  return "Run is still active. Outputs will populate as artifacts are indexed.";
}

function stageIcon(status: ExecutionStageStatus) {
  if (status === "done") return "✓";
  if (status === "current") return "▶";
  if (status === "failed") return "!";
  return "○";
}

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function monitoringDefinitionStatus(definition: MonitoringDefinition) {
  if (!definition.enabled) return "Disabled";
  if (definition.triggerType === "schedule" && !definition.schedule) return "Incomplete";
  return "Defined";
}

function formatMonitoringPolicySummary(definition: MonitoringDefinition) {
  const retry = definition.retryPolicy.maxAttempts === 1
    ? "1 attempt"
    : `${definition.retryPolicy.maxAttempts} attempts`;
  return `${humanizePolicy(definition.runPolicy)} · ${retry} · ${formatDuration(definition.timeout)}`;
}

function humanizePolicy(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return "unknown";
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function initialsForUser(value: string) {
  const [first = "I", second = "Q"] = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

async function readJsonResponse(response: Response): Promise<{ error?: string }> {
  try {
    const body = await response.json();
    return typeof body === "object" && body !== null ? body as { error?: string } : {};
  } catch {
    return {};
  }
}

function formatDuration(value: number | null) {
  if (value === null) return "pending";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCommandType(value: CampaignDefinition["commandType"]) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function actionLabelForCommand(command: CampaignDefinition) {
  if (command.commandType === "export") return "Generate Export";
  if (command.commandType === "healthcheck") return "Run Healthcheck";
  if (command.commandType === "artifact_validation") return "Run Validation";
  return "Run Campaign";
}

function isLatestReportAlias(artifact: ArtifactRecord) {
  return artifact.filePath.includes("/latest-") || /(^|\/)latest-[^/]+$/.test(artifact.filePath);
}

function reportTitle(artifact: ArtifactRecord) {
  if (artifact.artifactType === "Security Report") {
    return isLatestReportAlias(artifact) ? "Latest Security Summary" : "Security Campaign Report";
  }
  if (artifact.artifactType === "Lifecycle Report") {
    return isLatestReportAlias(artifact) ? "Latest Lifecycle Summary" : "Lifecycle Campaign Report";
  }
  if (artifact.artifactType === "Playwright Report") {
    return "Playwright HTML Report";
  }
  if (artifact.artifactType === "SIEM Export") {
    return isLatestReportAlias(artifact) ? "Latest SIEM Export" : "SIEM Export";
  }

  return artifact.artifactType;
}

function resolveReportSource(artifact: ArtifactRecord, reports: ArtifactRecord[]) {
  const directMatch = artifact.filePath.match(/(?:security|lifecycle)-campaign-(.+)\.html$/);
  if (directMatch?.[1]) return directMatch[1];

  const sibling = reports.find(
    (candidate) =>
      candidate.runId === artifact.runId &&
      candidate.id !== artifact.id &&
      candidate.artifactType === artifact.artifactType &&
      /(?:security|lifecycle)-campaign-(.+)\.html$/.test(candidate.filePath)
  );
  const siblingMatch = sibling?.filePath.match(/(?:security|lifecycle)-campaign-(.+)\.html$/);
  return siblingMatch?.[1] ?? null;
}

function canOpenArtifact(artifact: ArtifactRecord) {
  return (
    !artifact.sensitive &&
    ["Lifecycle Report", "Playwright Report", "Security Report", "SIEM Export"].includes(artifact.artifactType)
  );
}

function buildManagedCampaigns(campaigns: CampaignDefinition[]): ManagedCampaign[] {
  const registryCampaigns = campaigns.map((campaign) => managedCampaignFromRegistry(campaign));
  const disabledCampaigns = [
    ...DISABLED_LIFECYCLE_COMMANDS.map((command) => managedCampaignFromDisabled(command, "Lifecycle")),
    ...DISABLED_SECURITY_COMMANDS.map((command) => managedCampaignFromDisabled(command, "Security")),
    ...DISABLED_SIEM_COMMANDS.map((command) => managedCampaignFromDisabled(command, "SIEM"))
  ];

  return [...registryCampaigns, ...disabledCampaigns].sort((left, right) => {
    const categoryCompare = CAMPAIGN_CATEGORIES.indexOf(left.category) - CAMPAIGN_CATEGORIES.indexOf(right.category);
    if (categoryCompare !== 0) return categoryCompare;
    if (left.executionEnabled !== right.executionEnabled) return left.executionEnabled ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function managedCampaignFromRegistry(campaign: CampaignDefinition): ManagedCampaign {
  const category = categoryForCommand(campaign);
  const evidenceProduced = evidenceProducedForCommand(campaign);
  const produces = producesForCommand(campaign);

  return {
    approvalRequired: campaign.approvalRequired ?? false,
    category,
    cleanupRequired: campaign.mutatesStaging,
    commandKey: campaign.key,
    description: campaign.operatorDescription,
    definition: campaign,
    disabledReason: null,
    environment: campaign.targetEnvironment === "production" ? "Production" : "Staging",
    estimatedDuration: formatDuration(campaign.timeoutMs),
    evidenceProduced,
    executionEnabled: campaign.phase1Enabled,
    id: `registry:${campaign.key}`,
    mutatesStaging: campaign.mutatesStaging,
    name: campaign.displayName,
    npmScript: campaign.npmScript,
    prerequisites: prerequisitesForCommand(campaign),
    produces,
    product: "INSSA",
    relatedReports: relatedReportsForCommand(campaign),
    relatedValidation: relatedValidationForCommand(campaign),
    risk: campaign.riskLevel,
    source: "registry",
    status: campaign.phase1Enabled ? "Executable" : "Disabled"
  };
}

function managedCampaignFromDisabled(command: DisabledCommandCard, category: CampaignCategory): ManagedCampaign {
  const mutatesStaging = command.riskLevel.includes("mutation");
  const cleanupRequired = mutatesStaging || /cleanup|capsule|creates/i.test(`${command.description} ${command.reason}`);

  return {
    approvalRequired: true,
    category,
    cleanupRequired,
    commandKey: null,
    description: command.description,
    definition: null,
    disabledReason: command.reason,
    environment: "Staging",
    estimatedDuration: "not enabled",
    evidenceProduced: disabledEvidenceForCommand(command, category),
    executionEnabled: false,
    id: `disabled:${command.npmScript}`,
    mutatesStaging,
    name: command.label,
    npmScript: command.npmScript,
    prerequisites: [
      "Explicit dashboard approval workflow",
      "Validated staging-only environment",
      cleanupRequired ? "Manual cleanup ownership before execution" : "Operator confirmation before execution"
    ],
    produces: disabledProducesForCommand(command, category),
    product: "INSSA",
    relatedReports: category === "SIEM" ? ["SIEM export delivery evidence"] : ["Campaign summary report", "Playwright report"],
    relatedValidation: disabledRelatedValidationForCommand(command, category),
    risk: command.riskLevel,
    source: "disabled",
    status: "Disabled"
  };
}

function categoryForCommand(campaign: CampaignDefinition): CampaignCategory {
  if (campaign.key.startsWith("monitor_inssa_auth_")) return "Operations";
  if (SAFE_COMMAND_KEYS.includes(campaign.key)) return "Safe Tests";
  if (SECURITY_COMMAND_KEYS.includes(campaign.key)) return "Security";
  if (ARTIFACT_VALIDATION_COMMAND_KEYS.includes(campaign.key)) return "Artifact Validation";
  if (LIFECYCLE_COMMAND_KEYS.includes(campaign.key)) return "Lifecycle";
  if (SIEM_COMMAND_KEYS.includes(campaign.key)) return "SIEM";
  return "Operations";
}

function producesForCommand(campaign: CampaignDefinition) {
  const outputs = [];
  if (campaign.producesFindings) outputs.push("Findings");
  if (campaign.producesReports) outputs.push("Reports");
  if (campaign.commandType === "artifact_validation") outputs.push("Validation artifacts");
  if (campaign.commandType === "export") outputs.push("SIEM metadata export");
  if (campaign.commandType === "healthcheck") outputs.push("Healthcheck result");
  if (campaign.commandType === "report_render") outputs.push("Rendered HTML");
  return outputs.length ? outputs : ["Run metadata", "Logs"];
}

function evidenceProducedForCommand(campaign: CampaignDefinition) {
  if (campaign.key.startsWith("monitor_inssa_auth_")) {
    return ["Independent authentication results", "Screenshots", "Console and network logs", "Failure traces", "Playwright report", "Evidence bundle metadata"];
  }
  if (campaign.commandType === "artifact_validation") {
    return ["Playwright report", "Lifecycle validation JSON", "Evidence bundle metadata"];
  }
  if (campaign.commandType === "campaign" && campaign.producesFindings) {
    return ["Security campaign JSON", "Findings summary", "Playwright report", "Evidence bundle metadata"];
  }
  if (campaign.commandType === "campaign") {
    return ["Playwright report", "Safe suite result metadata", "Evidence bundle metadata"];
  }
  if (campaign.commandType === "export") return ["SIEM export JSON"];
  if (campaign.commandType === "report_render") return ["HTML report derived from existing evidence"];
  return ["Run log", "Healthcheck output"];
}

function prerequisitesForCommand(campaign: CampaignDefinition) {
  const prerequisites = ["Authenticated operator or admin session"];
  if (campaign.targetEnvironment === "production") {
    prerequisites.push("Production authentication monitor credentials", "Explicit production monitoring enablement and exact host confirmation");
  } else {
    prerequisites.push("INSSA_URL must resolve to staging.inssa.us");
  }
  if (campaign.requiresLifecycleArtifact) {
    prerequisites.push("Explicit lifecycle artifact selection or latest usable lifecycle artifact");
  }
  if (campaign.key === "platform_healthcheck") {
    prerequisites.push("Admin role");
  }
  if (campaign.commandType === "report_render" || campaign.commandType === "export") {
    prerequisites.push("Existing campaign artifacts or reports available locally");
  }
  return prerequisites;
}

function relatedReportsForCommand(campaign: CampaignDefinition) {
  if (campaign.key.startsWith("monitor_inssa_auth_")) return ["Authentication monitoring summary", "Playwright report"];
  if (campaign.key.includes("security")) return ["Security report", "Playwright report"];
  if (campaign.commandType === "artifact_validation") return ["Playwright report", "Lifecycle report"];
  if (campaign.commandType === "report_render") return ["Rendered HTML report"];
  if (campaign.commandType === "export") return ["SIEM export JSON"];
  return ["Playwright report"];
}

function relatedValidationForCommand(campaign: CampaignDefinition) {
  if (campaign.key === "test_inssa_discovery") return ["Public Share Validation", "Cleanup Capability Audit"];
  if (campaign.key === "test_inssa_public_share") return ["Authenticated Discovery", "Cleanup Capability Audit"];
  if (campaign.key === "test_inssa_cleanup_audit") return ["Authenticated Discovery", "Public Share Validation"];
  if (campaign.key === "test_inssa_campaign_security") return ["Security Verification"];
  if (campaign.key === "test_inssa_campaign_security_verify") return ["Security Campaign"];
  return ["Run History", "Evidence Workspace"];
}

function disabledProducesForCommand(command: DisabledCommandCard, category: CampaignCategory) {
  if (category === "Lifecycle") return ["Lifecycle artifact", "Cleanup target", "Discovery result", "Public share result"];
  if (category === "Security") return ["Access-control findings", "Security report", "Cleanup target"];
  if (category === "SIEM") return ["External SIEM transmission status"];
  return [command.label];
}

function disabledEvidenceForCommand(command: DisabledCommandCard, category: CampaignCategory) {
  if (category === "Lifecycle") return ["Lifecycle JSON artifact", "Playwright report", "Campaign summary", "Manual cleanup evidence"];
  if (category === "Security") return ["Security finding JSON", "Access probes", "Playwright report", "HTML security report"];
  if (category === "SIEM") return ["Wazuh delivery response metadata"];
  return [command.description];
}

function disabledRelatedValidationForCommand(command: DisabledCommandCard, category: CampaignCategory) {
  if (category === "Lifecycle") return ["Authenticated Discovery", "Public Share Validation", "Cleanup Capability Audit"];
  if (command.npmScript.includes("cross-user")) return ["Security Verification", "Access Control Review"];
  if (command.npmScript.includes("reveal-later")) return ["Reveal-Later Access-Control Verification"];
  if (category === "SIEM") return ["Generate SIEM Export"];
  return ["Evidence Workspace"];
}

function buildActionOptions(enabledCommands: CampaignDefinition[], disabledCommands: DisabledCommandCard[]): ActionOption[] {
  return [
    ...enabledCommands.map((campaign) => ({
      campaign,
      description: campaign.operatorDescription,
      disabled: false as const,
      key: campaign.key,
      label: campaign.displayName,
      npmScript: campaign.npmScript,
      riskLevel: campaign.riskLevel
    })),
    ...disabledCommands.map((command) => ({
      command,
      description: command.description,
      disabled: true as const,
      key: command.npmScript,
      label: command.label,
      npmScript: command.npmScript,
      riskLevel: command.riskLevel
    }))
  ];
}

function cleanupRequiredForAction(option: ActionOption) {
  if (!option.disabled) return option.campaign.mutatesStaging;
  return option.riskLevel.includes("mutation") || /cleanup|capsule|creates/i.test(option.description);
}

function formatCampaignExecutionState(run: RunRecord) {
  if (run.cleanup?.status === "pending") return "Cleanup Pending";
  if (run.cleanup?.status === "failed") return "Cleanup Failed";
  if (run.status === "passed" || run.status === "passed_with_warnings") return "Completed";
  if (run.status === "queued") return "Run Queued";
  if (run.status === "starting" || run.status === "running" || run.status === "indexing_artifacts") return "Running";
  if (run.status === "timed_out") return "Timed Out";
  if (run.status === "failed" || run.status === "failed_startup") return "Failed";
  return run.status.replaceAll("_", " ");
}

function disabledReasonSummary(command: DisabledCommandCard) {
  const reasons = [];
  if (command.riskLevel.includes("mutation")) reasons.push("Live staging mutation");
  if (/approval|enabled|explicit/i.test(command.reason)) reasons.push("Requires approval workflow");
  if (/cleanup/i.test(command.reason) || /cleanup|capsule|creates/i.test(command.description)) {
    reasons.push("Manual cleanup required");
  }
  reasons.push("Not enabled in current phase");
  return Array.from(new Set(reasons)).join(" · ");
}

function findLatestRunForCommand(runs: RunRecord[], campaignKey: string) {
  return runs.find((run) => run.campaignKey === campaignKey) ?? null;
}

function selectCommands(campaigns: CampaignDefinition[], keys: string[]) {
  const byKey = new Map(campaigns.map((campaign) => [campaign.key, campaign]));
  return keys.map((key) => byKey.get(key)).filter((campaign): campaign is CampaignDefinition => Boolean(campaign));
}

function reportCategoryForArtifact(artifact: ArtifactRecord): ReportCategory {
  if (artifact.artifactType === "Playwright Report") return "Playwright";
  if (artifact.artifactType === "Security Report") return "Security";
  if (artifact.artifactType === "Lifecycle Report") return "Lifecycle";
  return "SIEM";
}

function buildLifecycleArtifactSelection(
  mode: "explicit" | "latest",
  selectedArtifact: LifecycleArtifactOption | null
): LifecycleArtifactSelection | null {
  if (!selectedArtifact) return null;
  if (mode === "latest") return { mode: "latest" };
  return {
    mode: "explicit",
    path: selectedArtifact.filePath
  };
}
