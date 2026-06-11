"use client";

import { startTransition, useEffect, useMemo, useState } from "react";

type CampaignDefinition = {
  commandType: "artifact_validation" | "campaign" | "export" | "healthcheck" | "report_render";
  displayName: string;
  key: string;
  mutatesStaging: boolean;
  npmScript: string;
  operatorDescription: string;
  phase1Enabled: boolean;
  producesFindings: boolean;
  producesReports: boolean;
  requiresLifecycleArtifact?: boolean;
  riskLevel: string;
  timeoutMs: number;
};

type RunRecord = {
  campaignKey: string;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
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
  artifactType: string;
  createdAt: string | null;
  filePath: string;
  fileSize: number;
  artifactValidationReady: boolean;
  modifiedAt: string;
  observedCreateSuccess: boolean;
  runId: string | null;
  subject: string | null;
  timestamp: string;
};

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

const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "indexing_artifacts"]);
const PASSED_STATUSES = new Set(["passed", "passed_with_warnings"]);
const FAILED_STATUSES = new Set(["failed", "failed_startup", "cancelled", "timed_out"]);
const REPORT_ARCHIVE_ARTIFACT_TYPES = new Set(["Lifecycle Report", "Playwright Report", "Security Report", "SIEM Export"]);
const SAFE_COMMAND_KEYS = ["test_inssa_safe"];
const SECURITY_COMMAND_KEYS = ["test_inssa_campaign_security", "test_inssa_campaign_security_verify"];
const ARTIFACT_VALIDATION_COMMAND_KEYS = [
  "test_inssa_discovery",
  "test_inssa_public_share",
  "test_inssa_cleanup_audit"
];
const SIEM_COMMAND_KEYS = ["siem_export"];
const OPERATIONS_COMMAND_KEYS = ["platform_healthcheck"];

type DisabledCommandCard = {
  description: string;
  label: string;
  npmScript: string;
  reason: string;
  riskLevel: string;
};

const DISABLED_LIFECYCLE_COMMANDS: DisabledCommandCard[] = [
  {
    description: "Creates one live text capsule, then validates downstream discovery and public-share behavior.",
    label: "Text Lifecycle",
    npmScript: "test:inssa:campaign:text",
    reason: "Disabled in the dashboard until the live-mutation approval and cleanup workflow is available.",
    riskLevel: "live mutation"
  },
  {
    description: "Creates one live image capsule and validates downstream lifecycle behavior.",
    label: "Media Lifecycle",
    npmScript: "test:inssa:campaign:media",
    reason: "Disabled because it creates staging data and requires explicit media/live gates.",
    riskLevel: "live mutation"
  },
  {
    description: "Creates one live video capsule and validates retrieval behavior with the static video fixture.",
    label: "Video Lifecycle",
    npmScript: "test:inssa:campaign:video",
    reason: "Disabled because it creates staging data and requires explicit video/live gates.",
    riskLevel: "live mutation"
  },
  {
    description: "Creates one scheduled reveal-later capsule and captures schedule/access behavior.",
    label: "Reveal-Later Lifecycle",
    npmScript: "test:inssa:campaign:reveal-later",
    reason: "Disabled until reveal-later cleanup and post-reveal follow-up are represented in the dashboard workflow.",
    riskLevel: "live mutation"
  }
];

const DISABLED_SECURITY_COMMANDS: DisabledCommandCard[] = [
  {
    description: "Creates one targeted capsule with User A and verifies User B access-control behavior.",
    label: "Cross-User Campaign",
    npmScript: "test:inssa:campaign:cross-user",
    reason: "Disabled because it creates staging data and requires secondary-account/cleanup confirmation.",
    riskLevel: "live mutation"
  },
  {
    description: "Creates or resumes reveal-later evidence and verifies pre/post-reveal access-control behavior.",
    label: "Reveal-Later Security",
    npmScript: "test:inssa:campaign:reveal-later-security",
    reason: "Disabled until artifact resume vs creation is explicit in the dashboard.",
    riskLevel: "live mutation"
  }
];

const DISABLED_SIEM_COMMANDS: DisabledCommandCard[] = [
  {
    description: "Sends the latest metadata-only SIEM export to the configured Wazuh ingestion endpoint.",
    label: "Send SIEM Export",
    npmScript: "siem:send",
    reason: "Disabled until endpoint preview, dry-run, and explicit send confirmation are implemented.",
    riskLevel: "external transmission"
  }
];

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
  const [reportArtifacts, setReportArtifacts] = useState<ArtifactRecord[]>([]);
  const [lifecycleArtifacts, setLifecycleArtifacts] = useState<LifecycleArtifactOption[]>([]);
  const [lifecycleArtifactError, setLifecycleArtifactError] = useState("");
  const [artifactSelectionMode, setArtifactSelectionMode] = useState<"explicit" | "latest">("latest");
  const [selectedLifecycleArtifactPath, setSelectedLifecycleArtifactPath] = useState("");
  const [selectedArtifactValidationActionKey, setSelectedArtifactValidationActionKey] = useState("");
  const [selectedLifecycleActionKey, setSelectedLifecycleActionKey] = useState(DISABLED_LIFECYCLE_COMMANDS[0]?.npmScript ?? "");
  const [selectedReportCategory, setSelectedReportCategory] = useState<ReportCategory>("Security");
  const [selectedSecurityActionKey, setSelectedSecurityActionKey] = useState("");
  const [selectedSiemActionKey, setSelectedSiemActionKey] = useState("");
  const [runDetailError, setRunDetailError] = useState("");
  const [runHistoryError, setRunHistoryError] = useState(initialLoadError ?? "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshCampaigns();
    void refreshLifecycleArtifacts();
    void refreshRuns();
    const interval = window.setInterval(() => {
      void refreshRuns();
      if (selectedRunId) {
        void refreshRunDetail(selectedRunId);
      }
    }, 3_000);

    return () => window.clearInterval(interval);
  }, [selectedRunId]);

  useEffect(() => {
    if (selectedRunId) {
      void refreshRunDetail(selectedRunId);
    } else {
      setSelectedRun(null);
      setLogs([]);
      setArtifacts([]);
    }
  }, [selectedRunId]);

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

  const playwrightReport = artifacts.find((artifact) => artifact.artifactType === "Playwright Report");
  const reportRenderCommands = campaignDefinitions.filter((campaign) => campaign.commandType === "report_render");
  const safeCommands = selectCommands(campaignDefinitions, SAFE_COMMAND_KEYS);
  const securityCommands = selectCommands(campaignDefinitions, SECURITY_COMMAND_KEYS);
  const artifactValidationCommands = selectCommands(campaignDefinitions, ARTIFACT_VALIDATION_COMMAND_KEYS);
  const siemCommands = selectCommands(campaignDefinitions, SIEM_COMMAND_KEYS);
  const operationsCommands = selectCommands(campaignDefinitions, OPERATIONS_COMMAND_KEYS);
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
  const canStartRuns = currentUser.role === "operator" || currentUser.role === "admin";

  async function refreshCampaigns() {
    const endpoint = "/api/campaign-definitions";
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
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
      const response = await fetch(endpoint, { cache: "no-store" });
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
      void refreshReportArchive(nextRuns);
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

  async function refreshLifecycleArtifacts() {
    const endpoint = "/api/lifecycle-artifacts";
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
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

  async function refreshRunDetail(runId: string) {
    let runResponse: Response;
    let logsResponse: Response;
    let artifactsResponse: Response;

    try {
      [runResponse, logsResponse, artifactsResponse] = await Promise.all([
        fetch(`/api/runs/${runId}`, { cache: "no-store" }),
        fetch(`/api/runs/${runId}/logs`, { cache: "no-store" }),
        fetch(`/api/runs/${runId}/artifacts`, { cache: "no-store" })
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
  }

  async function refreshReportArchive(runList: RunRecord[]) {
    const recentRuns = runList.slice(0, 40);
    const artifactLists = await Promise.all(
      recentRuns.map(async (run) => {
        const endpoint = `/api/runs/${run.id}/artifacts`;
        try {
          const response = await fetch(endpoint, { cache: "no-store" });
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

    startTransition(() => setReportArtifacts(artifactLists.flat()));
  }

  async function runCampaign(campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection) {
    setMessage(`Starting ${campaignKey}...`);
    const endpoint = "/api/runs";
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          artifactSelection: lifecycleArtifactSelection,
          campaignKey
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; run?: RunRecord };
      if (!response.ok) {
        const failureMessage = body.error ?? "Run request failed.";
        setMessage(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return;
      }

      if (!body.run?.id) {
        const failureMessage = "Run request succeeded but no run record was returned.";
        setMessage(failureMessage);
        recordApiFailure(endpoint, response.status, failureMessage);
        return;
      }

      setMessage(`Run started: ${body.run.id}`);
      setSelectedRunId(body.run.id);
      await refreshRuns();
      await refreshRunDetail(body.run.id);
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      setMessage(failureMessage);
      recordApiFailure(endpoint, "network", failureMessage);
    }
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

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">INSSA QA Operations</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
                Safe campaign runner console
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                V1 read-only operations console for safe campaign execution, run history, live logs,
                indexed artifacts, report viewing, SIEM export generation, and platform health checks.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm">
              <a className="nav-pill" href="#overview">Overview</a>
              <a className="nav-pill" href="#safe-tests">Safe Tests</a>
              <a className="nav-pill" href="#security">Security</a>
              <a className="nav-pill" href="#lifecycle">Lifecycle</a>
              <a className="nav-pill" href="#artifact-validation">Artifact Validation</a>
              <a className="nav-pill" href="#reports">Reports</a>
              <a className="nav-pill" href="#siem">SIEM</a>
              <a className="nav-pill" href="#operations">Operations</a>
              <a className="nav-pill" href="#history">Run History</a>
              <a className="nav-pill" href="#details">Run Details</a>
              <a className="nav-pill" href="/logout">Logout</a>
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="rounded-full bg-slate-950 px-3 py-1">Signed in: {currentUser.email || currentUser.id}</span>
            <span className="rounded-full bg-slate-950 px-3 py-1">Role: {currentUser.role}</span>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4" id="overview">
          <OverviewCard label="Total Runs" value={overview.total} />
          <OverviewCard label="Passed Runs" value={overview.passed} tone="pass" />
          <OverviewCard label="Failed Runs" value={overview.failed} tone="fail" />
          <OverviewCard label="Running Jobs" value={overview.running} tone="active" />
        </section>

        {apiFailures.length > 0 ? (
          <section className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-5">
            <h2 className="text-lg font-semibold text-amber-100">Dashboard API Failure</h2>
            <p className="mt-1 text-sm text-amber-100/80">The dashboard is showing diagnostics instead of silently hiding failed requests.</p>
            <div className="mt-3 space-y-2">
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

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5">
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

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Latest Activity</h2>
              <p className="text-sm text-slate-400">Most recent run activity from the operations metadata store.</p>
            </div>
            {message ? <p className="rounded-full bg-cyan-400/10 px-3 py-1 text-sm text-cyan-200">{message}</p> : null}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {runs.slice(0, 3).map((run) => (
              <button
                className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-400/60"
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                type="button"
              >
                <StatusBadge status={run.status} />
                <p className="mt-3 font-mono text-xs text-slate-400">{run.id}</p>
                <p className="mt-2 text-sm font-medium">{run.campaignKey}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(run.createdAt)}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="safe-tests">
          <SectionHeader title="Safe Tests" subtitle="Non-mutating INSSA regression checks that are safe to run from the dashboard." />
          <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
            Campaigns execute tests. This section contains the safe baseline suite only.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
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

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="security">
          <SectionHeader title="Security" subtitle="Black-box security campaigns and read-only verification against existing evidence." />
          <p className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
            Security campaigns execute tests and can generate findings. Cross-user and reveal-later security remain disabled because they can create staging data.
          </p>
          <ActionSelectorPanel
            canStartRuns={canStartRuns}
            currentUserRole={currentUser.role}
            disabledCommands={DISABLED_SECURITY_COMMANDS}
            enabledCommands={securityCommands}
            onSelect={setSelectedSecurityActionKey}
            runningCount={overview.running}
            runs={runs}
            runCampaign={runCampaign}
            selectedKey={selectedSecurityActionKey}
          />
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="lifecycle">
          <SectionHeader title="Lifecycle" subtitle="Live capsule lifecycle campaigns are visible for orientation but disabled in the dashboard." />
          <p className="mt-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            Lifecycle commands create staging data. They require live flags, one-run execution, no retry around final actions, and manual cleanup evidence.
          </p>
          <ActionSelectorPanel
            canStartRuns={canStartRuns}
            currentUserRole={currentUser.role}
            disabledCommands={DISABLED_LIFECYCLE_COMMANDS}
            enabledCommands={[]}
            onSelect={setSelectedLifecycleActionKey}
            runningCount={overview.running}
            runs={runs}
            runCampaign={runCampaign}
            selectedKey={selectedLifecycleActionKey}
          />
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="artifact-validation">
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

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="reports">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0">
              <SectionHeader title="Reports" subtitle="Review generated evidence without confusing it with campaign execution." />
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Report archive entries are indexed artifacts. Opening a report does not run Playwright or create fresh findings.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(["Playwright", "Security", "Lifecycle", "SIEM"] as ReportCategory[]).map((category) => (
                  <button
                    className={`rounded-full px-3 py-1.5 text-sm transition ${
                      selectedReportCategory === category
                        ? "bg-cyan-300 text-slate-950"
                        : "bg-slate-950 text-slate-300 ring-1 ring-slate-800 hover:ring-cyan-300/40"
                    }`}
                    key={category}
                    onClick={() => setSelectedReportCategory(category)}
                    type="button"
                  >
                    {category} ({reportCategoryCounts[category]})
                  </button>
                ))}
              </div>
              <div className="mt-4 max-h-[36rem] space-y-3 overflow-auto overscroll-contain pr-1">
                {visibleReportArtifacts.length === 0 ? (
                  <p className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
                    No {selectedReportCategory.toLowerCase()} report artifacts are currently indexed.
                  </p>
                ) : (
                  visibleReportArtifacts.map((artifact) => {
                    const dashboardRun = runs.find((run) => run.id === artifact.runId);
                    const sourceCampaignRun = resolveReportSource(artifact, reportArchiveArtifacts);
                    const latestAlias = isLatestReportAlias(artifact);

                    return (
                      <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/60 p-4" key={artifact.id}>
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{reportTitle(artifact)}</h3>
                              {latestAlias ? (
                                <span className="rounded-full bg-amber-300/15 px-2.5 py-1 text-xs font-semibold text-amber-100 ring-1 ring-amber-300/20">
                                  latest alias
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words font-mono text-xs text-slate-400">{artifact.filePath}</p>
                          </div>
                          {canOpenArtifact(artifact) ? (
                            <a
                              className="shrink-0 rounded-lg border border-cyan-300/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10"
                              href={`/api/artifacts/${artifact.id}/file`}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open report
                            </a>
                          ) : null}
                        </div>
                        <dl className="mt-4 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
                          <Metadata label="Generated date" value={formatDate(artifact.createdAt)} />
                          <Metadata label="Source campaign run" value={sourceCampaignRun ?? "unknown"} mono />
                          <Metadata label="Generated by" value={dashboardRun ? `${dashboardRun.campaignKey} / ${dashboardRun.id}` : artifact.runId} mono />
                          <Metadata label="Artifact type" value={artifact.artifactType} />
                          <Metadata label="Size" value={formatBytes(artifact.fileSize)} />
                        </dl>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <aside className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <h3 className="font-semibold">Report Tools</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                These actions work from existing evidence. They do not execute Playwright tests or create fresh findings.
              </p>
              <div className="mt-4 space-y-3">
                {reportRenderCommands.map((campaign) => (
                  <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3" key={campaign.key}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-medium">{campaign.displayName}</h4>
                        <p className="mt-1 font-mono text-xs text-slate-500">{campaign.npmScript}</p>
                      </div>
                      <RiskBadge risk={campaign.riskLevel} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{campaign.operatorDescription}</p>
                    <button
                      className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      disabled={!canStartRuns || overview.running > 0}
                      onClick={() => void runCampaign(campaign.key)}
                      type="button"
                    >
                      {canStartRuns ? "Re-render Report" : "Viewer role cannot run"}
                    </button>
                  </article>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="siem">
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

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="operations">
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

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="history">
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
              <>
                <div className="hidden grid-cols-[1.4fr_1fr_0.7fr_0.6fr_1fr] gap-3 bg-slate-950 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500 md:grid">
                  <span>Run ID</span>
                  <span>Campaign</span>
                  <span>Status</span>
                  <span>Duration</span>
                  <span>Created</span>
                </div>
                <div className="divide-y divide-slate-800">
                  {visibleRuns.length === 0 ? (
                    <p className="bg-slate-950/50 p-4 text-sm text-slate-400">
                      No runs found in the current metadata backend.
                    </p>
                  ) : (
                    visibleRuns.map((run) => (
                      <button
                        className={`grid w-full gap-3 px-4 py-4 text-left text-sm transition hover:bg-slate-800/50 md:grid-cols-[1.4fr_1fr_0.7fr_0.6fr_1fr] ${selectedRunId === run.id ? "bg-cyan-400/10" : "bg-slate-900/30"}`}
                        key={run.id}
                        onClick={() => setSelectedRunId(run.id)}
                        type="button"
                      >
                        <span className="break-all font-mono text-xs text-slate-300">{run.id}</span>
                        <span>{run.campaignKey}</span>
                        <span><StatusBadge status={run.status} /></span>
                        <span>{formatDuration(run.durationMs)}</span>
                        <span className="text-slate-400">{formatDate(run.createdAt)}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5" id="details">
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

                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-semibold">Live Logs</h3>
                    <p className="text-xs text-slate-500">{logs.length} entries</p>
                  </div>
                  <div className="mt-3 max-h-[34rem] min-h-[14rem] overflow-auto overscroll-contain rounded-xl border border-slate-800 bg-black/60 p-3 font-mono text-xs leading-5">
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

              <aside className="min-w-0 space-y-5 xl:w-[22rem] 2xl:w-[24rem]">
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
                  <div className="mt-3 max-h-[34rem] space-y-2 overflow-auto overscroll-contain pr-1">
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
        </section>
      </div>
    </main>
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
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection) => Promise<void>;
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

function ActionSelectorPanel({
  canStartRuns,
  currentUserRole,
  disabledCommands,
  enabledCommands,
  onSelect,
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
  runningCount: number;
  runs: RunRecord[];
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection) => Promise<void>;
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
  option,
  runningCount,
  runCampaign
}: {
  canStartRuns: boolean;
  currentUserRole: InssaOpsClientProps["currentUser"]["role"];
  latestRun: RunRecord | null;
  option: ActionOption;
  runningCount: number;
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection) => Promise<void>;
}) {
  const campaign = option.disabled ? null : option.campaign;
  const disabled =
    option.disabled ||
    !campaign ||
    !canStartRuns ||
    !campaign.phase1Enabled ||
    campaign.mutatesStaging ||
    runningCount > 0 ||
    (currentUserRole !== "admin" && campaign.key === "platform_healthcheck");

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
        <Metadata label="Execution status" value={latestRun ? latestRun.status : option.disabled ? "disabled in current phase" : "not run yet"} />
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
        onClick={() => campaign && void runCampaign(campaign.key)}
        type="button"
      >
        {option.disabled || !campaign ? "Disabled" : canStartRuns ? actionLabelForCommand(campaign) : "Viewer role cannot run"}
      </button>
    </article>
  );
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
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection) => Promise<void>;
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
  runCampaign: (campaignKey: string, lifecycleArtifactSelection?: LifecycleArtifactSelection) => Promise<void>;
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

function MetadataCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-3 break-words text-lg font-semibold">{value}</p>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
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
