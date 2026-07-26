# Platform Persistence Architecture

Last certified: 2026-07-21

## Purpose

The QA Operations Platform supports two persistence modes without changing runner, worker, scheduler, evidence, or dashboard workflows:

- Local JSON for development and recovery.
- Supabase Postgres plus private Supabase Storage for durable deployments.

The mode is selected with `INSSA_OPS_METADATA_STORE`. All Supabase metadata access is server-side and requires `SUPABASE_SERVICE_ROLE_KEY`; browser publishable/anon keys are used for Auth only.

```text
Dashboard API / Worker / Scheduler
                 |
                 v
        Persistence interfaces
          /              \
 Local JSON + JSONL     Supabase Postgres
 Local run output       Private Storage bucket
```

## Persistent Components

| Component | Local | Supabase | Schema Version |
| --- | --- | --- | --- |
| Runs, artifacts, audit, evidence metadata | `dashboard/.data/inssa-runs.json` | `campaign_runs`, `artifacts`, `audit_events`, `evidence_bundles`, `evidence_items` | Local `2`; SQL rows `1` |
| Incremental logs | `dashboard/.data/run-logs/*.jsonl` | `run_logs` | SQL rows `1` |
| Execution jobs | `dashboard/.data/execution-jobs.json` | `execution_jobs` | `1` |
| Notification outbox | `dashboard/.data/notification-outbox.json` | `notification_outbox` | `1` |
| Monitoring definitions | `dashboard/.data/monitoring-definitions.json` | `monitoring_definitions` | `1` |
| Scheduler ledger and status | `dashboard/.data/scheduler-state.json` | `monitoring_schedule_occurrences`, `scheduler_runtime_status` | `1` |
| Evidence bytes | `run-output/<runId>/` | private `inssa-evidence` bucket | Manifest `1` |

Campaign definitions remain in the command registry. Durable campaign metadata is captured by `campaign_runs.campaign_key`, `campaign_runs.command_snapshot`, and `monitoring_definitions.campaign_id`; there is no duplicate campaign-definition table.

## Relationship Model

```text
campaign_runs
  |-- run_logs                 ON DELETE CASCADE
  |-- artifacts                ON DELETE CASCADE
  |-- evidence_bundles         ON DELETE CASCADE
  |     |-- evidence_items     ON DELETE CASCADE
  |-- execution_jobs           ON DELETE CASCADE
  |-- audit_events             ON DELETE SET NULL
  |-- notification_outbox      ON DELETE SET NULL
  `-- schedule occurrences     ON DELETE SET NULL

monitoring_definitions
  `-- schedule occurrences     ON DELETE CASCADE
```

Evidence bundle source-artifact references use `ON DELETE SET NULL`. Evidence item artifact references use `ON DELETE CASCADE`, matching atomic artifact/evidence re-indexing.

## Consistency And Idempotency

- Run logs have unique `(run_id, sequence)` ordering.
- Artifacts have unique `(run_id, file_path)` identity.
- Evidence items have unique `(bundle_id, relative_path)` identity.
- Execution jobs have unique run and idempotency keys, plus one global active-job index.
- Notification events have a unique deduplication key.
- Scheduler occurrences have a unique occurrence key.
- Migrations and catalog seeds are replay-safe.
- Local snapshot writes use inter-process locks, temporary files, and atomic rename.
- Unsupported future local schema versions fail closed instead of being silently rewritten.

## Security Boundary

Every platform table has RLS enabled. The repository intentionally creates no anon or authenticated table policy because dashboard clients never access persistence tables directly. Grants are:

- `service_role`: table access and execution-job RPC access.
- `anon`: no platform table access.
- `authenticated`: no platform table access.
- `PUBLIC`: no platform table access.

The security-definer execution RPCs use an empty `search_path` and schema-qualified objects. The service role key must remain server-only.

## Storage Boundary

The `inssa-evidence` bucket is private and is created idempotently through the supported Storage API by `npm run persistence:provision`. Objects use immutable run-scoped keys:

```text
inssa/<environment>/<campaignKey>/<runId>/<bundleId>/<relativePath>
```

Uploads use `upsert=false`. A retry may accept an existing object only after its size and SHA-256 match the evidence item metadata. No anon/authenticated `storage.objects` policy is created.

## Switching Backends

Changing `INSSA_OPS_METADATA_STORE` changes the active metadata backend; it does not migrate data. Local and Supabase stores may therefore contain different histories. Export/import between backends is not implemented and must not be inferred from a configuration switch.

If Supabase mode is selected without the URL and service-role key, startup and persistence fail explicitly. There is no silent anon-key or local fallback. Evidence remains local only when the storage provider is explicitly `local`; a failed configured upload is recorded as failed while local run output remains intact.

## References

- [Supabase Deployment](./supabase-deployment.md)
- [Migration Guide](./supabase-migration-guide.md)
- [Evidence Storage Guide](./evidence-storage-guide.md)
- [Persistence Certification](./platform-persistence-certification.md)
- [Execution Foundation](./qa-execution-foundation.md)
