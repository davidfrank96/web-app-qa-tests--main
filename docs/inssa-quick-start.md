# INSSA Quick Start

Goal:

```text
A new engineer can access INSSA in Wazuh and understand the platform within 5 minutes.
```

Primary URL:

```text
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

## Minute 0-1: Open INSSA

1. Open the primary URL.
2. Sign in to Wazuh if prompted.
3. Confirm the dashboard title is `INSSA Security Center`.

If the direct URL is unavailable, use:

```text
Wazuh Home
  -> Explore
  -> Dashboards
  -> Search "INSSA Security Center"
  -> Open
```

## Minute 1-2: Understand the Dashboard

The top row answers:

| Widget | Meaning |
| --- | --- |
| Critical Findings | Immediate critical Wazuh-rule findings for INSSA. |
| High Findings | High and critical Wazuh-rule findings for INSSA. |
| Open Findings | Open failures, warnings, or findings. |
| Campaigns Run Last 30 Days | Campaign summary ingestion count. |
| Release Gate Status | Latest release-gate result distribution. |
| Cleanup Queue Count | Manual staging cleanup targets. |

Base filter:

```text
data.product:INSSA AND data.source:web-app-qa-tests
```

## Minute 2-3: Open the Right View

Use these cards:

| Card | Use |
| --- | --- |
| Security Overview | Investigate findings and risks. |
| Campaign Operations | Check campaign history and status. |
| Cleanup Queue | Find staging cleanup targets. |
| Executive View | Review summarized status. |

## Minute 3-4: Know What Matters

Escalate immediately:

- `authentication-bypass`
- `unauthorized-visible`

Review as high risk:

- `public-by-id`
- `media-publicly-accessible`

Track as policy/visibility findings:

- `token-optional`
- `share-link-only-visibility`

Expected evidence-positive states:

- `reveal-protected`
- `expected-share-access`

## Minute 4-5: Save Bookmarks

Create browser folder:

```text
Wazuh / INSSA
```

Add:

| Bookmark | URL |
| --- | --- |
| INSSA Security Center | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center` |
| INSSA Security Overview | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-overview` |
| INSSA Campaign Operations | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-campaign-operations` |
| INSSA Cleanup Queue | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-cleanup-queue` |
| INSSA Executive View | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-executive-view` |

## Daily Use

Start here:

```text
INSSA Security Center
```

Then:

1. Check Critical Findings.
2. Check High Findings.
3. Check Open Findings.
4. Check Campaigns Run Last 30 Days.
5. Check Release Gate Status.
6. Check Cleanup Queue Count.

## If Something Looks Wrong

| Symptom | Action |
| --- | --- |
| Dashboard shows no data | Confirm time range is Last 30 days and filter is INSSA-scoped. |
| Campaign expected but missing | Open `INSSA Campaign Operations`. |
| Critical/high count changed | Open `INSSA Security Overview`. |
| Cleanup count is non-zero | Open `INSSA Cleanup Queue`. |
| Need raw event rows | Use Discover saved searches. |

## More Detail

Read:

- [inssa-operator-experience.md](inssa-operator-experience.md)
- [inssa-daily-operations.md](inssa-daily-operations.md)
- [inssa-security-center.md](inssa-security-center.md)
- [wazuh-navigation-map.md](wazuh-navigation-map.md)

## Quick Start Verdict

```text
PASS WITH BOOKMARK REQUIREMENT
```

The 5-minute goal is met if the operator has the Security Center URL or bookmark. Without that, a new operator must know the fallback path through Explore and Dashboards.

