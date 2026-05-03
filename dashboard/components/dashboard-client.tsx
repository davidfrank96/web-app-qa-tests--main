"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { LocalManDashboardPayload, ResultStatus, RouteRow } from "../lib/localman-dashboard";

type DashboardClientProps = {
  initialData: LocalManDashboardPayload;
};

export function DashboardClient({ initialData }: DashboardClientProps) {
  const [data, setData] = useState(initialData);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [slowOnly, setSlowOnly] = useState(false);
  const deferredFailuresOnly = useDeferredValue(failuresOnly);
  const deferredSlowOnly = useDeferredValue(slowOnly);

  useEffect(() => {
    const controller = new AbortController();

    const refresh = async () => {
      try {
        const response = await fetch("/api/localman-results", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          return;
        }

        const nextData = (await response.json()) as LocalManDashboardPayload;
        startTransition(() => {
          setData(nextData);
        });
      } catch {
        return;
      }
    };

    const interval = window.setInterval(refresh, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const visibleRows = useMemo(() => {
    return data.rows.filter((row) => {
      if (deferredFailuresOnly && row.status !== "fail") {
        return false;
      }

      if (deferredSlowOnly && row.status !== "slow") {
        return false;
      }

      return true;
    });
  }, [data.rows, deferredFailuresOnly, deferredSlowOnly]);

  return (
    <main className="dashboard-grid min-h-screen px-4 py-6 text-ink md:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <section className="mb-8 overflow-hidden rounded-[2rem] border border-line/70 bg-panel/90 shadow-panel backdrop-blur">
          <div className="grid gap-8 px-6 py-8 md:grid-cols-[1.35fr_0.65fr] md:px-8">
            <div>
              <div className="mb-5 inline-flex items-center gap-3 rounded-full border border-ink/10 bg-ink px-4 py-2 text-xs uppercase tracking-[0.28em] text-canvas">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent animate-pulseLine" />
                Local Man QA
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] md:text-6xl">
                Operational visibility for the Local Man smoke and abuse suite.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted md:text-base">
                Every recorded Local Man test is normalized into a live route/status surface. Failures stay loud,
                slow paths stay visible, and the dashboard refreshes directly from the JSON report file.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-ink/10 bg-canvas/85 p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-muted">Feed Status</p>
              <div className="mt-4 space-y-4">
                <MetricBlock label="Last refresh" value={formatTimestamp(data.generatedAt)} />
                <MetricBlock label="Visible rows" value={String(visibleRows.length)} />
                <MetricBlock label="Source file" value="reports/localman-results.json" mono />
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8 grid gap-4 md:grid-cols-4">
          <OverviewCard label="Total Tests" value={data.overview.total} status="pass" />
          <OverviewCard label="Pass / Fail / Flaky" value={`${data.overview.pass} / ${data.overview.fail} / ${data.overview.flaky}`} status={data.overview.fail > 0 ? "fail" : data.overview.flaky > 0 ? "slow" : "pass"} />
          <OverviewCard label="Avg Load Time" value={`${data.overview.avgLoadTimeMs}ms`} status={data.overview.avgLoadTimeMs > 5000 ? "slow" : "pass"} />
          <OverviewCard label="Slow Tests" value={data.overview.slow} status={data.overview.slow > 0 ? "slow" : "pass"} />
        </section>

        <section className="mb-8 rounded-[1.75rem] border border-line/70 bg-panel/90 p-5 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted">Feature Health</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Surface-level stability by feature</h2>
            </div>
            <div className="hidden text-sm text-muted md:block">Green = healthy, yellow = slow, red = broken</div>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            {data.featureHealth.map((feature) => (
              <div key={feature.feature} className="rounded-[1.4rem] border border-ink/10 bg-canvas/80 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-muted">{feature.label}</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                      {feature.count > 0 ? feature.score : "—"}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted">
                      Health Score
                    </p>
                    <p className="mt-3 text-2xl font-semibold">
                      {feature.status === "pass" ? "✅" : feature.status === "slow" ? "⚠️" : feature.status === "fail" ? "❌" : "—"}
                    </p>
                  </div>
                  <StatusBadge status={feature.status} />
                </div>
                <p className="mt-4 text-sm text-muted">
                  {feature.count} tests
                  {feature.flaky > 0 ? ` • ${feature.flaky} flaky` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-line/70 bg-panel/90 p-5 shadow-panel">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted">Route Table</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Latest route and test state</h2>
            </div>

            <div className="flex flex-wrap gap-3">
              <FilterToggle
                active={failuresOnly}
                label="Show failures only"
                onToggle={() => setFailuresOnly((current) => !current)}
              />
              <FilterToggle
                active={slowOnly}
                label="Show slow tests"
                onToggle={() => setSlowOnly((current) => !current)}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.35rem] border border-ink/10">
            <div className="hidden grid-cols-[1.55fr_0.35fr_0.35fr_1fr] gap-4 bg-ink px-4 py-3 text-xs uppercase tracking-[0.24em] text-canvas md:grid">
              <div>Route</div>
              <div>Status</div>
              <div>Load Time</div>
              <div>Errors</div>
            </div>

            <div className="divide-y divide-line/70 bg-canvas/75">
              {visibleRows.length === 0 ? (
                <div className="px-4 py-10 text-sm text-muted">No rows match the active filters.</div>
              ) : (
                visibleRows.map((row) => <RouteTableRow key={`${row.test}-${row.timestamp}`} row={row} />)
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function OverviewCard({
  label,
  status,
  value
}: {
  label: string;
  status: ResultStatus;
  value: number | string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-line/70 bg-panel/90 p-5 shadow-panel">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.24em] text-muted">{label}</p>
        <StatusBadge status={status} />
      </div>
      <p className="mt-6 text-3xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function MetricBlock({
  label,
  mono,
  value
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div>
      <p className="text-[0.7rem] uppercase tracking-[0.24em] text-muted">{label}</p>
      <p className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function FilterToggle({
  active,
  label,
  onToggle
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      className={`rounded-full px-4 py-2 text-sm transition ${
        active ? "bg-ink text-canvas" : "bg-canvas text-ink ring-1 ring-ink/10"
      }`}
      type="button"
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

function RouteTableRow({ row }: { row: RouteRow }) {
  return (
    <div className="grid gap-4 px-4 py-4 md:grid-cols-[1.55fr_0.35fr_0.35fr_1fr] md:items-start">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-ink px-2.5 py-1 text-xs uppercase tracking-[0.2em] text-canvas">
            {row.feature}
          </span>
          {row.flaky ? <span className="rounded-full bg-slow/15 px-2.5 py-1 text-xs text-amber-800">Flaky</span> : null}
        </div>
        <p className="mt-3 font-mono text-sm text-ink">{row.route}</p>
        <p className="mt-1 text-sm leading-6 text-muted">{row.test}</p>
      </div>

      <div className="md:pt-1">
        <StatusBadge status={row.status} />
      </div>

      <div className="md:pt-1">
        <p className="text-sm font-semibold text-ink">{row.avgLoadTimeMs}ms</p>
      </div>

      <div className="space-y-2">
        {row.errors.length === 0 ? (
          <p className="text-sm text-muted">No errors captured.</p>
        ) : (
          row.errors.slice(0, 3).map((error, index) => (
            <p key={`${row.test}-${index}`} className="rounded-2xl bg-fail/8 px-3 py-2 text-xs leading-5 text-fail">
              {error}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ResultStatus | "none" }) {
  const label = status === "pass" ? "Healthy" : status === "slow" ? "Slow" : status === "fail" ? "Broken" : "No data";
  return <span className={`status-${status} rounded-full px-3 py-1 text-xs font-medium`}>{label}</span>;
}

function formatTimestamp(timestamp: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(timestamp));
  } catch {
    return timestamp;
  }
}
