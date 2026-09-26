"use client";
import { useEffect, useState } from "react";
import type { OperationsUsage } from "../lib/inssa-ops/usage-status";
import type { RetentionPlan } from "../lib/inssa-ops/retention-types";
export function QuotaSummary({ plan, onDryRun, busy }: { plan: RetentionPlan | null; onDryRun: () => void; busy: boolean }) {
  const [usage, setUsage] = useState<OperationsUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/operations/usage", { cache: "no-store" });
      if (!response.ok) throw new Error("Usage metrics unavailable. Refresh to retry.");
      setUsage(await response.json());
    } catch (failure) { setUsage(null); setError(failure instanceof Error ? failure.message : "Usage unavailable"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
  const rate = (value: OperationsUsage["worker"]) => value ? `${value.requestsPerMinute.toFixed(2)} requests/min · ${(value.windowMs / 60_000).toFixed(1)} minute window` : "Unavailable / process stale";
  return <section aria-label="Free-plan usage" className="mb-5 border-b border-slate-700 pb-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-100">Free-plan usage</h2>
      <button type="button" className="rounded border border-slate-600 px-3 py-2 text-sm" disabled={loading} onClick={() => void refresh()}>{loading ? "Loading…" : "Refresh usage"}</button></div>
    {error ? <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p> : null}
    {usage ? <>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
        ["Database", `${usage.databaseStatus} · ${size(usage.databaseBytes)} / ${size(usage.databaseCeiling)}`],
        ["Storage", `${usage.storageStatus} · ${size(usage.storageBytes)} / ${size(usage.storageCeiling)}`],
        ["Current evidence", size(usage.evidenceBytes)],
        ["Eligible evidence", plan ? size(plan.summary.eligibleBytes) : "Run retention dry run"],
        ["Protected evidence", plan ? size(plan.summary.protectedBytes) : "Run retention dry run"],
        ["Worker REST requests", rate(usage.worker)], ["Scheduler REST requests", rate(usage.scheduler)]
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 text-sm text-slate-100">{value}</dd></div>)}</dl>
      {usage.storageStatus === "CRITICAL" || usage.databaseStatus === "CRITICAL" ? <div role="alert" className="mt-3 rounded border border-amber-600 p-3 text-sm text-amber-100">
        Usage exceeds 90% of an operational ceiling. Evidence is preserved. Review retention eligibility before any cleanup.
        <button type="button" className="ml-3 underline" disabled={busy} onClick={onDryRun}>Run retention dry run</button>
      </div> : null}
      <p className="mt-3 text-xs text-slate-400">As of {new Date(usage.at).toLocaleString()}. Configured Free-plan operational ceilings; object metadata totals exclude billing adjustments. {usage.unknownSizeObjects ? `${usage.unknownSizeObjects} object sizes unknown; Storage total is incomplete.` : ""} Quota warnings never delete evidence. {plan ? `Eligibility as of ${new Date(plan.asOf).toLocaleString()}.` : ""}</p>
    </> : null}
  </section>;
}
