# Platform Core v1.0 Release Notes

Release version: `1.0.0`

Documentation date: 2026-07-21

Certification state: **Engineering complete; production release blocked**

## Executive Summary

Platform Core v1.0 transforms the original command-driven INSSA Playwright harness into an authenticated QA Operations Platform without replacing the underlying test and campaign architecture.

The release adds durable execution, evidence management, persistence providers, monitoring definitions, a producer-only scheduler, authentication monitoring, Notification Outbox, SIEM integration, and an operator workspace. INSSA remains the only managed dashboard product.

## Architecture Summary

```text
Dashboard/Scheduler -> Durable Job -> Worker -> Existing Campaign
-> Immutable Run Output -> Evidence Bundle -> Reports/Storage/SIEM
```

The scheduler enqueues only. The worker executes only registry commands. Reports remain derived from evidence. External notification delivery is absent.

## Subsystem Summary

| Subsystem | Release state |
| --- | --- |
| Auth and RBAC | Implemented |
| Command registry and Campaign Library | Implemented |
| Durable jobs and worker | Implemented |
| Immutable run output | Implemented |
| Artifact compatibility | Implemented |
| Evidence Bundles and serving | Implemented |
| Private durable evidence Storage | Implemented |
| Evidence Workspace | Implemented |
| Reports | Implemented |
| Notification Outbox | Implemented; no delivery |
| Monitoring Framework | Implemented |
| Scheduler Trigger | Implemented |
| Authentication Monitoring | Implemented; production disabled by default |
| SIEM export | Implemented |
| Wazuh ingestion | Implemented and authenticated |
| Runtime/persistence/security hardening | Implemented |

## Deployment Checklist

The full gate is [Deployment Checklist](deployment-checklist.md). Required categories are repository security, dependencies, runtime, Supabase schema/RLS/storage, auth roles, worker/scheduler, evidence, SIEM ingestion, product safeguards, and rollback evidence.

## Known Limitations

- One active run globally.
- Governed lifecycle/security mutation is admin-only, staging-only, approval-gated, and requires manual cleanup confirmation.
- No external Notification Outbox dispatcher.
- No retention/archive/deletion engine.
- No automatic local/Supabase history migration.
- Dashboard bundle serving uses local filesystem evidence.
- Localman/KBean managed campaigns are not registered.
- Production authentication monitoring requires explicit credentials and confirmation.

See [Known Limitations](known-limitations.md).

## Security Status

Code-level security controls pass: dependency audits, authenticated ingestion, output redaction, canonical evidence path validation, auth/RBAC, and regression tests.

Production release is blocked because commit `3506a72a018f` contains historical share-token values. Required action is documented without exposing those values in [Platform Security Certification](platform-security-certification.md).

## Persistence Status

The ordered seven-migration chain and local persistence are certified. A target managed Supabase project must still apply the migrations, verify RLS/advisors, provision the private bucket, and execute an approved safe run before deployment certification.

## Upgrade Notes

- Root and dashboard versions are `1.0.0`.
- Use a clean dashboard build; do not reuse dev `.next` output for `next start`.
- Apply all migrations in order; do not manually patch managed schemas.
- Provider changes do not migrate data.
- Deploy Wazuh sender and ingestion with one unique credential.

## Release Verdict

Repository engineering status: **READY WITH BLOCKERS DOCUMENTED**.  
Production deployment verdict: **BLOCKED** pending security-history remediation and target-environment certification.
