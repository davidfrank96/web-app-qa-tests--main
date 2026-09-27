"use client";

import { useEffect, useRef, useState } from "react";
import type { CampaignDefinition, CleanupLedgerRecord, LifecycleArtifactOption, LiveApprovalPayload, MutationReadinessRecord, PreflightCheck, RunRecord } from "./inssa-ops-client";

const ACKNOWLEDGEMENTS = ["modifies_staging", "target_verified", "cleanup_understood", "evidence_review_required", "no_automatic_final_action_retry"];
const PHRASE = "RUN STAGING MUTATION";

export function functionalResultLabel(value: string) {
  const labels: Record<string, string> = {
    passed: "Passed", passed_with_warnings: "Passed with warnings", failed: "Failed", failed_startup: "Failed to start",
    timed_out: "Timed out", cancelled: "Cancelled", queued: "Queued", starting: "Starting", running: "Running",
    indexing_artifacts: "Collecting evidence", historical_run_recorded: "Historical run", not_yet_validated: "Never run"
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function readinessLabel(value?: string) {
  if (value?.startsWith("READY")) return "Ready";
  const labels: Record<string, string> = {
    NOT_YET_VALIDATED: "Not validated", BLOCKED_CONFIGURATION: "Needs configuration", BLOCKED_ACCOUNT: "Check QA accounts",
    BLOCKED_FIXTURE: "Check test fixture", BLOCKED_WORKER: "Worker unavailable", BLOCKED_ACTIVE_RUN: "Another run is active",
    BLOCKED_CLEANUP_IDENTITY: "Review object identity", BLOCKED_CLEANUP_POLICY: "Review cleanup safety"
  };
  return value ? labels[value] ?? "Needs attention" : "Checking readiness";
}

function dateLabel(value: string) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function ageLabel(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
}
function cleanupLabel(status: string) { return status === "completed" ? "Confirmed cleaned" : status === "failed" ? "Needs review" : "Awaiting cleanup"; }

export function GovernedCampaignWorkspace({ campaigns, allCampaigns, canStartRuns, currentUserRole, cleanupLedger, manual, readiness, runs, selectedKey, onSelect, onReview, onRun, onOpenRun, onConfirmCleanup, runningCount }: {
  campaigns: CampaignDefinition[]; allCampaigns: CampaignDefinition[]; canStartRuns: boolean; currentUserRole: string;
  cleanupLedger: CleanupLedgerRecord[]; manual: boolean; readiness: MutationReadinessRecord[]; runs: RunRecord[]; selectedKey: string;
  onSelect: (key: string) => void; onReview: (campaign: CampaignDefinition) => Promise<void>;
  onRun: (campaign: CampaignDefinition) => Promise<boolean>; onOpenRun: (id: string) => void;
  onConfirmCleanup?: (record: CleanupLedgerRecord) => Promise<void>; runningCount: number;
}) {
  const selected = campaigns.find(campaign => campaign.key === selectedKey) ?? campaigns[0];
  const state = readiness.find(record => record.campaignKey === selected?.key);
  const latestRun = runs.find(run => run.campaignKey === selected?.key);
  const latestRunId = latestRun?.id ?? (state?.latestRunAvailable ? state.latestRunId : null);
  const campaignRecords = cleanupLedger.filter(record => record.campaignKey === selected?.key);
  const campaignUnresolved = campaignRecords.filter(record => record.status !== "completed");
  const result = latestRun?.status ?? state?.lastResult ?? "not_yet_validated";
  const canReview = canStartRuns && selected?.phase1Enabled && (!selected.mutatesStaging || currentUserRole === "admin");

  return <div className="lc-workspace">
    <aside className="lc-cleanup-banner" aria-label="Cleanup mode">
      <strong>{manual ? "Manual cleanup mode" : "Cleanup policy"}</strong>
      <p>{manual ? "Automatic product cleanup is currently unavailable. Tests can continue normally. QA-created staging objects are tracked for manual cleanup later and do not block additional tests." : "QA-created staging objects remain tracked. Standard cleanup safety checks apply before execution."}</p>
    </aside>
    <div className="lc-runner">
      <nav className="lc-selector" aria-label="Campaigns">
        <p className="lc-eyebrow">Campaigns</p>
        {campaigns.map(campaign => <button type="button" aria-pressed={campaign.key === selected?.key} key={campaign.key} onClick={() => onSelect(campaign.key)}>{campaign.displayName}<span aria-hidden="true">{campaign.key === selected?.key ? "→" : ""}</span></button>)}
      </nav>
      {selected ? <article className="lc-selected" aria-label="Selected campaign" key={selected.key}>
        <h2>{selected.displayName}</h2>
        <p className="lc-description">{selected.operatorDescription}</p>
        <dl className="lc-metrics">
          <div><dt>Status</dt><dd><span className="lc-status" data-tone={state?.executionAllowed || !selected.mutatesStaging ? "ready" : "neutral"}>{selected.mutatesStaging ? readinessLabel(state?.status) : "Ready"}</span></dd></div>
          <div><dt>Last result</dt><dd data-testid="campaign-result">{functionalResultLabel(result)}</dd></div>
          <div><dt>Estimated duration</dt><dd>~{Math.ceil(selected.timeoutMs / 60_000)} min</dd></div>
        </dl>
        {state?.blockingReason ? <p className="lc-blocker">{state.blockingReason}</p> : null}
        <div className="lc-actions">
          <button className="lc-primary" type="button" disabled={!canReview || (!selected.mutatesStaging && runningCount > 0)} onClick={() => selected.mutatesStaging ? void onReview(selected) : void onRun(selected)}>{selected.mutatesStaging ? "Review & Run" : "Run campaign"}</button>
          {latestRunId ? <button className="lc-secondary" type="button" onClick={() => onOpenRun(latestRunId)}>View latest run</button> : null}
          {!canReview ? <span className="lc-muted">{currentUserRole !== "admin" && selected.mutatesStaging ? "Admin approval required" : "Execution unavailable"}</span> : null}
        </div>
        <details className="lc-details">
          <summary>Details</summary>
          <dl className="lc-detail-list">
            <div><dt>Command</dt><dd><code>npm run {selected.npmScript}</code></dd></div>
            <div><dt>Target</dt><dd>INSSA staging</dd></div>
            <div><dt>Risk</dt><dd>{selected.mutatesStaging ? "Creates staging data" : "Read-only verification"}</dd></div>
            <div><dt>Evidence</dt><dd>{[selected.producesReports && "Reports", selected.producesFindings && "Findings", "Logs and artifacts"].filter(Boolean).join(" · ")}</dd></div>
            <div><dt>Campaign cleanup</dt><dd>{campaignUnresolved.length ? `${campaignUnresolved.length} object${campaignUnresolved.length === 1 ? "" : "s"} from this campaign awaiting manual cleanup` : campaignRecords.length ? "No objects awaiting cleanup" : "No created objects recorded for this campaign"}</dd></div>
          </dl>
          {state ? <details className="lc-details"><summary>Technical readiness</summary><p><code>{state.status}</code></p><CheckDetails checks={state.checks} /></details> : null}
        </details>
      </article> : <p>No campaigns available.</p>}
    </div>
    <CleanupBacklog records={cleanupLedger} campaigns={allCampaigns} manual={manual} onConfirm={onConfirmCleanup} onOpenRun={onOpenRun} />
  </div>;
}

function CleanupBacklog({ records, campaigns, manual, onConfirm, onOpenRun }: { records: CleanupLedgerRecord[]; campaigns: CampaignDefinition[]; manual: boolean; onConfirm?: (record: CleanupLedgerRecord) => Promise<void>; onOpenRun: (id: string) => void }) {
  const unresolved = records.filter(record => record.status !== "completed");
  const oldest = unresolved.reduce<string | null>((value, record) => !value || record.createdAt < value ? record.createdAt : value, null);
  return <details className="lc-backlog">
    <summary><span>Manual cleanup backlog · {unresolved.length} objects</span><span className="lc-backlog-meta">Oldest: {oldest ? ageLabel(oldest) : "None"} · Impact on testing: {manual ? "None" : "Policy enforced"} · Mode: {manual ? "Manual" : "Standard"}</span><span className="lc-disclosure-label">View backlog</span></summary>
    <div className="lc-table-scroll" role="region" aria-label="Cleanup backlog objects" tabIndex={0}>
      <table><caption className="sr-only">Tracked QA staging objects, including previously confirmed cleanup</caption><thead><tr>{["Object", "Campaign", "Run", "Created", "Owner", "Status", "Action"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{records.map(record => <tr key={record.id}>
          <td><details className="lc-object"><summary title={record.objectPath}><span>{record.objectPath}</span></summary><dl><dt>Object ID</dt><dd>{record.objectId}</dd><dt>Full path</dt><dd>{record.objectPath}</dd><dt>Retention deadline</dt><dd>{dateLabel(record.retentionUntil)}</dd><dt>Notes</dt><dd>{record.notes ?? "None"}</dd></dl></details></td>
          <td>{campaigns.find(campaign => campaign.key === record.campaignKey)?.displayName ?? record.campaignKey.replaceAll("_", " ")}</td>
          <td><button className="lc-link lc-run-link" title={record.originatingRunId} onClick={() => onOpenRun(record.originatingRunId)} type="button">{record.originatingRunId}</button></td>
          <td>{dateLabel(record.createdAt)}</td><td>{record.ownerAccount ?? "Unknown"}</td><td>{cleanupLabel(record.status)}</td>
          <td>{record.status === "completed" ? "Confirmed" : onConfirm ? <button className="lc-secondary" type="button" onClick={() => void onConfirm(record)}>Mark manually cleaned</button> : <span className="lc-muted">Admin only</span>}</td>
        </tr>)}</tbody>
      </table>
      {records.length === 0 ? <p className="lc-muted">No tracked objects.</p> : null}
    </div>
  </details>;
}

type PreviewResult = { ok: boolean; checks: PreflightCheck[]; error?: string };
type Selection = { executionMode?: "create" | "resume"; resumeArtifactPath?: string };

export function GovernedApprovalModal({ campaign, onClose, onPreview, onRun, revealLaterArtifacts, runningCount }: {
  campaign: CampaignDefinition; onClose: () => void;
  onPreview: (selection: Selection, signal: AbortSignal) => Promise<PreviewResult>;
  onRun: (approval: LiveApprovalPayload) => Promise<{ error?: string }>;
  revealLaterArtifacts: LifecycleArtifactOption[]; runningCount: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  const [mode, setMode] = useState<"" | "create" | "resume">("");
  const [artifactPath, setArtifactPath] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [recheck, setRecheck] = useState(0);
  const [result, setResult] = useState<(PreviewResult & { key: string }) | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const key = JSON.stringify([campaign.key, mode, artifactPath, recheck]);
  const checking = result?.key !== key;
  const modeReady = !campaign.supportsExecutionModes || mode === "create" || (mode === "resume" && Boolean(artifactPath));
  const ready = !checking && result?.ok && !result.checks.some(check => !check.passed && !check.advisory) && modeReady && runningCount === 0 && !submitError;
  const manual = result?.checks.some(check => check.advisory && check.id === "manual-cleanup");
  const selection: Selection = { ...(mode ? { executionMode: mode } : {}), ...(mode === "resume" ? { resumeArtifactPath: artifactPath } : {}) };
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setSubmitError("");
    previewCallback.current({ ...(mode ? { executionMode: mode } : {}), ...(mode === "resume" ? { resumeArtifactPath: artifactPath } : {}) }, controller.signal)
      .then(value => { if (current) setResult({ ...value, key }); })
      .catch(() => { if (current) setResult({ key, ok: false, checks: [], error: "Readiness check unavailable. Recheck before running." }); })
      .finally(() => window.clearTimeout(timeout));
    return () => { current = false; controller.abort(); window.clearTimeout(timeout); };
  }, [key, mode, artifactPath]);
  async function submit() {
    if (!ready || !acknowledged || phrase !== PHRASE || submitting) return;
    setSubmitting(true);
    try {
      const response = await onRun({ ...selection, acknowledgements: [...ACKNOWLEDGEMENTS], confirmationPhrase: phrase });
      if (response.error) setSubmitError(response.error);
    } catch { setSubmitError("The run request could not be verified. Check the Runs workspace before trying again."); }
    finally { setSubmitting(false); }
  }
  const safetyChecks = [
    ["staging-target", "Staging target"], ["worker-health", "Worker ready"], ["prerequisites", "Configuration valid"], ["active-run", "No active run"]
  ];
  return <dialog className="lc-dialog" ref={dialog} aria-labelledby="lc-approval-title" onCancel={event => { event.preventDefault(); if (!submitting) onClose(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex="0"]'))
      .filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="lc-modal-header"><div><p className="lc-eyebrow">Review staging test</p><h2 id="lc-approval-title">Run {campaign.displayName}</h2></div><button className="lc-secondary" type="button" disabled={submitting} onClick={onClose} autoFocus>Cancel</button></div>
    <div className="lc-modal-body">
      <p className="lc-muted">Staging <span aria-hidden="true">·</span> staging.inssa.us</p>
      <p className="lc-check-status" role="status">{checking ? "Checking…" : ready ? "Ready to run" : "Needs attention"}</p>
      <ul className="lc-safety">{safetyChecks.map(([id, label]) => {
        const check = !checking ? result?.checks.find(item => item.id === id) : undefined;
        return <li key={id}><span aria-hidden="true">{check?.passed ? "✓" : check ? "!" : "○"}</span> {label}<span className="sr-only">: {check?.passed ? "Verified" : check ? "Blocked" : "Not yet checked"}</span></li>;
      })}</ul>
      {manual && !checking ? <p className="lc-inline-advisory">Manual cleanup mode · non-blocking</p> : null}
      {campaign.supportsExecutionModes ? <fieldset className="lc-mode" disabled={submitting}><legend>Execution mode</legend><div><label><input name="execution-mode" type="radio" checked={mode === "create"} onChange={() => { setMode("create"); setArtifactPath(""); }} /> Create new</label><label><input name="execution-mode" type="radio" checked={mode === "resume"} onChange={() => setMode("resume")} /> Resume existing</label></div>
        {mode === "resume" ? <><label htmlFor="lc-artifact">Approved Reveal-Later artifact</label><select id="lc-artifact" value={artifactPath} onChange={event => setArtifactPath(event.target.value)}><option value="">Select an artifact</option>{revealLaterArtifacts.map(artifact => <option key={artifact.filePath} value={artifact.filePath}>{artifact.subject ?? artifact.artifactId ?? artifact.filePath} · {dateLabel(artifact.timestamp)}</option>)}</select>{artifactPath ? <p className="lc-path">{artifactPath}</p> : <p className="lc-muted">Select a previously approved staging artifact to resume.</p>}</> : null}
      </fieldset> : null}
      {!checking && result?.error ? <p role="alert" className="lc-blocker">{result.error}</p> : null}
      {submitError ? <p role="alert" className="lc-blocker">{submitError}</p> : null}
      <div className="lc-consent">
        <label><input type="checkbox" checked={acknowledged} disabled={submitting} onChange={event => setAcknowledged(event.target.checked)} aria-describedby="lc-consent-details" /><span>I understand this test creates QA data on INSSA staging and automatic cleanup is currently unavailable.</span></label>
        <p id="lc-consent-details" className="lc-muted">I have verified the staging target, will review evidence and cleanup, and understand final actions are not automatically retried.</p>
        <label htmlFor="mutation-confirmation">Type <code>{PHRASE}</code></label><input id="mutation-confirmation" value={phrase} disabled={submitting} onChange={event => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <details className="lc-details"><summary>Technical checks</summary><p className="lc-muted">Readiness inspection does not approve or create a run. Execution rechecks all safeguards.</p><CheckDetails checks={checking ? [] : result?.checks ?? []} /></details>
    </div>
    <div className="lc-modal-footer"><button className="lc-link" type="button" disabled={checking || submitting} onClick={() => setRecheck(value => value + 1)}>Recheck</button><button className="lc-primary" type="button" disabled={!ready || !acknowledged || phrase !== PHRASE || submitting} onClick={() => void submit()}>{submitting ? "Starting…" : "Run Test"}</button></div>
  </dialog>;
}

function CheckDetails({ checks }: { checks: PreflightCheck[] }) {
  return <ul className="lc-check-details">{checks.map((check, index) => <li key={`${check.id}-${index}`}><strong>{check.advisory ? "Advisory" : check.passed ? "Passed" : "Blocked"}:</strong> {check.detail}</li>)}</ul>;
}

export function RunCleanupSummary({ run, records, onConfirm }: { run: RunRecord; records: CleanupLedgerRecord[]; onConfirm?: () => Promise<void> }) {
  if (!run.cleanup || run.cleanup.status === "not_required") return null;
  const completed = ["completed", "manually_confirmed"].includes(run.cleanup.status);
  const unresolved = records.filter(record => record.status !== "completed");
  const knownIds = new Set([...run.cleanup.createdCapsuleIds, ...(run.cleanup.createdMediaIds ?? [])]);
  const count = records.length ? unresolved.length : completed ? 0 : knownIds.size;
  return <details className="lc-run-cleanup"><summary><strong>Manual cleanup</strong><span>{count ? `${count} QA object${count === 1 ? "" : "s"} awaiting cleanup` : completed || records.length ? "No objects awaiting cleanup" : "Object identity needs review"}</span></summary>
    <p className="lc-muted">Cleanup accounting is separate from the test result.</p>
    {run.cleanup.reasonCode ? <p className="lc-path">{run.cleanup.reasonCode}</p> : null}
    {run.cleanup.instructions.map(instruction => <p key={instruction}>{instruction}</p>)}
    {onConfirm && count > 0 && !completed ? <button className="lc-secondary" type="button" onClick={() => void onConfirm()}>Mark manually cleaned</button> : null}
  </details>;
}
