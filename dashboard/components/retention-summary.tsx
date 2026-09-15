"use client";

import { useState } from "react";
import type { RetentionHealth, RetentionPlan } from "../lib/inssa-ops/retention-types";

export function RetentionSummary() {
  const [plan, setPlan] = useState<(RetentionPlan & { maintenance?: RetentionHealth }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setBusy(true); setError(null); setPlan(null);
    try {
      const response = await fetch("/api/retention", { method: "GET", cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "Administrator access is required." :
        response.status === 401 ? "Your session expired. Sign in to run the retention plan." : "Retention metadata is unavailable. Refresh to retry.");
      setPlan(await response.json());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Retention dry run failed."); }
    finally { setBusy(false); }
  }
  const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
  const summary = plan?.summary;
  const maintenance = plan?.maintenance;
  const last = maintenance?.lastExecution;
  const nextExpiry = plan?.bundles.filter((b) => b.eligibilityReason === "PROTECTED" && b.expiryAt).map((b) => b.expiryAt!).sort()[0];
  const cards = summary ? [
    ["Retention status", maintenance ? `${maintenance.status} · ${maintenance.enabled ? "Daily cleanup enabled" : "Daily cleanup disabled"}` : "Status unavailable"],
    ["Last retention run", last ? `${String(last.status)} · ${new Date(String(last.started_at)).toLocaleString()}` : "No execution yet"],
    ["Bytes reclaimed last run", size(Number(last?.bytes_reclaimed ?? 0))],
    ["Total reclaimed", size(maintenance?.totalReclaimed ?? 0)],
    ["Next eligible estimate", summary.eligibleBundles ? `${summary.eligibleBundles} bundles eligible now` : nextExpiry ? new Date(nextExpiry).toLocaleString() : "No known expiry"],
    ["Total evidence storage", `${size(summary.totalEvidenceStorageBytes)}${summary.storageSizeComplete ? "" : " (incomplete inventory)"}`],
    ["Eligible under current policy", `${summary.eligibleBundles} bundles`],
    ["Protected by holds", `${summary.protectedByHolds} bundles · ${summary.activeHolds} active holds`],
    ["Protected by failure / security", `${summary.protectedFailureOrSecurity} bundles`],
    ["Protected by unresolved cleanup", `${plan!.bundles.filter((b) => b.protectionReasons.includes("UNRESOLVED_CLEANUP")).length} bundles`],
    ["Review required", `${summary.reviewRequiredBundles} bundles`],
    ["Oldest eligible bundle", summary.oldestEligibleBundle ? new Date(summary.oldestEligibleBundle.createdAt).toLocaleString() : "None"],
    ["Estimated reclaimable bytes", `${summary.eligibleBytes.toLocaleString()} bytes (${size(summary.eligibleBytes)})`]
  ] : [];
  return <section className="workspace-card" aria-label="Evidence retention">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-slate-100">Evidence retention</h2>
        <p className="mt-1 text-sm text-slate-400">Daily maintenance at 01:30 Europe/Dublin · The assessment below is read-only.</p></div>
      <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-100 disabled:opacity-50"
        disabled={busy} onClick={() => void refresh()}>{busy ? "Planning…" : plan ? "Refresh" : "Dry Run"}</button>
    </div>
    {error ? <p role="alert" className="mt-4 text-sm text-amber-200">{error}</p> : null}
    {!plan && !busy && !error ? <p className="mt-4 text-sm text-slate-400">Run a read-only assessment of stored evidence and retention holds.</p> : null}
    {plan ? <>
      <p className="mt-3 text-xs text-slate-400">{plan.policyVersion} · As of {new Date(plan.asOf).toLocaleString()} · {summary!.bundlesScanned} bundles scanned</p>
      {plan.reviewReasons.length ? <p role="alert" className="mt-3 text-sm text-amber-200">Review required: {plan.reviewReasons.join(", ")}. Eligibility is blocked.</p> : null}
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) =>
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3" key={label}>
          <dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm text-slate-100">{value}</dd>
        </div>)}</dl>
      <p className="mt-3 text-xs text-slate-400">Protection categories may overlap. {summary!.unreferencedObjects} unreferenced objects remain preserved. This assessment makes no changes to evidence.</p>
    </> : null}
  </section>;
}
