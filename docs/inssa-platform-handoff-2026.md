# INSSA Platform Handoff 2026

Last updated: 2026-06-20

This document is the future-engineer handoff for the INSSA-focused QA Platform work.

## What Has Been Built

The repo now contains a reusable QA and Security Operations Platform with INSSA as the current focus.

Built capabilities:

- Playwright safe regression tests for INSSA.
- Live lifecycle tests for text, media, video, and reveal-later capsules.
- Lifecycle campaign runners for text, media, video, and reveal-later.
- Persistent lifecycle artifacts under `lifecycle-artifacts/`.
- Lifecycle campaign summaries under `lifecycle-campaigns/`.
- Artifact-driven authenticated discovery.
- Artifact-driven public share validation.
- Artifact-driven cleanup capability audit.
- OWASP-aligned security campaign.
- Security verification campaign.
- Cross-user campaign script.
- Reveal-later security campaign script.
- Security campaign artifacts under `security-campaigns/`.
- HTML report rendering under `reports/security/` and `reports/lifecycle/`.
- Metadata-only SIEM export under `reports/siem/`.
- Wazuh send script and ingestion service package.
- Wazuh decoder/rule/dashboard/runbook documentation.
- Next.js Operations Dashboard.
- Supabase Auth and server-side RBAC.
- Dashboard command registry.
- Dashboard runner with one active run.
- Dashboard run history/log/artifact metadata.
- Dashboard report archive and report file serving.
- Dashboard artifact validation workflow.
- Dashboard API failure diagnostics.

## Why It Was Built

The original harness was command-driven. The platform adds operational visibility and controlled execution without replacing the underlying Playwright/campaign architecture.

Main goals:

- make safe QA execution repeatable
- preserve lifecycle/security evidence
- support security and engineering review
- support artifact-driven validation
- produce human-readable reports
- export normalized metadata to Wazuh
- prepare for hosted private operations

## Current Dashboard Model

The dashboard is not the QA engine. It is an operations layer over the existing command architecture.

Current sections:

- Overview
- Safe Tests
- Security
- Lifecycle
- Artifact Validation
- Reports
- SIEM
- Operations
- Run History
- Run Details

Current executable commands:

- `test:inssa:safe`
- `test:inssa:campaign:security`
- `test:inssa:campaign:security:verify`
- `test:inssa:discovery`
- `test:inssa:public-share`
- `test:inssa:cleanup-audit`
- `report:security`
- `report:lifecycle`
- `siem:export`
- `platform:healthcheck`

Current visible but disabled actions:

- text lifecycle
- media lifecycle
- video lifecycle
- reveal-later lifecycle
- cross-user campaign
- reveal-later security
- SIEM send

## Current Roadmap

Phase A: Read-only V1

- Current phase.
- Safe tests, security, security verification, artifact validation, reports, SIEM export, operations.

Phase B: Controlled lifecycle execution

- Add approval workflow.
- Add cleanup acknowledgement.
- Start with one lifecycle type.
- Keep one active run.

Phase C: Cross-user and reveal-later execution

- Enable after lifecycle approval model exists.
- Require secondary-user and cleanup controls.
- Make reveal-later artifact creation/resume behavior explicit.

Phase D: SIEM send workflow

- Add endpoint preview.
- Add dry-run.
- Add payload summary.
- Add explicit confirmation.

Phase E: Deployment and operations maturity

- Hosted deployment.
- Artifact retention policy.
- Optional object storage.
- Scheduling for safe/read-only workflows.
- Multi-product dashboard support.

## Known Constraints

- INSSA production is blocked for live mutation/security lifecycle testing.
- The dashboard command runner requires `INSSA_URL=https://staging.inssa.us`.
- The runner is whitelist-only.
- The runner allows one active run.
- Artifact Validation requires lifecycle evidence.
- Reports are derived and not source-of-truth.
- SIEM export is metadata-only.
- SIEM send is CLI-supported but dashboard-disabled.
- Live lifecycle commands create staging data and require manual cleanup.
- Screenshots, videos, traces, and sensitive artifacts are indexed but not served by the dashboard in V1.

## Known Risks

- Live lifecycle artifacts indicate staging data may require manual cleanup.
- Some historical docs are evidence records and may not match current dashboard UX.
- Generated artifact directories contain environment-specific evidence and should remain ignored.
- Supabase metadata storage is supported by code but local JSON remains the default operational store unless explicitly configured.
- Dashboard expansion can drift into dashboard-first design if the architecture constitution is ignored.

## Approved Architectural Direction

Preserve:

- Playwright-first validation.
- Campaign runners as execution boundary.
- Artifacts as source of truth.
- Reports as derived views.
- SIEM as metadata output.
- Dashboard as thin operations layer.
- Server-side RBAC.
- Staging-only INSSA execution.
- Command registry.
- One-active-run model.
- Artifact validation selection.
- Sensitive artifact serving restrictions.

Do not casually change:

- runner architecture
- command registry model
- staging-only safeguards
- artifact indexing
- report serving allowlists
- auth/RBAC
- one-active-run behavior
- separation between campaigns, artifact validation, reports, SIEM, and operations

## First Actions For A Future Engineer

1. Read `README.md`.
2. Read `docs/qa-platform-architecture-constitution.md`.
3. Read `docs/inssa-platform-current-state.md`.
4. Read `docs/inssa-command-matrix.md`.
5. Run `npm run platform:healthcheck`.
6. Run `npm run dashboard:build`.
7. Start dashboard with `npm run dashboard:dev`.
8. Validate login/role resolution.
9. Run only `test:inssa:safe` first.
10. Do not enable live lifecycle commands until approval and cleanup workflows exist.

## Reference Docs

- [README](../README.md)
- [Architecture Constitution](qa-platform-architecture-constitution.md)
- [Current State](inssa-platform-current-state.md)
- [Dashboard Architecture](inssa-dashboard-architecture.md)
- [Command Matrix](inssa-command-matrix.md)
- [V1 Definition](inssa-v1-definition.md)
- [Dashboard Decisions](inssa-dashboard-decisions.md)
- [Dashboard Roadmap](inssa-dashboard-roadmap.md)

