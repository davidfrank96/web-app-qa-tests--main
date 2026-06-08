# INSSA Daily Operations

Document date: 2026-06-08

Primary dashboard:

```text
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

Supporting dashboards:

| Dashboard | URL |
| --- | --- |
| INSSA Security Overview | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-overview` |
| INSSA Campaign Operations | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-campaign-operations` |
| INSSA Cleanup Queue | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-cleanup-queue` |
| INSSA Executive View | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-executive-view` |

Base Wazuh filter:

```text
data.product:INSSA AND data.source:web-app-qa-tests
```

## Operational Review

Validation date: 2026-06-08

Validated dashboard saved objects:

| Dashboard | Panels | Status |
| --- | ---: | --- |
| INSSA Security Center | 14 | Available |
| INSSA Security Overview | 8 | Available |
| INSSA Campaign Operations | 7 | Available |
| INSSA Cleanup Queue | 3 | Available |
| INSSA Executive View | 7 | Available |

Validated live data:

| Metric | Value |
| --- | ---: |
| INSSA events | 53 |
| Critical Wazuh rule findings, `rule.level >= 14` | 0 |
| High Wazuh rule findings, `rule.level >= 10` | 4 |
| Open findings or warnings | 30 |
| Campaign summary events | 7 |
| Cleanup queue events | 1 |
| Release gate summary events | 1 |

Severity distribution in INSSA event metadata:

| Severity | Count |
| --- | ---: |
| critical | 17 |
| informational | 14 |
| high | 13 |
| medium | 9 |

Note:

```text
The Critical Findings KPI uses Wazuh rule level >= 14.
The severity distribution uses exported INSSA metadata in data.severity.
These are related but not identical signals.
```

Top campaign event sources:

| Campaign | Count |
| --- | ---: |
| text | 18 |
| reveal-later | 9 |
| security | 7 |
| media | 4 |
| video | 4 |
| release-gate | 2 |

Operational screenshots:

| Evidence | Path |
| --- | --- |
| Rendered Security Center | `reports/wazuh-operational-review/inssa-security-center-rendered.png` |
| Operational validation JSON | `reports/wazuh-operational-review/operational-review-validation.json` |

## Morning Review

Frequency:

```text
Every working day before active INSSA QA work starts.
```

Steps:

1. Open `INSSA Security Center`.
2. Confirm the dashboard filter is `data.product:INSSA AND data.source:web-app-qa-tests`.
3. Confirm the time range is `Last 30 days`.
4. Review KPI row in this order:
   - Critical Findings.
   - High Findings.
   - Open Findings.
   - Campaigns Run Last 30 Days.
   - Release Gate Status.
   - Cleanup Queue Count.
5. Confirm Campaign Timeline has recent `campaign_summary` data.
6. Check Recent Activity for new failed, high, or warning events.
7. Open `INSSA Cleanup Queue` if Cleanup Queue Count is non-zero.

Morning review pass criteria:

- No new critical rule-level findings.
- High findings are known or ticketed.
- Release gate status is not failed.
- Cleanup queue is known and assigned.
- Campaign summary ingestion is present.

Escalate when:

- Critical Findings is greater than `0`.
- Release Gate Status shows `failed`.
- Cleanup Queue Count grows without a cleanup owner.
- Campaign Summary Events is `0` after an expected campaign run.
- Recent Activity shows unexpected `unauthorized-visible`, `authentication-bypass`, `public-by-id`, or `media-publicly-accessible`.

## Security Findings Review

Primary dashboard:

```text
INSSA Security Overview
```

Review order:

1. Check Critical Findings.
2. Check High Findings.
3. Check Findings By Severity.
4. Check Findings By Classification.
5. Check Top Active Risks.

Classification handling:

| Classification | Operational response |
| --- | --- |
| `unauthorized-visible` | Treat as critical. Escalate immediately to Security and Engineering. |
| `authentication-bypass` | Treat as critical. Escalate immediately to Security and Platform. |
| `public-by-id` | Treat as high risk unless explicitly accepted by product policy. |
| `media-publicly-accessible` | Treat as high risk unless explicitly accepted by product policy. |
| `token-optional` | Treat as medium risk and review against share-link policy. |
| `share-link-only-visibility` | Usually warning/informational; confirm product expectations. |
| `reveal-protected` | Expected security-positive result. Retain for evidence. |
| `expected-share-access` | Expected when targeted share flow is validated. |

Security review output:

- Confirmed new findings.
- Existing findings still open.
- Risk level.
- Owner.
- Evidence link or dashboard reference.
- Next action.

## Campaign Review

Primary dashboard:

```text
INSSA Campaign Operations
```

Security Center widgets:

- Campaigns Run Last 30 Days.
- Campaign Timeline.
- Recent Activity.

Review order:

1. Confirm `campaign_summary` events exist.
2. Review Campaign Timeline for expected campaign cadence.
3. Check campaign statuses:
   - `passed`
   - `passed-with-findings`
   - `passed-with-warnings`
   - `failed`
4. Investigate any missing expected campaign:
   - security
   - cross-user
   - reveal-later
   - release-gate
5. Confirm `reports/siem/latest-siem-export.json` and Wazuh ingestion are current if a campaign was run locally.

Campaign review pass criteria:

- Expected campaign summaries are visible in Wazuh.
- Failed campaigns are understood and assigned.
- Warning campaigns have accepted or tracked findings.
- No campaign created staging data without cleanup evidence.

## Release Gate Review

Primary widget:

```text
Release Gate Status
```

Primary dashboard:

```text
INSSA Security Center
```

Review order:

1. Confirm `release-gate` campaign summary exists.
2. Confirm status:
   - `passed`
   - `passed-with-warnings`
   - `failed`
3. If `passed-with-warnings`, read the release-gate report before approving release.
4. If `failed`, block release until the failure is resolved or explicitly waived.
5. Confirm release-gate evidence is present in SIEM and local docs.

Release gate rules:

- `failed` blocks push/release.
- `passed-with-warnings` can proceed only with documented known risks.
- `passed` can proceed if cleanup status is also acceptable.

## Cleanup Review

Primary dashboard:

```text
INSSA Cleanup Queue
```

Review order:

1. Open `INSSA Cleanup Queue`.
2. Review Cleanup Queue Count.
3. Identify each cleanup event or capsule artifact.
4. Confirm whether cleanup is:
   - manual dev cleanup required
   - UI cleanup possible but not automated
   - already completed
   - stale/unknown
5. Confirm staging artifacts are documented in lifecycle/security reports.

Cleanup review pass criteria:

- Every known QA-created staging capsule has a cleanup target.
- Cleanup owner is identified.
- No cleanup item is older than the agreed retention window without explicit acceptance.

Do not:

- Delete capsules from Wazuh.
- Trigger app cleanup from Wazuh.
- Hide cleanup findings to make dashboards look green.

## Weekly Review

Frequency:

```text
Once per week.
```

Review:

1. Open `INSSA Executive View`.
2. Review high and critical trends.
3. Review Campaign Operations for the last 7 days.
4. Review Cleanup Queue aging.
5. Confirm all high-risk findings have tickets or accepted-risk status.
6. Confirm SIEM ingestion is current.
7. Confirm dashboard screenshots/evidence still render.
8. Review any operator feedback about discoverability.

Weekly outputs:

- Open findings summary.
- Campaign health summary.
- Cleanup status summary.
- New product/security questions.
- Dashboard usability issues.

## Monthly Review

Frequency:

```text
Monthly, before broader release planning.
```

Review:

1. Export INSSA saved objects.
2. Validate `exports/inssa-security-center.ndjson` still imports cleanly in a non-production Wazuh instance if available.
3. Review all security findings in `docs/inssa-security-findings.md`.
4. Review risk status in `docs/inssa-risk-matrix.md`.
5. Review cleanup debt.
6. Review whether the default route should point to `INSSA Security Center`.
7. Review whether a dedicated Wazuh/OpenSearch tenant is needed.
8. Review dashboard field drift:
   - `data.product`
   - `data.source`
   - `data.eventType`
   - `data.campaign`
   - `data.classification`
   - `data.severity`
   - `data.status`
   - `data.runId`

Monthly outputs:

- Current risk posture.
- Campaign reliability summary.
- Cleanup debt summary.
- Dashboard maintenance actions.
- Recommended next testing phase.

## Future Dashboard Design: INSSA Historical Trends

Status:

```text
Designed only. Do not build yet.
```

Purpose:

```text
Long-range trend analysis for engineering leadership, QA leadership, and security review.
```

Recommended dashboard:

```text
INSSA Historical Trends
```

Recommended time range:

```text
Last 6 months
```

Required widgets:

| Widget | Visualization | Query/filter | Notes |
| --- | --- | --- | --- |
| Findings By Month | Monthly date histogram | `data.product:INSSA AND data.source:web-app-qa-tests` | Split by `data.severity`. |
| Findings By Classification Over Time | Date histogram | `data.product:INSSA AND data.source:web-app-qa-tests` | Split by `data.classification`, top 10. |
| Release Gate Trends | Date histogram or table | `data.eventType:campaign_summary AND data.campaign:release-gate` | Split by `data.status`. |
| Campaign Trends | Date histogram | `data.eventType:campaign_summary` | Split by `data.campaign`. |
| Remediation Trends | Date histogram or stacked bar | Requires future `remediationStatus` or ticket metadata | Do not build until events include remediation fields. |
| Cleanup Aging Trend | Date histogram | `data.eventType:cleanup_audit OR data.classification:*cleanup*` | Track cleanup debt over time. |
| Repeated Findings | Terms table | `data.classification` | Sort by count over 6 months. |

Fields needed before building remediation trends:

- `owner`
- `ticketId`
- `remediationStatus`
- `firstSeenAt`
- `lastSeenAt`
- `acceptedRiskUntil`

Build readiness:

```text
Not ready until at least 2-3 months of stable campaign_summary and finding events exist.
```

## Five-Minute New Operator Assessment

Question:

```text
Can a new operator open Wazuh and understand INSSA within 5 minutes?
```

Assessment:

```text
Yes, if the operator is given the INSSA Security Center URL or if it is configured as the default route.
No, if the operator starts from the generic Wazuh home page with no instructions.
```

What works:

- Security Center has a clear KPI row.
- Navigation cards clearly point to the four deeper dashboards.
- Recent Activity exposes campaign, classification, severity, status, and run ID.
- Campaign Timeline confirms campaign summary ingestion.
- Cleanup Queue Count exposes cleanup debt immediately.

Usability gaps:

| Gap | Impact | Recommendation |
| --- | --- | --- |
| Generic Wazuh home does not expose an INSSA first-click destination. | New users may not find INSSA dashboards quickly. | Share the Security Center URL or configure default route after approval. |
| Dashboard route may render a blank Wazuh Overview shell if opened before entering the Dashboards app in some browser sessions. | Confusing first-load experience. | Bookmark the full Security Center URL and refresh once; consider default route or tenant landing page. |
| Wazuh rule-level critical count and INSSA metadata severity can differ. | Operators may misread `Critical Findings = 0` while severity chart shows critical metadata events. | Keep the note in this guide and consider renaming KPI to `Critical Rule Alerts`. |
| Historical remediation trends are not available yet. | Leadership cannot track time-to-remediate in Wazuh. | Add remediation metadata to future SIEM events before building Historical Trends. |
| No dedicated INSSA tenant yet. | INSSA content is organized by naming/filtering, not workspace isolation. | Consider an INSSA tenant if more users are onboarded. |

Recommended onboarding flow:

1. Give operator the `INSSA Security Center` URL.
2. Ask them to verify the base filter.
3. Explain the KPI row.
4. Explain navigation cards.
5. Explain that `campaign_summary` drives campaign timeline.
6. Explain cleanup queue ownership.
7. Point them to this guide for daily/weekly/monthly routines.

## Final Recommendation

Operational verdict:

```text
OPERATIONAL WITH USABILITY WARNINGS
```

The INSSA Security Center is usable for daily operations and all linked dashboards exist with real INSSA data. The main improvement needed is discoverability from the generic Wazuh home page. The lowest-risk fix is to make `INSSA Security Center` the documented entry point now, then evaluate `defaultRoute` or a dedicated tenant after operators confirm the workflow.
