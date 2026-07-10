# INSSA Documentation Audit

Last updated: 2026-06-20

This audit classifies existing INSSA and Wazuh documentation after the documentation consolidation pass.

Status meanings:

- Current: matches the implemented architecture or is intentionally current operational guidance.
- Partially Stale: still useful, but some dashboard/workflow details predate the current V1/action-selector model.
- Stale/Historical: preserve as evidence or historical context; do not treat as current architecture source of truth.

## Current Source Of Truth

| Document | Status | Why |
| --- | --- | --- |
| `README.md` | Current | Primary platform entry point after rewrite. |
| `docs/qa-platform-architecture-constitution.md` | Current | Governing architecture document. |
| `docs/inssa-platform-current-state.md` | Current | Current implemented INSSA dashboard/platform state. |
| `docs/inssa-dashboard-architecture.md` | Current | Current dashboard/API/runner/artifact model. |
| `docs/inssa-command-matrix.md` | Current | Current command exposure and risk model. |
| `docs/inssa-v1-definition.md` | Current | Current V1 scope. |
| `docs/inssa-dashboard-decisions.md` | Current | Current architectural decisions. |
| `docs/inssa-dashboard-roadmap.md` | Current | Current phase roadmap. |
| `docs/inssa-platform-handoff-2026.md` | Current | Current handoff. |

## INSSA QA And Lifecycle Docs

| Document | Status | Why |
| --- | --- | --- |
| `docs/inssa-qa-operations-guide.md` | Partially Stale | Broadly useful, but predates current README/current-state primacy. |
| `docs/inssa-platform-operations.md` | Partially Stale | Useful operations context; dashboard V1 details now live in current-state docs. |
| `docs/inssa-live-staging-lifecycle.md` | Partially Stale | Lifecycle mechanics remain useful; dashboard exposure now disabled/gated. |
| `docs/inssa-current-state.md` | Stale/Historical | Earlier snapshot superseded by `inssa-platform-current-state.md`. |
| `docs/inssa-product-behavior-audit.md` | Stale/Historical | Preserve as black-box product evidence. |
| `docs/inssa-contact-share-state-machine.md` | Current evidence | Product state-machine evidence remains relevant. |
| `docs/inssa-engineering-review.md` | Partially Stale | Findings/context useful; current architecture now in constitution/current-state docs. |
| `docs/inssa-release-summary.md` | Stale/Historical | Release summary from earlier phase. |
| `docs/inssa-final-program-report.md` | Stale/Historical | Program-completion report, not live architecture source. |
| `docs/inssa-final-platform-status.md` | Partially Stale | Operational status should be refreshed after new release gates. |
| `docs/inssa-platform-validation.md` | Stale/Historical | Validation evidence from prior phase. |

## Security Docs

| Document | Status | Why |
| --- | --- | --- |
| `docs/inssa-security-campaign.md` | Current | Security campaign model remains valid. |
| `docs/inssa-security-findings.md` | Current | Findings record; update when classifications change. |
| `docs/inssa-risk-matrix.md` | Current | Risk register; update when findings change. |
| `docs/inssa-alert-routing.md` | Current | Alert routing design. |
| `docs/inssa-alert-runbook.md` | Current | Alert response operations. |
| `docs/inssa-notification-testing.md` | Current | Notification test scenarios. |

## Wazuh/SIEM Docs

| Document | Status | Why |
| --- | --- | --- |
| `docs/inssa-siem-architecture.md` | Current | SIEM architecture reference. |
| `docs/inssa-siem-operations.md` | Current | SIEM operations reference. |
| `docs/inssa-siem-runbook.md` | Current | SIEM response procedures. |
| `docs/inssa-siem-release-gate.md` | Current | SIEM release checklist. |
| `docs/inssa-siem-disaster-recovery.md` | Current | SIEM recovery procedures. |
| `docs/wazuh-inssa-integration.md` | Current | Integration model. |
| `docs/wazuh-inssa-decoder.md` | Current | Decoder package guidance. |
| `docs/wazuh-inssa-rules.md` | Current | Rule package guidance. |
| `docs/wazuh-inssa-ingestion.md` | Current | Ingestion service deployment guidance. |
| `docs/wazuh-cleanup-assessment.md` | Stale/Historical | Snapshot of Wazuh cleanup assessment. |
| `docs/wazuh-ui-inventory.md` | Stale/Historical | Last observed Wazuh UI inventory; refresh after Wazuh UI changes. |
| `docs/wazuh-navigation-map.md` | Stale/Historical | Last observed navigation map; refresh after Wazuh UI changes. |

## Dashboard/Wazuh Experience Docs

| Document | Status | Why |
| --- | --- | --- |
| `docs/inssa-dashboard-engineering.md` | Current | Wazuh dashboard engineering design. |
| `docs/inssa-dashboard-build-guide.md` | Current | Wazuh dashboard build guide. |
| `docs/inssa-dashboard-runbook.md` | Current | Wazuh dashboard maintenance/runbook. |
| `docs/inssa-observability-dashboard.md` | Current | Wazuh observability dashboard design. |
| `docs/inssa-security-center.md` | Current | Wazuh Security Center documentation. |
| `docs/inssa-security-center-options.md` | Stale/Historical | Decision input preserved for context. |
| `docs/inssa-daily-operations.md` | Current | Wazuh daily operations workflow. |
| `docs/inssa-operator-experience.md` | Current | Operator workflow guidance. |
| `docs/inssa-quick-start.md` | Partially Stale | Useful for Wazuh operator onboarding; README is now primary repo entry point. |
| `docs/inssa-entry-point-review.md` | Stale/Historical | Navigation decision history. |
| `docs/inssa-default-route-decision.md` | Current decision reference | Use only if changing Wazuh default route. |

## Release/Security Hygiene Docs

| Document | Status | Why |
| --- | --- | --- |
| `docs/release-gate-gitignore-audit.md` | Current for last audit | Refresh when generated/secret file policy changes. |

## Missing Documentation

- Dashboard API endpoint reference.
- Supabase metadata schema/migration guide.
- Dashboard visual regression checklist.
- Live lifecycle dashboard enablement procedure.
- Artifact retention and pruning policy.
- Hosted deployment runbook for the Next.js dashboard.

## Duplicated Documentation

- Platform overview appears in README, QA Operations Guide, Platform Operations, Final Program Report, and older Current State docs.
- Wazuh dashboard workflow appears across dashboard engineering/runbook/daily operations/security center docs.
- Lifecycle behavior appears across live staging lifecycle, product behavior audit, contact-share state machine, final program report, and current-state docs.

Duplication is acceptable for historical evidence, but current architecture should be read from:

1. `README.md`
2. `docs/qa-platform-architecture-constitution.md`
3. `docs/inssa-platform-current-state.md`
4. `docs/inssa-command-matrix.md`
5. `docs/inssa-dashboard-architecture.md`

