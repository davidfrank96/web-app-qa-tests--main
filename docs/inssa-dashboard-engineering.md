# INSSA Dashboard Engineering

This document defines Wazuh saved searches, dashboards, filters, refresh intervals, alert thresholds, and reporting views for the operational INSSA QA telemetry stream.

Scope:

```text
Dashboard design only.
No decoder, rule, ingestion service, or infrastructure changes are defined here.
```

Related documents:

- [inssa-siem-architecture.md](inssa-siem-architecture.md)
- [inssa-siem-operations.md](inssa-siem-operations.md)
- [inssa-siem-runbook.md](inssa-siem-runbook.md)
- [wazuh-inssa-rules.md](wazuh-inssa-rules.md)

## Base Dataset

All INSSA dashboard objects use this base filter:

```text
source:web-app-qa-tests AND product:INSSA
```

Recommended primary time field:

```text
timestamp
```

If the Wazuh index uses its own ingestion timestamp as the dashboard time field, keep `timestamp` visible as a table column so campaign send time and index time can be compared.

## Field Model

| Field | Purpose |
| --- | --- |
| `source` | Identifies QA harness events. Expected value: `web-app-qa-tests`. |
| `product` | Identifies INSSA events. Expected value: `INSSA`. |
| `eventType` | Release gate, lifecycle, security, discovery, or cleanup category. |
| `campaign` | Specific campaign or validation flow. |
| `environment` | Expected value for hosted app checks: `staging`. |
| `severity` | Exported severity: `informational`, `low`, `medium`, `high`, `critical`. |
| `classification` | Finding or lifecycle classification. |
| `status` | Campaign or finding status. |
| `runId` | Campaign run identifier. |
| `artifactReference.path` | Metadata reference to artifact JSON. |
| `reportReference.path` | Metadata reference to human-readable report. |
| `rule.level` | Wazuh rule level after classification. |
| `rule.groups` | Wazuh rule groups after classification. |

## Saved Search Definitions

Create these saved searches in Wazuh Dashboard Discover. Use the base filter plus the query shown.

| Saved Search | Query | Columns | Purpose |
| --- | --- | --- | --- |
| INSSA Critical Findings | `source:web-app-qa-tests AND product:INSSA AND rule.level >= 14` | `timestamp`, `rule.level`, `classification`, `campaign`, `status`, `runId`, `reportReference.path` | Immediate critical review queue. |
| INSSA High Risk Findings | `source:web-app-qa-tests AND product:INSSA AND rule.level >= 10` | `timestamp`, `rule.level`, `classification`, `severity`, `campaign`, `status`, `runId` | High and critical findings requiring tickets or escalation. |
| INSSA Release Gate Failures | `source:web-app-qa-tests AND product:INSSA AND eventType:release_gate AND status:failed` | `timestamp`, `classification`, `status`, `campaign`, `reportReference.path` | Release readiness blockers. |
| INSSA Security Campaign Findings | `source:web-app-qa-tests AND product:INSSA AND eventType:security_campaign` | `timestamp`, `rule.level`, `severity`, `classification`, `campaign`, `status`, `runId` | OWASP and security verification findings. |
| INSSA Lifecycle Campaign Findings | `source:web-app-qa-tests AND product:INSSA AND eventType:lifecycle_campaign` | `timestamp`, `severity`, `classification`, `campaign`, `status`, `runId`, `artifactReference.path` | Lifecycle create, retrieval, visibility, and media/video findings. |
| INSSA Cleanup Targets | `source:web-app-qa-tests AND product:INSSA AND (eventType:cleanup_audit OR classification:*cleanup*)` | `timestamp`, `classification`, `campaign`, `status`, `runId`, `artifactReference.path`, `reportReference.path` | Manual cleanup tracking and cleanup capability review. |
| INSSA Cross User Findings | `source:web-app-qa-tests AND product:INSSA AND (campaign:*cross-user* OR classification:(expected-share-access OR unauthorized-visible OR isolated))` | `timestamp`, `rule.level`, `classification`, `status`, `runId`, `reportReference.path` | User isolation and targeted-share behavior. |
| INSSA Reveal Later Findings | `source:web-app-qa-tests AND product:INSSA AND (campaign:*reveal-later* OR classification:(reveal-protected OR reveal-accessible-early OR reveal-bypass-risk))` | `timestamp`, `rule.level`, `classification`, `status`, `runId`, `artifactReference.path` | Reveal-later access-control behavior. |

If the Wazuh query syntax in the deployed dashboard does not support grouped terms exactly as written, use the UI filter builder with equivalent field filters.

## Dashboard: INSSA Security Overview

Purpose:

```text
Security triage and risk monitoring for INSSA QA findings.
```

Default filters:

```text
source:web-app-qa-tests AND product:INSSA
```

Recommended time range:

```text
Last 30 days
```

Widgets:

| Widget | Visualization | Query | Notes |
| --- | --- | --- | --- |
| Critical Findings Count | Metric | `rule.level >= 14` | Red. Shows immediate escalation queue. |
| High Risk Findings Count | Metric | `rule.level >= 10` | Includes high and critical findings. |
| Findings by Classification | Terms bar chart | `classification` | Sort descending by count. |
| Findings by Severity | Donut or stacked bar | `severity` | Use exported severity field. |
| Findings by Campaign | Terms bar chart | `campaign` | Shows which campaign is producing risk. |
| Findings by Day | Date histogram | `timestamp` by day | Shows trend and regression spikes. |
| Top Active Risks | Data table | `classification`, `rule.level`, `campaign`, `status`, `runId`, `reportReference.path` | Filter to `status:(failed OR warning OR passed-with-findings)`. |

Operational color mapping:

| Level | Color |
| --- | --- |
| Critical | Red |
| High | Orange |
| Medium | Yellow |
| Low | Blue |
| Informational | Gray |

## Dashboard: INSSA QA Operations

Purpose:

```text
Operational view for release gate health, campaign status, cleanup obligations, and latest findings.
```

Default filters:

```text
source:web-app-qa-tests AND product:INSSA
```

Recommended time range:

```text
Last 14 days
```

Widgets:

| Widget | Visualization | Query | Notes |
| --- | --- | --- | --- |
| Release Gate Status | Latest value or table | `eventType:release_gate` | Show latest status and report reference. |
| Campaign Pass/Fail Trend | Date histogram stacked by `status` | `eventType:(lifecycle_campaign OR security_campaign OR discovery_campaign)` | Tracks daily operational health. |
| Lifecycle Campaign Status | Data table | `eventType:lifecycle_campaign` | Columns: `timestamp`, `campaign`, `classification`, `status`, `runId`. |
| Cleanup Targets | Data table | `eventType:cleanup_audit OR classification:*cleanup*` | Shows manual cleanup tracking. |
| Latest Security Findings | Data table | `eventType:security_campaign` | Sort by `timestamp` descending. |

## Dashboard: INSSA Engineering Review

Purpose:

```text
Engineering remediation planning and product-risk review.
```

Default filters:

```text
source:web-app-qa-tests AND product:INSSA AND status:(failed OR warning OR passed-with-findings OR passed-with-warnings)
```

Recommended time range:

```text
Last 90 days
```

Widgets:

| Widget | Visualization | Query | Notes |
| --- | --- | --- | --- |
| Findings Awaiting Remediation | Data table | `rule.level >= 7 AND status:(failed OR warning OR passed-with-findings OR passed-with-warnings)` | Primary engineering queue. |
| Findings by Owner | Terms chart | `dashboardFields.owner` if available | If owner is absent, group by `classification` until ownership metadata is added. |
| Findings by Classification | Terms bar chart | `classification` | Use top 20 classifications. |
| Findings by Age | Date histogram | `timestamp` | Bucket weekly over 90 days. |
| Findings by Severity | Stacked bar | `severity` | Split by `status`. |

## Dashboard Filters

Global filters:

| Filter | Value |
| --- | --- |
| Product | `product:INSSA` |
| Source | `source:web-app-qa-tests` |
| Environment | `environment:staging` |

Common drill-down filters:

| Use Case | Filter |
| --- | --- |
| Critical incidents | `rule.level >= 14` |
| High-risk work queue | `rule.level >= 10` |
| Visibility semantics | `classification:(share-link-only-visibility OR token-optional OR public-by-id)` |
| Cross-user validation | `campaign:*cross-user*` |
| Reveal-later validation | `campaign:*reveal-later*` |
| Cleanup | `eventType:cleanup_audit OR classification:*cleanup*` |
| Release gates | `eventType:release_gate` |
| Lifecycle only | `eventType:lifecycle_campaign` |
| Security only | `eventType:security_campaign` |

## Refresh Intervals

| Dashboard | Refresh Interval | Reason |
| --- | --- | --- |
| INSSA Security Overview | 5 minutes during active test windows, 15 minutes otherwise | Findings are campaign-driven and not high-volume. |
| INSSA QA Operations | 15 minutes | Operational status changes after campaign runs. |
| INSSA Engineering Review | Manual refresh or 30 minutes | Engineering review is not incident-response paced. |

During active release gates, use a temporary 1 minute refresh interval until SIEM send and dashboard verification complete.

## Alert Thresholds

| Condition | Threshold | Action |
| --- | --- | --- |
| Critical finding | Any event with `rule.level >= 14` | Immediate alert. |
| High-risk access finding | Any `classification:(public-by-id OR media-publicly-accessible)` | Create security ticket. |
| Release gate failure | Any `eventType:release_gate AND status:failed` | Block release and notify QA owner. |
| Repeated medium findings | Three or more medium findings with same classification in 7 days | Weekly triage escalation. |
| Ingestion inactivity | No INSSA event for 7 days during active QA period | Check campaign schedule and ingestion health. |
| Cleanup debt | Any cleanup target older than 7 days | Request dev cleanup confirmation. |

## Executive Reporting View

Audience:

```text
Engineering leadership, product leadership, security leadership.
```

Widgets:

- Critical Findings Count.
- High Risk Findings Count.
- Open Cleanup Targets.
- Findings by Severity.
- Findings by Week.
- Top Active Risks.

Default time range:

```text
Last 30 days
```

Narrative fields to include in exports:

- Current highest severity.
- Number of open high-risk classifications.
- Whether release gate is passing.
- Manual cleanup debt.
- Confirmed product-risk themes.

## Engineering Reporting View

Audience:

```text
INSSA engineering owners and QA maintainers.
```

Widgets:

- Findings Awaiting Remediation.
- Findings by Classification.
- Findings by Campaign.
- Lifecycle Campaign Status.
- Cleanup Targets.
- Latest Security Findings.

Default time range:

```text
Last 90 days
```

Required table columns:

```text
timestamp
classification
severity
status
campaign
runId
artifactReference.path
reportReference.path
```

## Security Reporting View

Audience:

```text
Security team and incident responders.
```

Widgets:

- Critical Findings Count.
- High Risk Findings Count.
- Access-control classifications.
- Media access classifications.
- Token behavior classifications.
- Reveal-later security classifications.
- Cross-user validation classifications.

Default time range:

```text
Last 30 days
```

Required drill-downs:

- `unauthorized-visible`
- `authentication-bypass`
- `public-by-id`
- `media-publicly-accessible`
- `token-optional`
- `reveal-bypass-risk`
- `reveal-accessible-early`

## Dashboard Ownership

| Dashboard | Primary Owner | Review Cadence |
| --- | --- | --- |
| INSSA Security Overview | Security owner | Weekly and after every security campaign. |
| INSSA QA Operations | QA owner | Daily during active release windows. |
| INSSA Engineering Review | Engineering owner | Weekly remediation review. |

## Reporting Strategy

1. Campaigns create structured artifacts and human-readable reports.
2. SIEM export summarizes those outputs into metadata-only events.
3. Wazuh dashboards provide operational monitoring and trend visibility.
4. Detailed reproduction evidence remains in QA reports and artifacts, not in SIEM.
5. High and critical dashboard entries become ticket or incident inputs.
6. Medium and informational entries support release notes, weekly review, and product behavior tracking.
