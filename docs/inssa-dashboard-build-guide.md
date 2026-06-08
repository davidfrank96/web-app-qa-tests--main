# INSSA Dashboard Build Guide

This guide describes how to build the Wazuh dashboards from INSSA QA events and `campaign_summary` exports.

## Index Pattern

Use the Wazuh alerts index pattern that contains decoded INSSA QA events.

Required fields:

```text
source
product
eventType
campaign
classification
severity
status
timestamp
rule.level
runId
campaignSummary.campaign
campaignSummary.runId
campaignSummary.status
campaignSummary.critical
campaignSummary.high
campaignSummary.medium
campaignSummary.low
campaignSummary.duration
campaignSummary.startedAt
campaignSummary.completedAt
artifactReference.path
reportReference.path
```

Base filter:

```text
source:web-app-qa-tests AND product:INSSA
```

## Saved Searches

| Saved Search | Query |
| --- | --- |
| INSSA Critical Findings | `source:web-app-qa-tests AND product:INSSA AND rule.level >= 14` |
| INSSA High Findings | `source:web-app-qa-tests AND product:INSSA AND rule.level >= 10` |
| INSSA Open Findings | `source:web-app-qa-tests AND product:INSSA AND status:(failed OR warning OR passed-with-findings OR passed-with-warnings)` |
| INSSA Campaign Summaries | `source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary` |
| INSSA Security Summaries | `source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary AND campaign:security` |
| INSSA Cross User Summaries | `source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary AND campaign:cross-user` |
| INSSA Reveal Later Summaries | `source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary AND campaign:reveal-later` |
| INSSA Release Gate Summaries | `source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary AND campaign:release-gate` |
| INSSA Cleanup Queue | `source:web-app-qa-tests AND product:INSSA AND (eventType:cleanup_audit OR classification:*cleanup*)` |

## Visualizations

### Critical Findings

Type:

```text
Metric
```

Query:

```text
source:web-app-qa-tests AND product:INSSA AND rule.level >= 14
```

Metric:

```text
Count
```

### High Findings

Type:

```text
Metric
```

Query:

```text
source:web-app-qa-tests AND product:INSSA AND rule.level >= 10
```

Metric:

```text
Count
```

### Findings By Severity

Type:

```text
Bar chart or donut
```

Query:

```text
source:web-app-qa-tests AND product:INSSA
```

Bucket:

```text
Terms on severity
```

### Findings By Classification

Type:

```text
Horizontal bar
```

Query:

```text
source:web-app-qa-tests AND product:INSSA
```

Bucket:

```text
Terms on classification
```

### Findings By Day

Type:

```text
Date histogram
```

Query:

```text
source:web-app-qa-tests AND product:INSSA
```

Time field:

```text
timestamp
```

### Campaign Success Rate

Type:

```text
Gauge or metric
```

Query:

```text
source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary
```

Calculation:

```text
count(status:passed OR status:passed-with-warnings OR status:passed-with-findings) / count(all campaign_summary events)
```

### Campaign Duration

Type:

```text
Line chart
```

Query:

```text
source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary AND campaignSummary.duration:*
```

Metric:

```text
Average campaignSummary.duration
```

Split series:

```text
campaign
```

### Cleanup Age

Type:

```text
Data table or date histogram
```

Query:

```text
source:web-app-qa-tests AND product:INSSA AND (eventType:cleanup_audit OR classification:*cleanup*)
```

Columns:

```text
timestamp
campaign
classification
status
runId
artifactReference.path
reportReference.path
```

## Filters

Use these as dashboard-level controls:

| Control | Field |
| --- | --- |
| Campaign | `campaign` |
| Event type | `eventType` |
| Severity | `severity` |
| Classification | `classification` |
| Status | `status` |
| Environment | `environment` |

## Queries

Security Overview:

```text
source:web-app-qa-tests AND product:INSSA AND eventType:(security_campaign OR lifecycle_campaign OR discovery_campaign OR cleanup_audit)
```

Campaign Operations:

```text
source:web-app-qa-tests AND product:INSSA AND eventType:campaign_summary
```

Cleanup Queue:

```text
source:web-app-qa-tests AND product:INSSA AND (eventType:cleanup_audit OR classification:*cleanup*)
```

## Dashboard Build Order

1. Create saved searches.
2. Build individual visualizations.
3. Assemble INSSA Security Overview.
4. Assemble INSSA Campaign Operations.
5. Assemble INSSA Cleanup Queue.
6. Add global filters.
7. Set default time ranges.
8. Validate with a fresh SIEM export and send.

## Validation

Generate data:

```bash
npm run siem:export
```

Confirm summary events:

```bash
node -e 'const j=require("./reports/siem/latest-siem-export.json"); console.log(j.events.filter(e=>e.eventType==="campaign_summary").map(e=>e.campaignSummary));'
```

Send to Wazuh:

```bash
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

Dashboard checks:

```text
Filter source:web-app-qa-tests.
Filter product:INSSA.
Filter eventType:campaign_summary.
Confirm security, cross-user, reveal-later, and release-gate summary events are visible.
Confirm Critical Findings and High Findings widgets match rule.level filters.
Confirm campaign history widgets show status and counts.
Confirm Cleanup Queue widgets show cleanup-related events when present.
```
