# QA Execution Foundation

## Purpose

The execution foundation separates HTTP request handling from campaign execution. The dashboard validates and enqueues approved commands; a dedicated worker claims durable jobs and executes the existing npm command registry without changing campaign or Playwright logic.

```text
Dashboard POST /api/runs
        |
        v
Campaign run + durable execution job
        |
        v
Dedicated worker claim + lease + heartbeat
        |
        v
Existing npm/Playwright command
        |
        v
run-output/<runId>/evidence-manifest.json
        |
        v
Artifact metadata -> Evidence Bundle -> Durable Storage
```

## Job Ownership

Execution jobs use schema version `1` and persist an idempotency key, claim owner, attempt count, lease expiry, heartbeat, completion state, and optional lifecycle artifact selection. Only one queued, claimed, or running job is allowed globally. An expired lease is returned to `queued` while attempts remain; otherwise it becomes `abandoned`.

The local backend stores jobs in `dashboard/.data/execution-jobs.json` with an inter-process file lock. Supabase deployments use `execution_jobs` and atomic claim/recovery functions from `dashboard/supabase/migrations/20260721_execution_foundation.sql`.

## Worker Operation

`npm run dashboard:dev` and `npm run dashboard:start` supervise Next.js and the worker as separate processes. `npm run dashboard:worker` runs the worker independently for process-manager deployments. Next.js only enqueues work and never owns a campaign subprocess.

Worker defaults:

- Poll interval: `INSSA_WORKER_POLL_MS=1000`
- Lease: `INSSA_WORKER_LEASE_MS=30000`
- Heartbeat: one third of the lease duration
- Maximum attempts: `2`

## Run Isolation

Every worker-owned run writes to `run-output/<runId>/`. Playwright HTML and test output are directed there. Legacy report/campaign outputs produced during the run are copied into the run root before indexing. The worker writes `evidence-manifest.json` with file type, MIME type, size, and SHA-256.

New artifact metadata references the immutable run path. Historical report and bundle routes derive their filesystem root from that artifact record, so they do not resolve through mutable `playwright-report/` or `reports/` aliases. Existing historical artifact records remain supported.

## Persistence

Local run logs are appended incrementally as JSON Lines under `dashboard/.data/run-logs/`; legacy logs in `inssa-runs.json` remain readable. Snapshot writes and execution-job writes use inter-process locks and atomic rename. Supabase log sequencing reads only the latest sequence instead of loading every log row.

## API Compatibility And Pagination

Existing response fields remain unchanged. Pagination metadata is additive:

- `GET /api/runs?limit=<n>&cursor=<offset>`
- `GET /api/runs/:id/logs?after=<sequence>&limit=<n>`
- `GET /api/runs/:id/artifacts?limit=<n>&cursor=<offset>`
- `GET /api/runs/:id/evidence?limit=<n>&cursor=<offset>`

Requests without pagination parameters continue to return the full compatibility collections used by the current dashboard.

`POST /api/runs` accepts an optional `Idempotency-Key` header. Repeating the same key returns the existing run instead of executing it again.

## Deployment Requirement

Supabase metadata deployments must apply the complete ordered migration directory, beginning with `20260720_platform_core_persistence.sql`, before starting the worker. The execution migration depends on `campaign_runs` and adds service-role-only claim/recovery RPCs. The worker requires the same environment and repository filesystem access as the dashboard, including Playwright browsers and the approved staging configuration. See [Supabase Deployment](./supabase-deployment.md).
