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

Execution jobs use schema version `1` and persist an idempotency key, claim owner, attempt count, lease expiry, heartbeat, completion state, and optional lifecycle artifact selection. Only one queued, claimed, or running job is allowed globally. Only an expired pre-execution `claimed` job may return to `queued`; an expired `running` job becomes `abandoned` so a second campaign process can never overlap it. Worker startup reconciles abandoned jobs with nonterminal run records.

The local backend stores jobs in `dashboard/.data/execution-jobs.json` with an inter-process file lock. Supabase deployments use `execution_jobs`, its one-active-job constraint, and conditional REST updates for claim and recovery ownership. Legacy claim/recovery functions remain migration-managed but are not used by the worker because they can requeue an expired running campaign.

## Worker Operation

`npm run dashboard:dev` and `npm run dashboard:start` supervise Next.js and the worker as separate processes. `npm run dashboard:worker` runs the worker independently for process-manager deployments. Next.js only enqueues work and never owns a campaign subprocess.

Worker defaults:

- Poll interval: `INSSA_WORKER_POLL_MS=1000`
- Heartbeat: `INSSA_WORKER_HEARTBEAT_MS=15000`
- Consecutive heartbeat failure limit: `INSSA_WORKER_HEARTBEAT_FAILURE_LIMIT=3`
- Lease: `INSSA_WORKER_LEASE_MS=120000`
- Process termination grace period: `INSSA_WORKER_TERMINATION_GRACE_MS=10000`

The heartbeat loop is sequential and each Supabase request is bounded to ten seconds. Three consecutive transport failures terminate the owned campaign process tree before the 120-second lease can expire. Ownership loss is fatal immediately. On POSIX hosts, npm, Playwright, Chromium, and their descendants run in a dedicated process group; timeout or lease loss sends `SIGTERM` to that group, waits ten seconds, then sends `SIGKILL` if required.
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
