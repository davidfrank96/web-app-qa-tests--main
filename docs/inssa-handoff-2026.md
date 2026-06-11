# INSSA QA Platform Handoff 2026

Last updated: 2026-06-11

This handoff is for future engineers inheriting the INSSA QA Operations Platform.

## What This Platform Is

This repository is a black-box QA and security harness for hosted web apps. Its most mature platform is focused on INSSA staging at:

```text
https://staging.inssa.us
```

It is not the INSSA application source repo. It has no backend, database, cloud, or production access to INSSA.

The platform contains:

- Playwright tests.
- INSSA lifecycle campaign scripts.
- INSSA security campaign scripts.
- Persistent lifecycle/security artifacts.
- HTML report generators.
- SIEM export/send scripts.
- Wazuh ingestion service docs/code.
- Next.js Operations Dashboard.

## How It Works

CLI path:

```text
npm script
-> Playwright/campaign runner
-> artifacts/reports
-> SIEM export
-> optional Wazuh send
```

Dashboard path:

```text
authenticated user
-> Next.js dashboard
-> API route
-> command registry
-> runner
-> whitelisted npm script
-> logs/artifact indexing
-> run history/report archive
```

Wazuh path:

```text
campaign outputs
-> scripts/siem/export-campaign-summary.js
-> scripts/siem/send-to-wazuh.js
-> ingestion API
-> /var/ossec/logs/inssa-qa.log
-> Wazuh decoder/rules
-> dashboards/alerts
```

## What Has Been Completed

- Safe INSSA suite.
- Live lifecycle harnesses for text, media, video, and reveal-later via CLI/campaigns.
- Artifact-driven discovery/public-share/cleanup audit tests.
- Lifecycle artifact persistence.
- Security campaign.
- Security verification campaign.
- Cross-user and reveal-later security campaign scripts.
- SIEM export and send scripts.
- Wazuh ingestion service and documentation.
- Wazuh decoder/rule/dashboard/alert docs.
- Dashboard auth/RBAC.
- Dashboard runner foundation.
- Dashboard artifact indexing.
- Dashboard report viewer.
- Dashboard action-based navigation.
- Dashboard diagnostics.

## What Is Safe To Operate From The Dashboard

- INSSA Safe Suite.
- Security Campaign.
- Security Verification.
- Artifact Validation against existing lifecycle artifacts.
- Security/lifecycle report re-rendering.
- SIEM export generation.
- Platform healthcheck.

## What Should Never Be Changed Casually

- Production block for INSSA.
- `INSSA_URL` staging-only validation.
- Command whitelist.
- `shell:false` runner behavior.
- One active run guard.
- Manual cleanup requirements for live lifecycle commands.
- No automatic delete/archive/unpublish behavior.
- Artifact Validation requirement for explicit/latest lifecycle artifact selection.
- Separation between campaigns, reports, artifact validation, SIEM, and operations.
- Sensitive artifact serving restrictions.
- SIEM sender refusal of screenshots/videos/traces and unredacted tokens.

## What Remains To Be Built

- Approval workflow for enabling dashboard live lifecycle commands.
- SIEM send preview/confirmation workflow.
- Artifact retention policy.
- Hosted deployment runbook for the dashboard.
- Supabase metadata migrations if Supabase becomes the primary metadata store.
- Dashboard API reference.
- Visual regression checklist for the dashboard.
- Optional scheduling after V1 is stable.
- Object storage for long-term artifact/report retention.

## Current Entry Points

| Area | Document |
| --- | --- |
| Current state | `docs/inssa-platform-current-state.md` |
| V1 scope | `docs/inssa-v1-definition.md` |
| Dashboard architecture | `docs/inssa-dashboard-architecture.md` |
| Command matrix | `docs/inssa-command-matrix.md` |
| Dashboard roadmap | `docs/inssa-dashboard-roadmap.md` |
| Decisions | `docs/inssa-dashboard-decisions.md` |
| Wazuh/SIEM architecture | `docs/inssa-siem-architecture.md` |
| Wazuh navigation | `docs/wazuh-navigation-map.md` |
| Security findings | `docs/inssa-security-findings.md` |
| Risk matrix | `docs/inssa-risk-matrix.md` |

## First Checks For A New Engineer

1. Read `README.md`.
2. Read `docs/inssa-platform-current-state.md`.
3. Run `npm run platform:healthcheck`.
4. Run `npm run dashboard:build`.
5. Start dashboard locally with `npm run dashboard:dev`.
6. Verify login and role resolution.
7. Run only `test:inssa:safe` before attempting security campaigns.
8. Do not run live lifecycle commands until cleanup and approval workflow are clear.

## Cleanup Responsibility

Live lifecycle campaigns can create real QA-tagged staging data. Cleanup is manual unless a specific cleanup path has been audited and approved.

Do not add automatic cleanup from the dashboard without a separate design review.

