# Environment Setup

## Runtime

Use Node.js 22 LTS for the root test framework, dashboard, worker, scheduler, persistence tooling, and CI reproduction. The root and dashboard package engine declarations mark other major versions unsupported, and Runtime Doctor fails when the active major version is not 22.

## Environment Files

| File | Consumer | Commit policy |
| --- | --- | --- |
| `.env` | Root Playwright and CLI tools | Never commit |
| `.env.inssa.live-staging` | INSSA lifecycle/security campaign scripts | Never commit |
| `dashboard/.env.local` | Next.js, worker, scheduler, persistence | Never commit |
| `performance/k6/.env` | k6 authentication package | Never commit |
| `services/inssa-ingestion` systemd environment file | Wazuh ingestion host | Store outside repo with mode `0600` |

Templates are `.env.example`, `.env.inssa.live-staging.example`, `dashboard/.env.example`, and `performance/k6/.env.example`.

## Core Product Variables

| Variable | Required for | Notes |
| --- | --- | --- |
| `INSSA_URL` | INSSA CLI/dashboard | Standard execution must resolve to `https://staging.inssa.us`. |
| `LOCALMAN_URL` | Localman Playwright project | Defaults to local development. |
| `KBEAN_URL` | KBean Playwright project | Use an approved non-production target. |
| `INSSA_TEST_EMAIL`, `INSSA_TEST_PASSWORD` | Authenticated INSSA tests | Secret. |
| `INSSA_SECONDARY_TEST_EMAIL`, `INSSA_SECONDARY_TEST_PASSWORD` | Cross-user validation | Secret; optional outside that campaign. |

Live lifecycle gates and diagnostic variables are documented in `.env.inssa.live-staging.example`. They must remain explicit opt-ins.

The admin approval flow reads live campaign prerequisites from `.env.inssa.live-staging` plus the centralized dashboard process environment. The server always enforces `INSSA_URL=https://staging.inssa.us`; browser-supplied target overrides are ignored. Reveal resume paths are selected in the dashboard and injected by the runner through `INSSA_REVEAL_LATER_LIFECYCLE_ARTIFACT_PATH` or `INSSA_REVEAL_LATER_SECURITY_ARTIFACT_PATH`.

Every non-comment line in `.env.inssa.live-staging` must be a `NAME=value` assignment. Governed live preflight fails closed and reports only invalid line numbers when bare values or shell content are present.

## Dashboard Authentication And Roles

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preferred browser Auth key. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy browser-key fallback. |
| `SUPABASE_URL` | Server Supabase URL. |
| `SUPABASE_ANON_KEY` | Legacy Auth fallback only. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only persistence and Storage access. |
| `INSSA_OPS_VIEWER_EMAILS` | Optional viewer fallback allowlist. |
| `INSSA_OPS_OPERATOR_EMAILS` | Optional operator fallback allowlist. |
| `INSSA_OPS_ADMIN_EMAILS` | Optional admin fallback allowlist. |

`app_metadata.inssa_ops_role` takes precedence over allowlists. Unassigned authenticated users resolve to `viewer`.

## Persistence And Runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `INSSA_OPS_METADATA_STORE` | `local` | `local` or `supabase`. |
| `INSSA_EVIDENCE_STORAGE_PROVIDER` | `local` | `local` or `supabase`. |
| `INSSA_EVIDENCE_SUPABASE_BUCKET` | `inssa-evidence` | Private bucket. |
| `INSSA_WORKER_POLL_MS` | `1000` | Worker poll interval. |
| `INSSA_WORKER_LEASE_MS` | `30000` | Worker lease duration. |
| `INSSA_SCHEDULER_INTERVAL_MS` | `60000` | Scheduler evaluation interval. |
| `INSSA_QA_REPO_ROOT` | auto-detected | Explicit repository root for separated services/tests. |

Governed staging mutations also require the deferred-cleanup policy in `.env.inssa.live-staging`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `INSSA_DEFERRED_CLEANUP_MODE` | disabled | Allows another Admin mutation only when every unresolved object is identified, QA-owned, sanitized, and marked `deferred` or `cleanup_unavailable`. |
| `INSSA_TEST_ACCOUNT_IS_DEDICATED_QA` | disabled | Confirms the primary account is dedicated QA. |
| `INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA` | disabled | Confirms the secondary account is dedicated QA for cross-user/security runs. |
| `INSSA_MAX_UNRESOLVED_OBJECTS` | `10` | Fail-closed unresolved-object threshold. |
| `INSSA_MAX_UNRESOLVED_AGE_DAYS` | `90` | Maximum permitted unresolved age. |
| `INSSA_MAX_MUTATION_RUNS_PER_DAY` | `10` | UTC daily mutation-run limit. |
| `INSSA_UNRESOLVED_RETENTION_DAYS` | `90` | Default cleanup-ledger evidence retention target. |

`INSSA_DASHBOARD_MODE`, `INSSA_DASHBOARD_LOCK_TOKEN`, `HOSTNAME`, `INSSA_RUN_OUTPUT_DIR`, `PLAYWRIGHT_OUTPUT_DIR`, `PLAYWRIGHT_HTML_OUTPUT_DIR`, `INSSA_MUTATION_RECORDING`, `INSSA_MUTATION_RUN_ID`, `AUTH_MONITOR_ENVIRONMENT`, `AUTH_MONITOR_OUTPUT_DIR`, and `AUTH_MONITOR_RUN_ID` are supervisor/runner-managed internals. Do not set them for normal operation.

## Authentication Monitoring

Authentication Monitoring uses `AUTH_MONITOR_*` exclusively. Store these server-only values in `dashboard/.env.local`; the wrapper, worker, scheduler, and Next.js dashboard all load that centralized dashboard environment. `.env.inssa.live-staging` is not an Authentication Monitoring configuration source.

| Variable | Purpose |
| --- | --- |
| `AUTH_MONITOR_STAGING_EMAIL`, `AUTH_MONITOR_STAGING_PASSWORD` | Optional dedicated staging password account; falls back to `INSSA_TEST_*`. |
| `AUTH_MONITOR_STAGING_GOOGLE_EMAIL`, `AUTH_MONITOR_STAGING_GOOGLE_PASSWORD` | Required staging Google OAuth account. |
| `AUTH_MONITOR_STAGING_APPLE_EMAIL`, `AUTH_MONITOR_STAGING_APPLE_PASSWORD` | Required staging Apple Sign-In account. |
| `AUTH_MONITOR_PRODUCTION_EMAIL`, `AUTH_MONITOR_PRODUCTION_PASSWORD` | Required production password account. |
| `AUTH_MONITOR_PRODUCTION_GOOGLE_EMAIL`, `AUTH_MONITOR_PRODUCTION_GOOGLE_PASSWORD` | Required production Google OAuth account. |
| `AUTH_MONITOR_PRODUCTION_APPLE_EMAIL`, `AUTH_MONITOR_PRODUCTION_APPLE_PASSWORD` | Required production Apple Sign-In account. |

Production monitoring requires all of:

```text
AUTH_MONITOR_ALLOW_PRODUCTION=1
AUTH_MONITOR_PRODUCTION_CONFIRMATION=inssa.us
```

plus the relevant provider credentials. Production is disabled by default.

## SIEM Sender

| Variable | Purpose |
| --- | --- |
| `SIEM_WAZUH_URL` | Preferred HTTPS ingestion endpoint. |
| `SIEM_WAZUH_TOKEN` | Preferred bearer credential. |
| `SIEM_DRY_RUN=1` | Validate without sending. |
| `SIEM_SEND_BATCH=1` | Send a supported event batch. |

`WAZUH_WEBHOOK_URL`/`WAZUH_URL` and `WAZUH_API_TOKEN`/`WAZUH_TOKEN` are compatibility aliases. New deployments should use `SIEM_WAZUH_*`.

## Wazuh Ingestion Service

| Variable | Default | Purpose |
| --- | --- | --- |
| `INSSA_INGEST_SHARED_TOKEN` | none | Required, minimum 32 characters. |
| `INSSA_INGEST_HOST` | `127.0.0.1` | Bind address. |
| `INSSA_INGEST_PORT` | `8088` | Bind port. |
| `INSSA_INGEST_PATH` | `/inssa` | Request path. |
| `INSSA_INGEST_MAX_BODY_BYTES` | `1048576` | Request size limit. |
| `INSSA_INGEST_EVENT_LOG_PATH` | `/var/ossec/logs/inssa-qa.log` | Accepted events. |
| `INSSA_INGEST_REQUEST_LOG_PATH` | `/var/ossec/logs/inssa-qa-ingestion-requests.log` | Request audit. |
| `INSSA_INGEST_FAILURE_LOG_PATH` | `/var/ossec/logs/inssa-qa-ingestion-errors.log` | Failure log. |

`PLATFORM_HEALTHCHECK_INGESTION_URL` optionally overrides the endpoint used by the platform healthcheck.

## Validation

Never print values during validation.

```bash
npm run dashboard:doctor
npm run platform:healthcheck
npm run siem:send -- --dry-run
```

Use `git check-ignore -v` to confirm real environment and test-user files remain ignored.
