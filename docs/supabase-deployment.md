# Supabase Deployment Guide

## Scope

This guide provisions a new Supabase project for platform metadata and durable evidence. It does not create Auth users, alter campaign behavior, or enable production execution.

## Prerequisites

- A new Supabase project and project reference.
- Supabase CLI access through `npx supabase@latest` or an installed CLI.
- The project database password for linking.
- Server-only access to the generated service-role key.
- Node.js and repository dependencies installed.

## 1. Initialize And Link

From the repository root:

```bash
cd dashboard
npx supabase@latest init
npx supabase@latest link --project-ref "$SUPABASE_PROJECT_REF"
```

The repository now includes `supabase/config.toml`; do not reinitialize it. Linking requires the project database password and must identify the dedicated QA Platform project.

## 2. Preview And Apply Migrations

```bash
npx supabase@latest migration list
npx supabase@latest db push --dry-run
npx supabase@latest db push
```

Apply the complete ordered directory. Do not run individual SQL fragments in the dashboard SQL editor. The first migration creates core run/evidence tables; later migrations add execution, outbox, monitoring, scheduler, authentication-monitor definitions, and governed live-campaign execution/cleanup metadata.

## 3. Provision Supported Storage Resources

Use the repository provisioning command so Storage metadata is changed through the supported Storage API rather than direct SQL:

```bash
npm run persistence:provision
npm run persistence:verify
```

The command first verifies all 12 PostgREST table resources, then creates the configured bucket when absent and verifies it is private. It is idempotent and does not upload evidence. Hosted targets also require `SUPABASE_PROJECT_REF` to exactly match the project reference in `SUPABASE_URL`.

## 4. Preserve First-Deployment State

Create the checksummed historical development archive before importing hosted operational state:

```bash
npm run persistence:archive-development
```

Keep the resulting archive outside the repository and copy it to access-controlled off-host backup storage. It remains a historical development archive; it is not represented as Supabase evidence.

After migration and bucket verification, dry-run and then apply the narrowly scoped operational import:

```bash
npm run persistence:import-operational-state -- --archive-manifest=/absolute/path/archive-manifest.json
npm run persistence:import-operational-state -- --apply --archive-manifest=/absolute/path/archive-manifest.json
```

The importer preserves all nine deferred-cleanup records and the monitoring catalog, keeps the staging midday and evening Authentication Monitoring definitions enabled, forces production Authentication Monitoring definitions disabled, and intentionally imports no historical runs, logs, artifacts, evidence, execution jobs, outbox events, or scheduler occurrences.

## 5. Configure The Dashboard

Create `dashboard/.env.local` from `dashboard/.env.example` and set:

```text
NEXT_PUBLIC_SUPABASE_URL=<project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_URL=<project URL>
SUPABASE_ANON_KEY=<anon key when the project still uses legacy keys>
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
SUPABASE_PROJECT_REF=<exact QA Platform project reference>
INSSA_OPS_METADATA_STORE=supabase
INSSA_EVIDENCE_STORAGE_PROVIDER=supabase
INSSA_EVIDENCE_SUPABASE_BUCKET=inssa-evidence
INSSA_URL=https://staging.inssa.us
```

Never prefix the service-role variable with `NEXT_PUBLIC_` and never expose it to browser code, logs, CI artifacts, or screenshots.

For a hosted deployment, start from `dashboard/.env.production.example`, not a developer `.env.local` file.

## 6. Verify Schema And Storage

In the Supabase dashboard verify:

- 12 platform tables exist in `public`, including `cleanup_ledger`.
- RLS is enabled on all 12 tables.
- `inssa-evidence` exists and is private.
- No anon/authenticated policies expose platform tables or evidence objects.
- `claim_inssa_execution_job` and `recover_inssa_execution_job_records` exist.
- Seven monitoring definitions and the primary scheduler status row exist.

Then run:

```bash
cd ..
npm run dashboard:doctor
npm run platform:healthcheck
npm --prefix dashboard run test:execution-foundation
```

## 7. Operational Verification

Start the worker and dashboard through the existing supervisor, execute an approved safe run, and verify this chain:

```text
campaign_runs -> execution_jobs -> run_logs -> artifacts
-> evidence_bundles/evidence_items -> private Storage object
-> checksum verification -> dashboard bundle serving
```

Also verify that a completed run creates a notification-outbox record and that scheduler heartbeat/state persist.

## Rollback

Do not delete tables from a project containing evidence. For a failed brand-new bootstrap with no retained data:

1. Stop dashboard, worker, and scheduler.
2. Capture migration and application logs.
3. Delete the disposable Supabase project.
4. Correct the migration in source control.
5. Create a new empty project and replay the full chain.

For an established environment, create a forward migration. Never edit an already-applied migration or manually patch production SQL.
