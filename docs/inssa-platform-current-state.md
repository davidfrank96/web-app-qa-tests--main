# INSSA QA Platform Current State

Last updated: 2026-06-20

This document is the current source-of-truth snapshot for the INSSA QA Operations Platform as implemented in this repository. It describes the dashboard, runner, command exposure, artifacts, reporting, and SIEM integration based on the repo state, not aspirational design.

For governing architecture rules, see [QA Platform Architecture Constitution](qa-platform-architecture-constitution.md).

## What Exists

- Playwright QA harness for hosted INSSA staging at `https://staging.inssa.us`.
- Next.js Operations Dashboard under `dashboard/`.
- Supabase-backed authentication for the dashboard UI and APIs.
- Server-side RBAC with `viewer`, `operator`, and `admin` roles.
- Central dashboard command registry in `dashboard/lib/inssa-ops/command-registry.ts`.
- Runner service that executes whitelisted commands only.
- One active dashboard run globally; no queue.
- Run metadata, logs, artifacts, and audit events persisted through the run store.
- Local JSON metadata backend by default, with Supabase metadata backend support when configured.
- Artifact indexing after each run.
- Authenticated report and artifact file serving for allowlisted report roots only.
- Artifact Validation commands that consume selected lifecycle artifacts.
- Metadata-only SIEM export and optional Wazuh send script.
- Wazuh ingestion service and documentation.
- Wazuh dashboard, rule, decoder, alert-routing, and operations documentation.

## What Works

| Capability | Current Status | Evidence |
| --- | --- | --- |
| Dashboard authentication | Implemented | Supabase email/password and magic-link client/server config. |
| Dashboard authorization | Implemented | Server-side API guards enforce viewer/operator/admin access. |
| Safe command execution | Implemented | `test:inssa:safe` is exposed and runnable. |
| Security campaign execution | Implemented | `test:inssa:campaign:security` is exposed and runnable. |
| Security verification | Implemented | `test:inssa:campaign:security:verify` is exposed and runnable. |
| Artifact validation | Implemented | Discovery, public-share, and cleanup audit consume selected lifecycle artifacts. |
| Report rendering | Implemented | Security and lifecycle report re-render commands are exposed as report tools. |
| Report archive | Implemented | Reports are categorized as Playwright, Security, Lifecycle, and SIEM. |
| Report file serving | Implemented | `GET /api/artifacts/:id/file` serves allowlisted reports to authenticated users. |
| SIEM export | Implemented | `siem:export` is exposed and writes metadata JSON. |
| SIEM send | Implemented in scripts, disabled in dashboard | Requires explicit endpoint and is intentionally not a dashboard action yet. |
| Platform healthcheck | Implemented | `platform:healthcheck` is exposed for admin execution. |

## What Is Exposed In The Dashboard

The dashboard is organized around architecture boundaries:

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

Dashboard commands currently exposed as executable actions:

| Dashboard Section | Command | Registry Key | Exposed | Notes |
| --- | --- | --- | --- | --- |
| Safe Tests | `npm run test:inssa:safe` | `test_inssa_safe` | Yes | Dedicated primary action card. |
| Security | `npm run test:inssa:campaign:security` | `test_inssa_campaign_security` | Yes | Executes OWASP campaign. |
| Security | `npm run test:inssa:campaign:security:verify` | `test_inssa_campaign_security_verify` | Yes | Verifies known findings from existing evidence. |
| Artifact Validation | `npm run test:inssa:discovery` | `test_inssa_discovery` | Yes | Requires lifecycle artifact selection. |
| Artifact Validation | `npm run test:inssa:public-share` | `test_inssa_public_share` | Yes | Requires lifecycle artifact selection. |
| Artifact Validation | `npm run test:inssa:cleanup-audit` | `test_inssa_cleanup_audit` | Yes | Requires lifecycle artifact selection. |
| Reports | `npm run report:security` | `report_security` | Yes | Re-renders HTML from existing findings; does not run Playwright. |
| Reports | `npm run report:lifecycle` | `report_lifecycle` | Yes | Re-renders HTML from existing lifecycle evidence; does not run Playwright. |
| SIEM | `npm run siem:export` | `siem_export` | Yes | Metadata-only export. |
| Operations | `npm run platform:healthcheck` | `platform_healthcheck` | Yes | Admin-only execution. |

## What Is Intentionally Hidden Or Disabled

| Capability | Dashboard State | Reason |
| --- | --- | --- |
| Text lifecycle campaign | Visible, disabled | Live staging mutation; needs approval and cleanup workflow. |
| Media lifecycle campaign | Visible, disabled | Live staging mutation; uploads media and needs cleanup workflow. |
| Video lifecycle campaign | Visible, disabled | Live staging mutation; uploads video and needs cleanup workflow. |
| Reveal-later lifecycle campaign | Visible, disabled | Live staging mutation; scheduling and post-reveal handling require explicit workflow. |
| Cross-user campaign | Visible, disabled | Creates staging data and requires secondary-user/cleanup confirmation. |
| Reveal-later security campaign | Visible, disabled | May need artifact creation/resume behavior to be explicit. |
| SIEM send | Visible, disabled | External transmission; needs endpoint preview, dry-run, and confirmation workflow. |
| Live staging mega-runner | Not exposed | Too broad for controlled dashboard execution. |
| Arbitrary command execution | Not available | Command whitelist is a core safety control. |
| Artifact downloads for screenshots/videos/traces | Not available | Sensitive artifacts are indexed but not served by the dashboard. |

## Current Dashboard Structure

| Section | Purpose | Current Behavior |
| --- | --- | --- |
| Overview | Summary counts and latest activity | Displays total, passed, failed, and running counts. |
| Safe Tests | Non-mutating baseline | Dedicated `INSSA Safe Suite` action card. |
| Security | Read-only security campaigns | Action selector for Security Campaign and Security Verification; future mutation campaigns disabled. |
| Lifecycle | Live lifecycle orientation | Selector shows disabled lifecycle actions with reason and cleanup warnings. |
| Artifact Validation | Read-only lifecycle artifact consumers | Requires latest or explicit validation-ready artifact before execution. |
| Reports | Evidence review | Category tabs for Playwright, Security, Lifecycle, and SIEM artifacts. |
| SIEM | Metadata export | Action selector exposes Generate Export and shows disabled Send Export. |
| Operations | Platform diagnostics | Healthcheck plus metadata/backend/API failure visibility. |
| Run History | Execution history | Filterable table of runs from the active metadata backend. |
| Run Details | Logs and artifacts | Shows run status, live logs, artifact metadata, and report links. |

## Current Command Exposure Matrix

| Command | Dashboard Exposure | Risk | Mutates Staging | Current Phase |
| --- | --- | --- | --- | --- |
| `test:inssa:safe` | Executable | safe | No | V1 |
| `test:inssa:campaign:security` | Executable | read-only | No | V1 |
| `test:inssa:campaign:security:verify` | Executable | read-only | No | V1 |
| `test:inssa:discovery` | Executable with artifact | read-only | No | V1 |
| `test:inssa:public-share` | Executable with artifact | read-only | No | V1 |
| `test:inssa:cleanup-audit` | Executable with artifact | read-only | No | V1 |
| `report:security` | Executable as report tool | read-only | No | V1 |
| `report:lifecycle` | Executable as report tool | read-only | No | V1 |
| `siem:export` | Executable | read-only | No | V1 |
| `platform:healthcheck` | Executable for admin | read-only | No | V1 |
| `test:inssa:campaign:text` | Disabled | live mutation | Yes | Later |
| `test:inssa:campaign:media` | Disabled | live mutation | Yes | Later |
| `test:inssa:campaign:video` | Disabled | live mutation | Yes | Later |
| `test:inssa:campaign:reveal-later` | Disabled | live mutation | Yes | Later |
| `test:inssa:campaign:cross-user` | Disabled | live mutation | Yes | Later |
| `test:inssa:campaign:reveal-later-security` | Disabled | conditional mutation | Possible | Later |
| `siem:send` | Disabled | external transmission | No | Later |
| `test:inssa:live-staging` | Hidden | broad live mutation | Yes | Never expose as primary workflow |

## Metadata And Artifact Model

The run store records:

- runs
- logs
- artifacts
- audit events

Default metadata backend:

- Local JSON: `dashboard/.data/inssa-runs.json`

Optional metadata backend:

- Supabase when `INSSA_OPS_METADATA_STORE=supabase` and Supabase URL/key values are configured.

Artifacts are indexed from:

- `playwright-report/`
- `test-results/`
- `reports/security/`
- `reports/lifecycle/`
- `reports/siem/`
- `lifecycle-artifacts/`
- `lifecycle-campaigns/`
- `security-campaigns/`

The dashboard stores artifact metadata only. It does not move files or migrate raw evidence to object storage.

## Report Serving Model

The dashboard serves files only through artifact metadata. It does not accept arbitrary file paths.

Servable roots:

- `playwright-report/`
- `reports/security/`
- `reports/lifecycle/`
- `reports/siem/`

Servable artifact types:

- Playwright Report
- Security Report
- Lifecycle Report
- SIEM Export

Screenshots, videos, traces, lifecycle JSON, and sensitive generated evidence are not served through the dashboard.

## Security Controls

- Dashboard UI and APIs require Supabase-authenticated users.
- API access uses server-side role checks.
- Viewers can read runs, logs, artifacts, reports, and lifecycle artifact options.
- Operators can run safe Phase 1 commands except admin-only healthcheck.
- Admins can run all currently exposed Phase 1 commands.
- `INSSA_URL` must be `https://staging.inssa.us` for dashboard command execution.
- Production hosts `inssa.us` and `www.inssa.us` are blocked.
- Runner uses `spawn` with `shell:false`.
- Only whitelisted registry commands are executable.
- One active run is allowed globally.
- Logs are redacted before persistence.
- Unauthorized access and role violations are audited.

## Documentation Freshness Audit

| Document | Status | Notes |
| --- | --- | --- |
| `README.md` | Current after refresh | Primary repo entry point; now links current dashboard docs. |
| `docs/inssa-platform-current-state.md` | Current | Current source-of-truth snapshot. |
| `docs/inssa-dashboard-roadmap.md` | Current | Current phased dashboard roadmap. |
| `docs/inssa-dashboard-architecture.md` | Current | Current dashboard architecture. |
| `docs/inssa-command-matrix.md` | Current | Current command exposure and risk matrix. |
| `docs/inssa-dashboard-decisions.md` | Current | Current architectural decisions. |
| `docs/inssa-v1-definition.md` | Current | Approved V1 scope. |
| `docs/inssa-handoff-2026.md` | Current | Future-engineer handoff. |
| `docs/inssa-qa-operations-guide.md` | Partially stale | Still useful as broad operations guide; dashboard sections predate action-selector V1. |
| `docs/inssa-platform-operations.md` | Partially stale | Useful for platform operations; should reference V1 dashboard docs for current UI. |
| `docs/inssa-live-staging-lifecycle.md` | Partially stale | Good lifecycle background; dashboard exposure has changed and live commands remain disabled. |
| `docs/inssa-security-campaign.md` | Partially stale | Security campaign concepts remain valid; dashboard command exposure now uses selector model. |
| `docs/inssa-product-behavior-audit.md` | Historical | Preserve as audit evidence, not current UI source of truth. |
| `docs/inssa-engineering-review.md` | Historical/current mix | Preserve findings; use risk matrix/current state for current execution model. |
| `docs/inssa-security-findings.md` | Current findings reference | Keep updated when security classifications change. |
| `docs/inssa-risk-matrix.md` | Current findings reference | Keep updated when risk status changes. |
| `docs/inssa-contact-share-state-machine.md` | Historical/current product evidence | Preserve as product-flow evidence. |
| `docs/inssa-final-program-report.md` | Historical completion report | Do not treat as current implementation contract. |
| `docs/inssa-release-summary.md` | Historical release summary | Useful context, not current dashboard contract. |
| `docs/inssa-final-platform-status.md` | Partially stale | Operational status reference; update after release gates. |
| `docs/inssa-platform-validation.md` | Historical validation | Preserve run evidence. |
| `docs/inssa-dashboard-engineering.md` | Wazuh dashboard design | Current for Wazuh, not the local Next.js dashboard. |
| `docs/inssa-dashboard-runbook.md` | Wazuh dashboard runbook | Current for Wazuh dashboard operations. |
| `docs/inssa-observability-dashboard.md` | Wazuh observability design | Current as Wazuh design reference. |
| `docs/inssa-security-center.md` | Wazuh dashboard docs | Current for INSSA Security Center. |
| `docs/inssa-security-center-options.md` | Historical decision input | Preserve as decision context. |
| `docs/inssa-daily-operations.md` | Wazuh operator guide | Current for Wazuh daily review. |
| `docs/inssa-operator-experience.md` | Wazuh operator workflow | Current for Wazuh usage. |
| `docs/inssa-quick-start.md` | Wazuh quick start | Current for Wazuh operator onboarding. |
| `docs/inssa-entry-point-review.md` | Wazuh navigation decision | Historical/current navigation context. |
| `docs/inssa-default-route-decision.md` | Wazuh route decision | Current if default-route change is being considered. |
| `docs/inssa-alert-routing.md` | Current | Alert-routing design. |
| `docs/inssa-alert-runbook.md` | Current | Alert operations. |
| `docs/inssa-notification-testing.md` | Current | Notification validation scenarios. |
| `docs/inssa-siem-architecture.md` | Current | SIEM architecture. |
| `docs/inssa-siem-operations.md` | Current | SIEM operations. |
| `docs/inssa-siem-runbook.md` | Current | SIEM response runbook. |
| `docs/inssa-siem-release-gate.md` | Current | SIEM release checklist. |
| `docs/inssa-siem-disaster-recovery.md` | Current | Recovery procedures. |
| `docs/wazuh-inssa-decoder.md` | Current | Decoder package. |
| `docs/wazuh-inssa-rules.md` | Current | Rule package. |
| `docs/wazuh-inssa-ingestion.md` | Current | Ingestion service deployment. |
| `docs/wazuh-inssa-integration.md` | Current | Integration overview. |
| `docs/wazuh-cleanup-assessment.md` | Historical/current | Preserve assessment. |
| `docs/wazuh-ui-inventory.md` | Historical/current | Valid as last observed Wazuh inventory. |
| `docs/wazuh-navigation-map.md` | Historical/current | Valid as last observed Wazuh navigation map. |
| `docs/release-gate-gitignore-audit.md` | Current for release security | Update only after new secret/gitignore audits. |

## Documentation Gaps

- No dashboard API endpoint reference exists yet.
- No Supabase schema/migration document is committed for metadata persistence.
- No formal dashboard visual regression checklist exists.
- No dashboard artifact retention policy exists beyond metadata indexing and report serving rules.
- No operator procedure exists for enabling disabled live lifecycle commands in the dashboard.
