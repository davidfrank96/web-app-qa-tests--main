# QA quota safety and background traffic

This rollout targets only `kbean-qa-webapp` (DigitalOcean app `25bef95b-e762-4675-b850-65794c62aa10`) and QA Supabase `qdrhzdulhlkjhckosdrv`.

## Worker and scheduler contract

- Idle worker recovery and claiming use one service-role-only, invoker RPC with row locks and `SKIP LOCKED`. A repeated poll cannot claim an already-owned job. Expired pre-execution claims may retry within the existing attempt limit; expired running campaigns become abandoned and are never automatically rerun. Recovery notifications and run reconciliation still run in the worker.
- Empty polls back off through 1, 2, 4, 8, 16 and 30 seconds, capped at 30 seconds. Activity resets the backoff. Enqueue-to-claim is bounded by one remaining idle wait plus request/database/process scheduling overhead. SIGTERM interrupts idle sleep.
- Active worker heartbeat remains 15 seconds, lease 120 seconds and failure limit 3. Process termination and active campaign logic are unchanged.
- Scheduler evaluates every 60 seconds. Definitions load fresh at startup, refresh at most every 10 minutes of evaluation time, and are paginated. An expired cache is never used if refresh fails. Before enqueue, a fresh server read must match the cached configuration and due occurrence.
- Only confirmed queued/skipped occurrences are cached, at most one key per definition. Deferred/failed claims remain retriable; durable occurrence uniqueness and the one-active-job index remain authoritative across restarts and competing processes.
- Changed state, enqueue and errors are published immediately; unchanged durable status is written at least every 120 seconds through one RPC. It rejects superseded scheduler owners. Durable stale threshold remains 180 seconds. Local scheduler liveness records every successful minute evaluation; worker liveness remains bounded by its poll/active heartbeat, with the unchanged 60-second stale threshold.

## Non-destructive operational usage

The admin Operations panel reads `pg_database_size(current_database())` and `storage.objects` size metadata through a service-only, stable/invoker RPC, cached in the application for 60 seconds. It loads on opening Operations or explicit refresh; there is no recurring UI poll. Missing sizes produce `UNAVAILABLE`, not a false healthy result.

Operational ceilings are explicit non-secret configuration:

| Variable | Default bytes | Meaning |
| --- | ---: | --- |
| `QA_DATABASE_CEILING_BYTES` | 500,000,000 | Conservative decimal 500 MB database ceiling |
| `QA_STORAGE_CEILING_BYTES` | 1,000,000,000 | Conservative decimal 1 GB Storage ceiling |

These are operational guards, not a billing entitlement or egress/MAU/log-ingest API. Storage totals include all QA buckets; evidence totals identify `inssa-evidence`. Database size and object metadata may differ from billing presentation. Status is HEALTHY below 80%, WARNING from 80% through 90%, and CRITICAL above 90%.

CRITICAL offers the existing read-only retention assessment. Eligible/protected bytes are labeled with that assessment's timestamp. It never initiates deletion. The v3 30/60/90-day windows, holds, unresolved cleanup protection, review requirements, monthly cadence and current enablement remain unchanged.

Worker and scheduler REST request rates come from bounded five-minute process-local counters included in existing local liveness files. They issue no database writes. Only requests to the configured Supabase REST origin count; no credentials, query strings, bodies or user identifiers are stored. Stale processes show unavailable rates. These recent operational rates are separate from the release's hosted before/after log measurement.

## Production authentication rollout

Production remains disabled in provisioned definitions until deployed traffic measurements pass and designated `AUTH_MONITOR_PRODUCTION_EMAIL` / `AUTH_MONITOR_PRODUCTION_PASSWORD` are confirmed configured. Production never falls back to staging credentials. Required existing gates remain `AUTH_MONITOR_ALLOW_PRODUCTION=1` and `AUTH_MONITOR_PRODUCTION_CONFIRMATION=inssa.us`.

Production defaults to username/password only. Google and Apple stay disabled unless explicitly selected and configured. Staging defaults are unchanged. Production target must be exactly `https://inssa.us`; alternate hosts, ports, credentials in URLs, paths and query overrides fail closed. The production browser blocks unapproved writes: only Firebase password sign-in, account lookup, token refresh and Firestore read operations are permitted. Application writes, Firestore writes, signup, account changes, password reset and deletion are blocked. Production service workers and WebSockets are blocked so they cannot bypass the HTTP guard. A blocked request fails certification with diagnostics rather than permitting a mutation.

The flow signs in with an existing QA identity, verifies a persisted session and signs out. It never creates accounts or product data. Keep both staging and production noon/evening definitions at 12:00 and 18:00 Europe/Dublin, with their distinct IDs/occurrence keys. Provider results do not feed infrastructure health.

A clean password pass with explicitly disabled providers qualifies for the existing investigation-ready compact evidence profile, retaining provider status/timing and execution history. Retries, unexpected warnings and actual failures preserve full diagnostics. Retention classification remains v3: clean 30 days, warnings/retries 60, failures/security at least 90.

## Release verification

`dashboard/scripts/test-quota-database.mjs` creates and removes an isolated localhost-only fixture database. It exercises eight competing workers, recovery, service-only/RLS boundaries, scheduler ownership and nondestructive Storage metrics. CI also runs worker latency, scheduler cache/staleness, quota boundaries/admin UI, auth target/write-denial and compact-evidence regressions.

Hosted measurements must use equivalent quiet windows and include both table endpoints and replacement RPCs. Report observed REST counts and the corresponding request-log reduction; do not equate request reduction with measured billed log bytes. A Free-plan sustainability conclusion also needs storage growth and current platform limits, not request counts alone.
