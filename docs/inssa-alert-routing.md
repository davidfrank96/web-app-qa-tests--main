# INSSA Alert Routing

This document defines alert routing and escalation design for INSSA QA findings in Wazuh.

Scope:

```text
Notification and escalation design only.
No decoder, rule, ingestion service, or dashboard changes are defined here.
```

Related documents:

- [inssa-siem-runbook.md](inssa-siem-runbook.md)
- [inssa-dashboard-engineering.md](inssa-dashboard-engineering.md)
- [inssa-alert-runbook.md](inssa-alert-runbook.md)
- [inssa-notification-testing.md](inssa-notification-testing.md)
- [wazuh-inssa-rules.md](wazuh-inssa-rules.md)

## Routing Model

| Risk Tier | Wazuh Level | Example Classifications | Notification Actions | Response Target |
| --- | --- | --- | --- | --- |
| Critical Findings | 14 | `unauthorized-visible`, `authentication-bypass` | Email, Slack, incident creation recommendation | Immediate triage. |
| High Risk Findings | 10 | `public-by-id`, `media-publicly-accessible` | Security channel, engineering channel | Same business day ticket. |
| Medium Risk Findings | 7 | `share-link-only-visibility`, `token-optional` | QA channel, daily summary | Weekly triage unless repeated. |
| Informational Findings | 3 | `reveal-protected`, `expected-share-access` | Dashboard only, weekly report | Retention and trend review. |

Base event filter:

```text
source:web-app-qa-tests AND product:INSSA
```

## Notification Channels

| Channel | Purpose | Receives |
| --- | --- | --- |
| Security email distribution | Durable critical notification and audit trail. | Level 14. |
| Security Slack channel | Security triage and high-risk coordination. | Level 14 and level 10. |
| Engineering Slack channel | Product remediation visibility. | Level 14 and level 10. |
| QA Slack channel | Campaign drift, lifecycle visibility, medium findings. | Level 7. |
| Incident management system | Formal incident workflow. | Level 14 when validated or strongly suspected. |
| Wazuh dashboard | All INSSA events. | Level 3 and higher. |
| Weekly report | Executive and operational summary. | Level 3, level 7, high-risk trend data. |

## Notification Flow: Critical Findings

Trigger:

```text
rule.level >= 14
```

Examples:

- `unauthorized-visible`
- `authentication-bypass`

Flow:

1. Wazuh rule emits a level 14 alert.
2. Wazuh notification integration sends email to security distribution.
3. Wazuh notification integration posts to security Slack channel.
4. Security on-call reviews the dashboard event and linked report.
5. Security on-call recommends incident creation when validation confirms exposure.
6. Engineering owner is paged or tagged in the incident channel.
7. QA owner preserves artifact and reproduction evidence.

Required notification fields:

```text
timestamp
classification
severity
rule.level
campaign
environment
runId
artifactReference.path
reportReference.path
```

## Notification Flow: High Risk Findings

Trigger:

```text
rule.level >= 10 AND rule.level < 14
```

Examples:

- `public-by-id`
- `media-publicly-accessible`

Flow:

1. Wazuh rule emits a level 10 alert.
2. Notification posts to security Slack channel.
3. Notification posts to engineering Slack channel.
4. Security owner confirms whether risk is policy-accepted or remediation-required.
5. Engineering owner creates or links remediation ticket.
6. QA owner attaches campaign artifact and report reference.

## Notification Flow: Medium Risk Findings

Trigger:

```text
rule.level >= 7 AND rule.level < 10
```

Examples:

- `share-link-only-visibility`
- `token-optional`

Flow:

1. Wazuh rule emits a level 7 alert.
2. Event appears in the QA channel or daily summary.
3. QA owner reviews whether classification is expected product behavior or test drift.
4. Repeated medium findings are promoted to weekly security triage.

Promotion rule:

```text
Three or more matching medium findings in seven days require security review.
```

## Notification Flow: Informational Findings

Trigger:

```text
rule.level >= 3 AND rule.level < 7
```

Examples:

- `reveal-protected`
- `expected-share-access`

Flow:

1. Event appears on dashboard.
2. Event is retained for weekly report.
3. No real-time notification is sent unless paired with a higher-risk classification.

## Escalation Paths

| Finding | Primary Escalation | Secondary Escalation | Incident Recommendation |
| --- | --- | --- | --- |
| `unauthorized-visible` | Security | Engineering | Yes after validation. |
| `authentication-bypass` | Security | Platform and Engineering | Yes after validation. |
| `public-by-id` | Security | Engineering | Yes if private or pre-reveal content is exposed. |
| `media-publicly-accessible` | Security | Engineering and Platform | Yes if private media is externally retrievable. |
| `token-optional` | QA | Security | Yes if token was intended to enforce access. |
| `share-link-only-visibility` | QA | Product and Engineering | No unless it hides a lifecycle failure. |
| `reveal-protected` | QA | Product | No. |
| `expected-share-access` | QA | Product | No. |

## Ownership Matrix

| Area | QA | Security | Engineering | Platform |
| --- | --- | --- | --- | --- |
| Campaign execution evidence | Accountable | Consulted | Informed | Informed |
| Finding validation | Responsible | Accountable for high and critical | Consulted | Consulted for infra findings |
| Product behavior classification | Responsible | Consulted | Accountable | Informed |
| Access-control remediation | Consulted | Accountable for risk acceptance | Responsible | Consulted |
| Media/storage access remediation | Consulted | Accountable for risk acceptance | Responsible | Consulted |
| Wazuh notification delivery | Informed | Accountable | Informed | Responsible |
| Dashboard health | Responsible | Consulted | Informed | Responsible |
| Incident creation | Informed | Accountable | Consulted | Consulted |
| Closure verification | Responsible | Accountable for security closure | Responsible for fix evidence | Consulted |

## Acknowledgement Workflow

Critical:

1. Acknowledge notification in security Slack channel.
2. Confirm Wazuh event details and linked report.
3. Assign security owner and engineering owner.
4. Decide whether incident record is required.
5. Record acknowledgement timestamp in the incident or ticket system.

High:

1. Acknowledge in security or engineering Slack thread.
2. Create or link remediation ticket.
3. Assign engineering owner.
4. Record target review date.

Medium:

1. QA owner acknowledges in daily summary thread.
2. Classify as expected product behavior, product risk, or harness drift.
3. Add to weekly triage if repeated.

Informational:

1. No interactive acknowledgement required.
2. Retain on dashboard and weekly report.

## Closure Workflow

Required closure evidence:

- Original Wazuh event.
- Campaign run ID.
- Artifact path.
- Report path.
- Engineering fix reference or product decision.
- Revalidation command.
- Revalidation result.

Closure steps:

1. Confirm owner has resolved or accepted risk.
2. Run the relevant verification campaign.
3. Send updated SIEM export.
4. Confirm Wazuh classification no longer appears or is explicitly accepted.
5. Close ticket or incident with evidence links.

Recommended revalidation commands:

```bash
npm run test:inssa:campaign:security:verify
npm run test:inssa:campaign:cross-user
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

## Notification Suppression Rules

Allowed suppression:

| Condition | Suppression Scope | Duration |
| --- | --- | --- |
| Known accepted informational finding | Dashboard notification only | Until product policy changes. |
| Duplicate medium finding in same campaign run | Collapse into daily summary | Same day. |
| Repeated high finding with active ticket | Link to existing ticket, do not create duplicate ticket | Seven days. |
| Planned maintenance on Wazuh endpoint | Suppress delivery-failure escalation | Maintenance window only. |

Not allowed:

- Suppressing `unauthorized-visible`.
- Suppressing `authentication-bypass`.
- Suppressing high-risk media exposure without a linked ticket.
- Suppressing alerts by changing Wazuh decoder or rule levels.
- Suppressing by dropping SIEM events before ingestion.

## Alert Fatigue Protections

Controls:

- Group medium findings into a daily QA summary.
- Send informational findings to dashboard and weekly report only.
- Deduplicate events by `classification`, `campaign`, and `runId`.
- Require high-risk repeats to update the existing ticket when the same finding remains open.
- Keep critical alerts immediate and unsuppressed.
- Review alert volumes weekly and tune notification routing without changing detection rules.

Deduplication key:

```text
product + environment + classification + campaign + runId
```

## Routing Validation

Use these classifications for controlled validation:

| Classification | Expected Level | Expected Route |
| --- | --- | --- |
| `unauthorized-visible` | 14 | Email, security Slack, incident recommendation. |
| `authentication-bypass` | 14 | Email, security Slack, incident recommendation. |
| `public-by-id` | 10 | Security and engineering channels. |
| `media-publicly-accessible` | 10 | Security and engineering channels. |
| `share-link-only-visibility` | 7 | QA channel and daily summary. |
| `token-optional` | 7 | QA channel and daily summary. |
| `reveal-protected` | 3 | Dashboard and weekly report only. |
| `expected-share-access` | 3 | Dashboard and weekly report only. |

Validation procedure:

1. Send a known validation event.
2. Confirm Wazuh level and classification.
3. Confirm expected notification destinations.
4. Confirm suppressed destinations did not receive the event.
5. Record validation result in the release-gate notes.
