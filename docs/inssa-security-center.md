# INSSA Security Center

Implementation date: 2026-06-08

Dashboard URL:

```text
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

Saved object ID:

```text
inssa-security-center
```

Export bundle:

```text
exports/inssa-security-center.ndjson
```

## Purpose

`INSSA Security Center` is the primary Wazuh landing dashboard for INSSA observability.

It implements the dashboard collection model selected in [inssa-security-center-options.md](inssa-security-center-options.md):

```text
INSSA Security Center
  -> INSSA Security Overview
  -> INSSA Campaign Operations
  -> INSSA Cleanup Queue
  -> INSSA Executive View
```

It uses standard Wazuh/OpenSearch dashboard saved objects only:

- Dashboard
- Metric visualizations
- Markdown visualizations
- Table visualizations
- Date histogram visualizations
- Saved search panel

It does not modify:

- Wazuh plugins
- Wazuh navigation
- Wazuh core code
- Decoders
- Rules
- Ingestion services

## Base Filter

Every Security Center widget is scoped to INSSA QA events with this filter:

```text
data.product:INSSA AND data.source:web-app-qa-tests
```

This prevents infrastructure SSH, Wazuh platform, and non-INSSA alerts from appearing in the dashboard.

## Layout

### Top-Level KPI Row

| Widget | Saved object ID | Query | Purpose |
| --- | --- | --- | --- |
| Critical Findings | `inssa-security-center-critical-findings` | `data.product:INSSA AND data.source:web-app-qa-tests AND rule.level >= 14` | Immediate critical-risk count. |
| High Findings | `inssa-security-center-high-findings` | `data.product:INSSA AND data.source:web-app-qa-tests AND rule.level >= 10` | High and critical-risk count. |
| Open Findings | `inssa-security-center-open-findings` | `data.product:INSSA AND data.source:web-app-qa-tests AND data.status:(failed OR warning OR passed-with-findings OR passed-with-warnings)` | Open or warning-bearing campaign/finding count. |
| Campaigns Run Last 30 Days | `inssa-security-center-campaigns-run` | `data.product:INSSA AND data.source:web-app-qa-tests AND data.eventType:campaign_summary` | Campaign summary event count. |
| Release Gate Status | `inssa-security-center-release-gate-status` | `data.product:INSSA AND data.source:web-app-qa-tests AND data.eventType:campaign_summary AND data.campaign:release-gate` | Latest release-gate status distribution. |
| Cleanup Queue Count | `inssa-security-center-cleanup-count` | `data.product:INSSA AND data.source:web-app-qa-tests AND (data.eventType:cleanup_audit OR data.classification:*cleanup*)` | Manual cleanup target count. |

### Navigation Cards

| Card | Saved object ID | Target |
| --- | --- | --- |
| Security Overview | `inssa-security-center-card-security-overview` | `/app/dashboards#/view/inssa-security-overview` |
| Campaign Operations | `inssa-security-center-card-campaign-operations` | `/app/dashboards#/view/inssa-campaign-operations` |
| Cleanup Queue | `inssa-security-center-card-cleanup-queue` | `/app/dashboards#/view/inssa-cleanup-queue` |
| Executive View | `inssa-security-center-card-executive-view` | `/app/dashboards#/view/inssa-executive-view` |

### Recent Activity

Saved search:

```text
inssa-security-center-recent-activity
```

Filter:

```text
data.product:INSSA AND data.source:web-app-qa-tests
```

Columns:

- `timestamp`
- `data.campaign`
- `data.classification`
- `data.severity`
- `data.status`
- `data.runId`

### Campaign Timeline

Saved object:

```text
inssa-security-center-campaign-timeline
```

Filter:

```text
data.product:INSSA AND data.source:web-app-qa-tests AND data.eventType:campaign_summary AND data.campaign:(security OR cross-user OR reveal-later OR release-gate)
```

Visualization:

- Date histogram by `timestamp`
- Split series by `data.campaign`

Expected campaign series:

- `security`
- `cross-user`
- `reveal-later`
- `release-gate`

### Findings Panels

| Widget | Saved object ID | Field |
| --- | --- | --- |
| Findings By Classification | `inssa-security-center-findings-by-classification` | `data.classification` |
| Findings By Severity | `inssa-security-center-findings-by-severity` | `data.severity` |

## Navigation Flow

Primary operator flow:

1. Open `INSSA Security Center`.
2. Review KPI row.
3. Use navigation cards for deeper views:
   - Security Overview for risk triage.
   - Campaign Operations for campaign health.
   - Cleanup Queue for staging cleanup debt.
   - Executive View for leadership summary.
4. Use Recent Activity to inspect latest events.
5. Use Campaign Timeline to validate campaign-summary ingestion and campaign cadence.

## Validation Results

Validation date: 2026-06-08

Dashboard rendered:

```text
INSSA Security Center - Wazuh
```

Observed KPI values during validation:

| KPI | Value |
| --- | ---: |
| Critical Findings | 0 |
| High Findings | 4 |
| Open Findings | 30 |
| Campaigns Run Last 30 Days | 7 |
| Cleanup Queue Count | 1 |

Release Gate Status:

```text
passed-with-warnings: 1
```

Campaign summary validation:

| Campaign | Count |
| --- | ---: |
| security | 4 |
| cross-user | 1 |
| release-gate | 1 |
| reveal-later | 1 |

Security finding validation:

```text
public-by-id visible: 1 event
```

Navigation validation:

| Target dashboard | Result |
| --- | --- |
| INSSA Security Overview | Reachable |
| INSSA Campaign Operations | Reachable |
| INSSA Cleanup Queue | Reachable |
| INSSA Executive View | Reachable |

Screenshots:

| Evidence | Path |
| --- | --- |
| Security Center | `reports/wazuh-security-center-implementation/inssa-security-center.png` |
| Security Overview target | `reports/wazuh-security-center-implementation/target-security-overview.png` |
| Campaign Operations target | `reports/wazuh-security-center-implementation/target-campaign-operations.png` |
| Cleanup Queue target | `reports/wazuh-security-center-implementation/target-cleanup-queue.png` |
| Executive View target | `reports/wazuh-security-center-implementation/target-executive-view.png` |
| Navigation validation JSON | `reports/wazuh-security-center-implementation/navigation-validation.json` |
| Data validation JSON | `reports/wazuh-security-center-implementation/data-validation.json` |

## Saved Object Export

Export file:

```text
exports/inssa-security-center.ndjson
```

Export contents:

| Saved object type | Count |
| --- | ---: |
| Dashboard | 5 |
| Visualization | 31 |
| Saved search | 10 |
| Index pattern | 1 |

The export includes:

- `INSSA Security Center`
- The four target INSSA dashboards
- INSSA dashboard visualizations
- INSSA saved searches
- `wazuh-alerts-*` index pattern

## Maintenance

Use these rules when updating the Security Center:

1. Keep all INSSA widgets filtered to `data.product:INSSA AND data.source:web-app-qa-tests`.
2. Do not use root fields such as `product` or `source` in Wazuh widgets; decoded fields are stored under `data.*`.
3. Do not add Wazuh infrastructure or SSH event sources to this dashboard.
4. Export `exports/inssa-security-center.ndjson` after any dashboard change.
5. Validate `campaign_summary` ingestion before relying on Campaign Timeline.
6. Capture screenshots after dashboard changes.
7. Do not modify Wazuh navigation or plugins as part of this dashboard.

## Recommended Next Step

If this dashboard becomes the operator entry point, consider setting a Wazuh default route after stakeholder approval:

```text
uiSettings.overrides.defaultRoute: /app/dashboards#/view/inssa-security-center
```

Do not set this globally until the team confirms all Wazuh users should land on INSSA first. If only INSSA users should land here, use a dedicated Wazuh/OpenSearch tenant and validate tenant-specific routing first.
