# INSSA Platform Operations

This is the primary operations document for the INSSA QA Security Platform.

## Architecture

```text
Playwright QA campaigns
-> lifecycle/security artifacts
-> human-readable reports
-> SIEM export
-> Wazuh ingestion
-> Wazuh decoder/rules
-> dashboards
-> alert routing
```

Primary target:

```text
https://staging.inssa.us
```

SIEM endpoint:

```text
https://wazuh.kbeanprobo.com/inssa
```

## Lifecycle Operations

Use safe tests for routine regression:

```bash
npm run test:inssa:safe
```

Use live campaigns only when staging data creation and manual cleanup are approved:

```bash
npm run test:inssa:campaign:text
npm run test:inssa:campaign:media
npm run test:inssa:campaign:video
npm run test:inssa:campaign:reveal-later
```

Lifecycle artifacts are written to:

```text
lifecycle-artifacts/
lifecycle-campaigns/
reports/lifecycle/
```

## Security Operations

Run security campaign:

```bash
npm run test:inssa:campaign:security
```

Run verification campaign:

```bash
npm run test:inssa:campaign:security:verify
```

Run cross-user campaign:

```bash
npm run test:inssa:campaign:cross-user
```

Run reveal-later security campaign:

```bash
npm run test:inssa:campaign:reveal-later-security
```

Security artifacts are written to:

```text
security-campaigns/
reports/security/
```

## SIEM Operations

Generate export:

```bash
npm run siem:export
```

Send export:

```bash
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

Run campaign and SIEM automation:

```bash
npm run test:inssa:campaign:security:siem
npm run test:inssa:campaign:cross-user:siem
npm run test:inssa:campaign:reveal-later:siem
```

SIEM outputs:

```text
reports/siem/latest-siem-export.json
/var/ossec/logs/inssa-qa.log
```

## Dashboards

Saved searches:

- INSSA Critical Findings
- INSSA High Risk Findings
- INSSA Release Gate Failures
- INSSA Security Campaign Findings
- INSSA Lifecycle Campaign Findings
- INSSA Cleanup Targets
- INSSA Cross User Findings
- INSSA Reveal Later Findings

Dashboards:

- INSSA Security Overview
- INSSA QA Operations
- INSSA Engineering Review

Reference:

```text
docs/inssa-dashboard-engineering.md
docs/inssa-dashboard-runbook.md
```

## Alerts

Severity mapping:

| Level | Examples | Route |
| --- | --- | --- |
| 14 Critical | `unauthorized-visible`, `authentication-bypass` | Email, Slack, incident recommendation. |
| 10 High | `public-by-id`, `media-publicly-accessible` | Security and engineering channels. |
| 7 Medium | `share-link-only-visibility`, `token-optional` | QA channel and daily summary. |
| 3 Informational | `reveal-protected`, `expected-share-access` | Dashboard and weekly report. |

References:

```text
docs/inssa-alert-routing.md
docs/inssa-alert-runbook.md
docs/inssa-notification-testing.md
```

## Runbooks

| Runbook | Purpose |
| --- | --- |
| `docs/inssa-siem-operations.md` | Daily SIEM operations. |
| `docs/inssa-siem-runbook.md` | Finding response. |
| `docs/inssa-siem-disaster-recovery.md` | Recovery and rollback. |
| `docs/inssa-dashboard-runbook.md` | Dashboard maintenance and recovery. |
| `docs/inssa-alert-runbook.md` | Notification and escalation recovery. |

## Recovery

Recovery order:

1. Verify QA export exists.
2. Verify SIEM sender dry-run.
3. Verify ingestion endpoint reachability.
4. Verify `/var/ossec/logs/inssa-qa.log` receives events.
5. Verify Wazuh decoder and rules.
6. Verify dashboard visibility.
7. Verify notification routing.

Commands:

```bash
npm run siem:export
npm run siem:send -- --dry-run
npm run platform:healthcheck
```

Server-side Wazuh recovery is documented in:

```text
docs/inssa-siem-disaster-recovery.md
```

## Validation

Routine validation:

```bash
npm run platform:healthcheck
npm run test:inssa:safe
npm run siem:export
npm run siem:send -- --dry-run
```

Full operational validation requires Wazuh administrative or dashboard access to verify:

- `/var/ossec/logs/inssa-qa.log`
- `/var/ossec/logs/alerts/alerts.json`
- decoder output
- rule output
- dashboard search results
- notification routes

## Release Gates

Before release:

1. Safe suite passes or has documented staging blocker.
2. Security campaign outputs exist.
3. Security verification outputs exist.
4. Cross-user outputs exist when cross-user scope changed.
5. Reveal-later outputs exist when reveal-later scope changed.
6. Reports are generated.
7. SIEM export and dry-run pass.
8. Wazuh send is performed when endpoint access is available.
9. Cleanup targets are documented.

Reference:

```text
docs/inssa-siem-release-gate.md
docs/inssa-platform-validation.md
docs/inssa-final-platform-status.md
```

## Cleanup

Live staging artifacts require manual cleanup by the development team.

Cleanup targets are identified from:

```text
lifecycle-artifacts/*.json
lifecycle-campaigns/*.json
security-campaigns/**/*.json
reports/security/*.html
reports/lifecycle/*.html
```

Cleanup rule:

```text
Delete only exact QA-tagged staging data identified by runId, subject, capsule ID, or artifact path.
```

## Current Operational Verdict

```text
OPERATIONAL
```

Operational warnings:

- `public-by-id`
- `media-publicly-accessible`
- reveal-later post-reveal follow-up remains open
- manual staging cleanup remains required
