# Platform Persistence Certification

Certification date: 2026-07-21

## Verdict

Status: **CERTIFIED WITH MANAGED-SERVICE VALIDATION NOTE**

The repository now contains a complete, ordered, replay-safe persistence layer for all implemented platform subsystems. Local persistence and SQL migration replay are certified. Existing authenticated Supabase evidence upload is already certified. A disposable remote Supabase project was not created during this sprint; a deployment owner must run the documented linked-project migration/advisor verification before promoting a new managed environment.

The currently configured project was checked read-only. All 12 platform metadata REST resources return `404`, including the deferred-cleanup ledger, confirming that this migration chain has not been applied there. The active configuration remains `local` for metadata and evidence, so current local operation is not broken. Do not set `INSSA_OPS_METADATA_STORE=supabase` or the Supabase evidence provider on that project until migrations and private-bucket verification pass.

## Migration Report

- Six ordered migrations.
- No missing table dependency.
- No duplicate migration filename.
- No duplicate execution RPC ownership.
- No orphan platform table.
- Full migration replay succeeded twice on an empty PostgreSQL cluster.

## Schema Report

| Area | Result |
| --- | --- |
| Tables | 11/11 present |
| Primary/unique constraints | 18 |
| Foreign keys | 12 |
| Check constraints | 44 |
| Indexes | 45 including primary/unique backing indexes |
| Schema versions | Explicit on all platform records |
| Seed state | 7 monitors; 1 scheduler status row |

## RLS Report

- RLS enabled on all 11 public platform tables.
- `anon` table access: none.
- `authenticated` table access: none.
- `service_role` table access: present.
- Execution RPCs: service-role-only, security definer, empty search path.
- Dashboard users access persistence through authenticated server APIs, not direct table policies.

## Storage Report

- Default bucket: `inssa-evidence`.
- Bucket visibility: private.
- Provisioning: idempotent `npm run persistence:provision` through the supported Storage API.
- Browser policies: none.
- Object keys: immutable run/bundle paths.
- Upload overwrite: disabled.
- Retry acceptance: only after size and SHA-256 equality.
- Postgres binary storage: none.

## Local Persistence Report

- Run metadata legacy schema `1` upgrades to schema `2` on write.
- Unknown future run schemas are rejected.
- Unknown execution-job and outbox schemas are rejected.
- Monitoring and scheduler schema checks remain enforced.
- JSON snapshots use locking and atomic rename.
- Logs remain incremental JSON Lines.
- Switching providers does not imply data migration.

## Validation

| Validation | Result |
| --- | --- |
| Empty SQL migration replay | PASS |
| Second idempotent replay | PASS |
| RLS/grant inspection | PASS |
| Constraint/function inspection | PASS |
| Local persistence and provisioning tests | PASS, 14/14 |
| Existing durable evidence upload certification | PASS, see `EVIDENCE_SYSTEM_CERTIFICATION.md` |
| Remote disposable Supabase replay | Not run; no approved disposable project was available |
| Configured Supabase project read-only check | Bucket present; 11/11 metadata tables not yet deployed |
| Persistence provisioning command | Static validation PASS; managed verification correctly blocks on missing tables |
| Supabase security/performance advisors | Required after linked-project deployment |

## Regression Report

No API response, runner, worker, scheduler, campaign, report, authentication, authorization, evidence model, or dashboard workflow was redesigned. The only runtime changes are persistence safety controls:

- Supabase persistence requires service-role credentials.
- Unsupported local schema versions fail closed.
- Durable evidence cannot overwrite historical objects.
- Runtime Doctor fails early for incomplete enabled Supabase persistence.

## Release Gate

A new managed deployment passes this gate only after:

1. `supabase db push --dry-run` and `supabase db push` succeed.
2. Migration history and schema diff are clean.
3. Supabase security and performance advisors have no unresolved persistence finding.
4. Runtime Doctor and platform healthcheck pass.
5. One approved safe run persists jobs, logs, artifacts, evidence, outbox records, and a verified private object.
