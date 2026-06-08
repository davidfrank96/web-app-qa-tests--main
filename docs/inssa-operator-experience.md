# INSSA Operator Experience

Document date: 2026-06-08

Primary dashboard:

```text
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

Scope:

```text
Operator workflow only.
No dashboards, visualizations, saved searches, Wazuh plugins, decoders, rules, ingestion services, or infrastructure were created or modified.
```

## Objective

Make INSSA practical for daily operators despite the current Wazuh discoverability constraint.

The dashboards, saved searches, and visualizations already exist. The operating model is:

```text
INSSA Security Center
  -> Security Overview
  -> Campaign Operations
  -> Cleanup Queue
  -> Executive View
  -> Recent Activity
  -> Discover saved searches
```

## Recommended Browser Bookmarks

Every INSSA operator should bookmark these URLs in this order:

| Bookmark | URL | Use |
| --- | --- | --- |
| INSSA Security Center | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center` | Daily starting point. |
| INSSA Security Overview | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-overview` | Security finding triage. |
| INSSA Campaign Operations | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-campaign-operations` | Campaign status and ingestion checks. |
| INSSA Cleanup Queue | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-cleanup-queue` | Staging cleanup tracking. |
| INSSA Executive View | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-executive-view` | Leadership/status review. |

Bookmark folder:

```text
Wazuh / INSSA
```

## Recommended Dashboard Startup Flow

Current reliable flow:

```text
Open INSSA Security Center bookmark
  -> Verify time range is Last 30 days
  -> Verify filter is data.product:INSSA AND data.source:web-app-qa-tests
  -> Review KPI row
  -> Use navigation cards for deeper review
```

Fallback if bookmarks are unavailable:

```text
Wazuh Home
  -> Explore
  -> Dashboards
  -> Search "INSSA Security Center"
  -> Open dashboard
```

Fast path after first use:

```text
Wazuh Home
  -> Recently viewed
  -> INSSA Security Center
```

## Fastest Paths

| Need | Fastest path |
| --- | --- |
| Security findings | INSSA Security Center -> Security Overview card |
| Campaign status | INSSA Security Center -> Campaign Operations card |
| Cleanup queue | INSSA Security Center -> Cleanup Queue card |
| Executive summary | INSSA Security Center -> Executive View card |
| Raw recent events | INSSA Security Center -> Recent Activity table |
| Critical finding rows | Explore -> Discover -> `INSSA Critical Findings` |
| High finding rows | Explore -> Discover -> `INSSA High Findings` |
| Open finding rows | Explore -> Discover -> `INSSA Open Findings` |
| Cleanup event rows | Explore -> Discover -> `INSSA Cleanup Queue` |

## Daily Workflow

Timebox:

```text
5-10 minutes
```

Steps:

1. Open `INSSA Security Center`.
2. Confirm the dashboard is scoped to `data.product:INSSA AND data.source:web-app-qa-tests`.
3. Review KPI row:
   - Critical Findings.
   - High Findings.
   - Open Findings.
   - Campaigns Run Last 30 Days.
   - Release Gate Status.
   - Cleanup Queue Count.
4. Check Recent Activity for new `failed`, `warning`, `public-by-id`, `media-publicly-accessible`, `unauthorized-visible`, or `authentication-bypass` events.
5. Open `Security Overview` if Critical, High, or Open Findings changed.
6. Open `Cleanup Queue` if Cleanup Queue Count is non-zero.
7. Record any required follow-up in the team tracker.

Daily pass criteria:

- Critical Findings is `0`.
- High findings are known, accepted, or ticketed.
- Release Gate Status is not `failed`.
- Cleanup Queue Count has an owner.
- Campaign summaries are visible after expected campaign runs.

## Weekly Workflow

Timebox:

```text
20-30 minutes
```

Steps:

1. Open `INSSA Campaign Operations`.
2. Confirm expected campaign cadence:
   - security
   - cross-user
   - reveal-later
   - release-gate
3. Review `INSSA Security Overview` for repeated classifications.
4. Review `INSSA Cleanup Queue` for aging cleanup targets.
5. Review `INSSA Executive View` for stakeholder status.
6. Confirm SIEM ingestion is current when campaigns ran during the week.

Weekly output:

- Campaign status summary.
- Open risk summary.
- Cleanup queue status.
- New or repeated finding list.

## Campaign Workflow

Use this workflow after any INSSA QA/security campaign run.

Steps:

1. Confirm local campaign output exists in the QA repo.
2. Confirm SIEM export/send completed.
3. Open `INSSA Campaign Operations`.
4. Confirm a new `campaign_summary` event is visible.
5. Open `INSSA Security Center`.
6. Confirm Recent Activity contains the new run ID.
7. If the campaign created live staging data, open `INSSA Cleanup Queue`.
8. Confirm cleanup evidence is visible or documented.

Campaign pass criteria:

- Campaign summary visible in Wazuh.
- Classification is preserved.
- Hard failures are not hidden as warnings.
- Cleanup targets are documented.

## Investigation Workflow

Use this workflow when a dashboard count changes or a new finding appears.

Steps:

1. Open `INSSA Security Center`.
2. Identify changed KPI or Recent Activity row.
3. Open the target dashboard:
   - Security finding -> `INSSA Security Overview`.
   - Campaign issue -> `INSSA Campaign Operations`.
   - Cleanup issue -> `INSSA Cleanup Queue`.
4. Open the matching Discover saved search for raw event rows.
5. Capture:
   - `data.campaign`
   - `data.runId`
   - `data.classification`
   - `data.severity`
   - `data.status`
   - `data.artifactReference.path`
   - `data.reportReference.path`
6. Compare against local repo evidence if needed.
7. Escalate according to risk classification.

Investigation saved searches:

| Saved search | Use |
| --- | --- |
| INSSA Critical Findings | Critical-finding triage. |
| INSSA High Findings | High-risk triage. |
| INSSA Open Findings | General open risk work queue. |
| INSSA Campaign Summaries | Campaign history. |
| INSSA Security Summaries | Security campaign summaries. |
| INSSA Cross User Summaries | Cross-user validation evidence. |
| INSSA Reveal Later Summaries | Reveal-later validation evidence. |
| INSSA Release Gate Summaries | Release-gate review. |
| INSSA Cleanup Queue | Cleanup target investigation. |

## Cleanup Workflow

Do not delete staging data from Wazuh.

Steps:

1. Open `INSSA Cleanup Queue`.
2. Identify cleanup target count and rows.
3. For each target, capture:
   - run ID
   - campaign
   - artifact path
   - report path
   - cleanup status
4. Notify the development team with exact cleanup target details.
5. After cleanup is confirmed externally, keep Wazuh evidence for audit history.

Cleanup escalation:

| Condition | Action |
| --- | --- |
| Cleanup target created today | Track in daily cleanup queue. |
| Cleanup target older than the agreed window | Escalate to dev owner. |
| Missing artifact path | Check local lifecycle/security campaign outputs. |
| Unknown cleanup status | Treat as open until dev confirms cleanup. |

## Risk Escalation

| Classification | Default owner | Response |
| --- | --- | --- |
| `authentication-bypass` | Security + Platform | Immediate escalation. |
| `unauthorized-visible` | Security + Engineering | Immediate escalation. |
| `public-by-id` | Security + Product + Engineering | High-risk review. |
| `media-publicly-accessible` | Security + Engineering | High-risk review. |
| `token-optional` | Security + Product | Policy review. |
| `share-link-only-visibility` | QA + Product | Visibility semantics review. |
| `reveal-protected` | QA | Evidence retained. |
| `expected-share-access` | QA | Evidence retained. |

## Operator Do / Do Not

Do:

- Start from `INSSA Security Center`.
- Preserve `data.product:INSSA AND data.source:web-app-qa-tests` filters.
- Use Discover saved searches for raw evidence.
- Keep cleanup targets explicit.
- Escalate critical/high classifications without downgrading.

Do not:

- Remove Wazuh filters to include infrastructure events in INSSA dashboards.
- Edit visualizations during an incident.
- Delete or modify Wazuh rules/decoders during daily operations.
- Treat Recently Viewed as the source of truth for navigation.
- Assume Wazuh Reporting has active INSSA reports; report definitions are currently empty.

## Current Operator Experience Verdict

```text
OPERATIONAL WITH DISCOVERABILITY WARNING
```

The operator workflow is usable today with bookmarks and the Security Center. The remaining discoverability problem is that new users do not land on INSSA automatically from Wazuh Home.

