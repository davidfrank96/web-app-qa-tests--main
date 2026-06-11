# INSSA Dashboard Roadmap

Last updated: 2026-06-11

This roadmap describes the local INSSA QA Operations Dashboard, not Wazuh dashboards. It separates completed V1 work from future live-mutation and automation work.

## Phase A: Read-Only V1 Completion

Status: completed/in validation

Purpose: make the dashboard useful for safe operations without exposing live mutation commands.

Completed:

- Supabase authentication for UI and APIs.
- Server-side RBAC with `viewer`, `operator`, and `admin`.
- Whitelisted command registry.
- Runner service with one active run globally.
- Run metadata persistence.
- Incremental run logs.
- Artifact indexing after runs.
- Report archive and report file serving for allowlisted report types.
- Dashboard diagnostics for metadata backend and API failures.
- Action-based navigation:
  - Overview
  - Safe Tests
  - Security
  - Lifecycle
  - Artifact Validation
  - Reports
  - SIEM
  - Operations
- Safe Tests dedicated action card.
- Security action selector.
- Lifecycle disabled-action selector.
- Artifact Validation selector with latest/explicit artifact selection.
- Reports categorized into Playwright, Security, Lifecycle, and SIEM.
- SIEM export action selector with send disabled.
- Operations healthcheck.

Current validation focus:

- Ensure every currently exposed command follows:
  - run created
  - logs visible
  - artifacts visible
  - report links visible when available
- Confirm disabled commands remain non-executable.
- Confirm report archive scales without page growth.

## Phase B: Controlled Expansion

Status: future

Purpose: expand beyond read-only V1 without losing safety boundaries.

Candidate work:

- Explicit approval workflow for live lifecycle commands.
- Enable Text Lifecycle only after approval UX and cleanup confirmation exist.
- Add lifecycle run preflight that summarizes:
  - staging target
  - required flags
  - cleanup target expectation
  - one-capsule-per-run behavior
- Add SIEM send confirmation and dry-run preview.
- Add artifact download policy for non-sensitive JSON exports only.
- Add dashboard API reference documentation.
- Add dashboard visual regression checklist.
- Add Supabase metadata migration package if the local JSON store is replaced.

Phase B should not add:

- Scheduling.
- Automatic cleanup.
- Broad live staging mega-runner.
- Multi-product support.
- Arbitrary command execution.

## Phase C: Operations Automation

Status: future

Purpose: support mature hosted operation after V1 and controlled expansion are stable.

Candidate work:

- Scheduled safe runs.
- Scheduled read-only security verification.
- SIEM send automation after explicit policy is approved.
- Artifact retention and pruning policy.
- Object-storage backed report/evidence serving.
- Notification integration for failed safe/security runs.
- Multi-product command namespaces.
- Admin controls for enabling live mutation workflows by environment.

Phase C should preserve:

- Command whitelist.
- Staging-only execution.
- One active live mutation guard unless a reviewed queue model exists.
- Server-side RBAC.
- Report/evidence separation.

## Completed Work By Architecture Area

| Area | Completed |
| --- | --- |
| Authentication | Supabase Auth for UI/API. |
| Authorization | viewer/operator/admin server-side checks. |
| Runner | Whitelist-only execution, timeout, log capture, one active run. |
| Metadata | Local JSON backend and optional Supabase backend support. |
| Artifacts | Metadata indexing from known output roots. |
| Reports | Security/lifecycle/playwright/SIEM archive and file serving. |
| Artifact Validation | Existing lifecycle artifact selection before execution. |
| SIEM | Metadata export exposed; send intentionally disabled in dashboard. |
| UI | Action-based navigation aligned with platform architecture. |

## In-Progress Work

- Documentation refresh and source-of-truth consolidation.
- Dashboard V1 validation.
- Stale documentation triage.

## Future Work

- Approval workflow for live lifecycle commands.
- SIEM send confirmation.
- Formal artifact retention policy.
- Supabase metadata migrations and hosted deployment runbook.
- Dashboard API reference.

