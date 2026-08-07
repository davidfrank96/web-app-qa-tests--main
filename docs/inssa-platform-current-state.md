# INSSA QA Platform Current State

Last reviewed: 2026-08-02
Platform version: `1.0.0`

This document describes implemented repository behavior. It is not an aspirational roadmap.

## Platform Status

Platform Core v1.0 is implemented for local/internal operation. Runtime, worker, evidence, local persistence, monitoring, scheduler, and code-level security regression checks pass.

Production release remains blocked by the historical share-token exposure documented in [Platform Security Certification](platform-security-certification.md). Managed Supabase and live Wazuh deployment validation must also be completed for the target environment.

## Implemented Execution

- Dashboard APIs enqueue persistent execution jobs.
- The dedicated worker claims jobs using leases and heartbeats.
- One run may be queued, claimed, or running globally.
- Commands come only from the registry and execute with `shell:false`.
- Runs use immutable `run-output/<runId>/` directories and manifests.
- Logs persist incrementally and are redacted.
- Abandoned jobs recover or become abandoned according to attempt limits.

## Dashboard Workspaces

Current navigation:

1. Overview
2. Campaign Library
3. Testing
4. Security
5. Lifecycle
6. Execution
7. Artifact Validation
8. Reports, presented as the Evidence Workspace
9. SIEM
10. Authentication Monitoring
11. Monitoring
12. Notifications
13. Operations
14. Runs

The dashboard supports dark/light themes, responsive workspaces, API-failure diagnostics, metadata backend counts, and read-only monitoring/outbox views.

## Executable Dashboard Commands

| Registry key | npm script | Minimum role | Notes |
| --- | --- | --- | --- |
| `test_inssa_safe` | `test:inssa:safe` | operator | Non-mutating safe suite. |
| `test_inssa_campaign_text` | `test:inssa:campaign:text` | admin | Governed staging mutation; approval and cleanup required. |
| `test_inssa_campaign_media` | `test:inssa:campaign:media` | admin | Governed staging mutation; media preflight required. |
| `test_inssa_campaign_video` | `test:inssa:campaign:video` | admin | Governed staging mutation; video preflight required. |
| `test_inssa_campaign_reveal_later` | `test:inssa:campaign:reveal-later` | admin | Explicit create/resume mode; cleanup required. |
| `test_inssa_campaign_cross_user` | `test:inssa:campaign:cross-user` | admin | Distinct primary/secondary accounts required. |
| `test_inssa_campaign_reveal_later_security` | `test:inssa:campaign:reveal-later-security` | admin | Explicit create/resume mode and distinct accounts required. |
| `test_inssa_campaign_security` | `test:inssa:campaign:security` | operator | Read-only OWASP campaign. |
| `test_inssa_campaign_security_verify` | `test:inssa:campaign:security:verify` | operator | Existing-evidence verification. |
| `test_inssa_discovery` | `test:inssa:discovery` | operator | Requires lifecycle artifact. |
| `test_inssa_public_share` | `test:inssa:public-share` | operator | Requires lifecycle artifact. |
| `test_inssa_cleanup_audit` | `test:inssa:cleanup-audit` | operator | Requires lifecycle artifact; no cleanup mutation. |
| `report_security` | `report:security` | operator | Re-renders existing findings. |
| `report_lifecycle` | `report:lifecycle` | operator | Re-renders existing evidence. |
| `siem_export` | `siem:export` | operator | Metadata-only export. |
| `platform_healthcheck` | `platform:healthcheck` | admin | Admin-only. |
| `monitor_inssa_auth_staging` | `test:inssa:monitor:auth:staging` | operator | Real provider flows against staging. |
| `monitor_inssa_auth_production` | `test:inssa:monitor:auth:production` | operator | Requires production confirmation guard. |

## Disabled Or Hidden Execution

Visible but disabled:

- SIEM send

Hidden:

- broad project runners
- raw lifecycle and mutation specs
- campaign-plus-SIEM wrappers
- arbitrary commands

Governed live commands use an admin-only approval modal and repeat preflight server-side before job creation. They are fixed to `https://staging.inssa.us`, use one durable attempt, record sanitized execution context, and create a run-owned cleanup manifest. Cleanup remains manual and must be confirmed by an admin.

## Artifact Validation

Authenticated Discovery, Public Share Validation, and Cleanup Capability Audit consume an explicit or latest validation-ready lifecycle artifact. The dashboard blocks execution when no successful artifact with usable retrieval evidence exists. These commands do not create capsules.

## Evidence

- Artifact remains the compatibility API model.
- Every new completed run groups indexed artifacts into an Evidence Bundle.
- Evidence Items preserve relative paths, hashes, sizes, sensitivity, type, and storage metadata.
- Playwright reports are served as authenticated bundles with relative assets.
- Evidence paths are canonicalized with `realpath` and reject traversal/symlink escape.
- The Evidence Workspace previews supported items and shows chain-of-custody metadata.
- Historical runs are not automatically backfilled into new bundle metadata.

## Persistence

- Local metadata: versioned JSON, JSON Lines logs, file locking, atomic rename.
- Supabase metadata: 11 tables, RLS enabled, service-role-only access.
- Local evidence: run-scoped filesystem output.
- Durable evidence: private Supabase Storage with immutable keys and size/SHA-256 verification.
- Provider switching does not migrate data.
- Current dashboard serving remains filesystem-backed even when a durable copy exists.

## Monitoring And Notifications

- The Monitoring Framework stores product-aware definitions and policies.
- The scheduler supports hourly, daily, and weekly schedules and persists occurrence claims.
- The scheduler only enqueues jobs.
- The Notification Outbox persists execution/recovery events and exposes read-only APIs/UI.
- No email, SMS, Slack, Teams, webhook, or push delivery is implemented.
- Authentication Monitoring independently records password, Google, and Apple results.
- Production authentication monitors are seeded disabled.

## Authentication And Authorization

- Supabase Auth supports password and magic-link flows.
- UI and APIs require authentication.
- Roles are `viewer`, `operator`, and `admin`.
- Role source order: `app_metadata.inssa_ops_role`, environment allowlist, fallback viewer.
- Authorization is server-side.
- Audit events cover login/logout, run requests/outcomes, denial, unauthorized access, and role violations.

## SIEM

- `siem:export` produces metadata-only JSON.
- CLI `siem:send` requires an HTTPS endpoint and bearer credential.
- The dashboard send action remains disabled.
- The ingestion service refuses startup without a strong shared credential and writes accepted JSONL to Wazuh's monitored log.

## Known Limitations

See [Known Limitations](known-limitations.md). Material items are no retention/archive/deletion engine, no provider notification delivery, no local-to-Supabase migration tool, no direct durable-object serving, gated lifecycle mutation, and unresolved release security actions.

## Sources Of Truth

- [README](../README.md)
- [Architecture Constitution](qa-platform-architecture-constitution.md)
- [Command Matrix](inssa-command-matrix.md)
- [Subsystem Summary](subsystem-summary.md)
- [Documentation Index](README.md)
