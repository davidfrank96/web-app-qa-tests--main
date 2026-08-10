# Supabase Migration Guide

## Canonical Order

| Order | Migration | Owns |
| --- | --- | --- |
| 1 | `20260720_platform_core_persistence.sql` | Runs, logs, artifacts, audit events, evidence bundles/items, indexes, RLS/grants |
| 2 | `20260721_execution_foundation.sql` | Execution jobs, leases, active-job constraint, claim/recovery RPCs |
| 3 | `20260722_notification_outbox.sql` | Durable notification outbox |
| 4 | `20260723_monitoring_framework.sql` | Monitoring definitions and initial catalog |
| 5 | `20260724_scheduler_trigger.sql` | Schedule configuration, occurrence ledger, scheduler status |
| 6 | `20260725_authentication_monitoring.sql` | Authentication-monitor definitions |
| 7 | `20260802_admin_live_campaigns.sql` | Sanitized live execution context, cleanup metadata, and approval/preflight/cleanup audit events |
| 8 | `20260810123743_disable_staging_auth_monitor_schedule.sql` | First-deployment safety state: staging authentication monitoring remains available manually but is not scheduled |
| 9 | `20260810174608_deferred_cleanup_ledger_version_fix.sql` | Deferred-cleanup ledger, retention metadata, limits support, indexes, RLS, and service-role-only access; uniquely versions the migration after correcting the duplicate `20260802` identity |
| 10 | `20260810175709_execution_job_claim_timestamp_fix.sql` | Corrects the execution-job claim function's timestamp variable resolution after remote worker validation exposed a `timestamptz`/`timetz` comparison defect |

Dependencies flow only forward. No later migration recreates or replaces an earlier subsystem's function.

## Rules

1. Create migrations with `supabase migration new <name>`.
2. Never rename, reorder, or edit a migration after it is applied to a shared project.
3. Use a forward migration for schema changes.
4. Keep schema-version changes compatible with both local and Supabase stores.
5. Use `IF NOT EXISTS` only for replay safety, not to conceal schema drift.
6. Run `supabase db push --dry-run` before applying.
7. Run Supabase security and performance advisors after applying schema changes.

## Replay Certification

The current chain was applied to an empty PostgreSQL 18 database with Supabase roles represented, then replayed. Both passes succeeded. The certified result is:

- 12 public tables.
- 50 indexes including primary/unique backing indexes.
- 12 foreign keys.
- 20 primary/unique constraints.
- 50 check constraints.
- RLS enabled on all 12 tables.
- Zero anon/authenticated table privileges.
- Two service-role-only security-definer RPCs with empty search paths.
- Bucket provisioning is separately verified through `npm run persistence:provision` and the supported Storage API.

PostgreSQL replay validates SQL ordering, dependencies, constraints, functions, grants, and RLS flags. A linked Supabase project remains the authoritative validation for managed Storage and platform advisors.

## Drift Check

```bash
cd dashboard
npx supabase@latest migration list
npx supabase@latest db diff --linked
```

Expected result after a clean deployment: migration history is complete and the linked schema diff is empty.
