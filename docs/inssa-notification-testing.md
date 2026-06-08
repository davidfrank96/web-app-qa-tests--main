# INSSA Notification Testing

This document defines validation scenarios, commands, and expected outcomes for INSSA alert routing.

Scope:

```text
Notification validation only.
Do not modify decoders, rules, ingestion services, or dashboards as part of these tests.
```

Related documents:

- [inssa-alert-routing.md](inssa-alert-routing.md)
- [inssa-alert-runbook.md](inssa-alert-runbook.md)
- [inssa-siem-release-gate.md](inssa-siem-release-gate.md)

## Test Prerequisites

Required operational state:

- INSSA ingestion service is running.
- Nginx proxies `https://wazuh.kbeanprobo.com/inssa`.
- Wazuh logcollector reads `/var/ossec/logs/inssa-qa.log`.
- INSSA decoder is active.
- INSSA rules are active.
- Wazuh dashboard shows INSSA events.
- Notification integrations are configured in Wazuh or the approved notification layer.

Health checks:

```bash
curl -s http://127.0.0.1:8088/healthz
sudo systemctl status inssa-ingestion --no-pager
sudo systemctl status wazuh-manager --no-pager
```

## Validation Commands

All commands use validation events. They do not run INSSA app lifecycle tests and do not create staging capsules.

Set endpoint:

```bash
export SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa
```

If bearer-token protection is enabled, configure the token in the sender environment or add the `Authorization` header to direct `curl` commands.

## Scenario 1: Informational Routing

Classification:

```text
reveal-protected
```

Command:

```bash
curl -s -X POST "$SIEM_WAZUH_URL" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:00:00.000Z","campaign":"notification-validation","environment":"staging","severity":"informational","classification":"reveal-protected","status":"passed"}'
```

Expected outcome:

| Check | Expected |
| --- | --- |
| Ingestion API | `202 accepted`. |
| Wazuh level | 3. |
| Dashboard | Event visible. |
| Slack/email | No real-time notification. |
| Weekly report | Included. |

## Scenario 2: Medium Routing

Classification:

```text
token-optional
```

Command:

```bash
curl -s -X POST "$SIEM_WAZUH_URL" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:01:00.000Z","campaign":"notification-validation","environment":"staging","severity":"medium","classification":"token-optional","status":"warning"}'
```

Expected outcome:

| Check | Expected |
| --- | --- |
| Ingestion API | `202 accepted`. |
| Wazuh level | 7. |
| QA channel | Receives event or daily summary entry. |
| Security channel | No immediate notification unless repeated threshold is met. |
| Dashboard | Event visible. |

## Scenario 3: High Routing

Classification:

```text
public-by-id
```

Command:

```bash
curl -s -X POST "$SIEM_WAZUH_URL" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:02:00.000Z","campaign":"notification-validation","environment":"staging","severity":"high","classification":"public-by-id","status":"warning"}'
```

Expected outcome:

| Check | Expected |
| --- | --- |
| Ingestion API | `202 accepted`. |
| Wazuh level | 10. |
| Security channel | Receives event. |
| Engineering channel | Receives event. |
| Ticket | Recommended same business day. |
| Dashboard | Event visible. |

## Scenario 4: Critical Routing

Classification:

```text
unauthorized-visible
```

Command:

```bash
curl -s -X POST "$SIEM_WAZUH_URL" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:03:00.000Z","campaign":"notification-validation","environment":"staging","severity":"critical","classification":"unauthorized-visible","status":"failed"}'
```

Expected outcome:

| Check | Expected |
| --- | --- |
| Ingestion API | `202 accepted`. |
| Wazuh level | 14. |
| Email | Receives critical alert. |
| Security channel | Receives immediate alert. |
| Incident | Creation recommended after validation. |
| Dashboard | Event visible. |

## Scenario 5: Batch Notification Validation

Command:

```bash
curl -s -X POST "$SIEM_WAZUH_URL" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","events":[{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:04:00.000Z","campaign":"notification-validation","environment":"staging","severity":"informational","classification":"expected-share-access","status":"passed"},{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:05:00.000Z","campaign":"notification-validation","environment":"staging","severity":"high","classification":"media-publicly-accessible","status":"warning"}]}'
```

Expected outcome:

| Check | Expected |
| --- | --- |
| Ingestion API | `202 accepted` with `accepted:2`. |
| Event log | Two JSON lines appended. |
| Informational route | Dashboard and weekly report only. |
| High route | Security and engineering channels. |

## Scenario 6: Suppression Validation

Purpose:

```text
Confirm duplicate medium findings are grouped into daily summary while still appearing in Wazuh.
```

Procedure:

1. Send the medium `token-optional` validation event twice with the same `campaign` and `runId`.
2. Confirm both events are visible in Wazuh.
3. Confirm notification layer groups or suppresses duplicate channel noise.
4. Confirm no suppression applies to level 14 validation events.

Expected outcome:

| Check | Expected |
| --- | --- |
| Wazuh events | Both retained. |
| Medium notification | Deduplicated or summarized. |
| Critical notification | Never suppressed. |

## Scenario 7: Notification Failure Drill

Purpose:

```text
Confirm team response when notification delivery fails but dashboard detection works.
```

Procedure:

1. Use Wazuh dashboard to identify a validation event.
2. Simulate unavailable Slack/email integration through the approved Wazuh administration method.
3. Send a high-risk validation event.
4. Confirm dashboard receives event.
5. Confirm runbook manual escalation path is followed.
6. Restore notification integration.
7. Send another high-risk validation event.
8. Confirm notification delivery.

Expected outcome:

| Check | Expected |
| --- | --- |
| Dashboard detection | Works during notification outage. |
| Manual escalation | Security and engineering are notified through alternate route. |
| Recovery | Notification resumes after integration is restored. |

## Evidence To Capture

For each validation scenario:

- Timestamp.
- Classification.
- Wazuh rule level.
- Destination channel result.
- Dashboard screenshot or event row.
- Whether unexpected destinations stayed quiet.
- Operator who validated the route.

## Pass Criteria

Notification testing passes when:

- Level 14 routes to email, security Slack, and incident recommendation.
- Level 10 routes to security and engineering channels.
- Level 7 routes to QA channel or daily summary.
- Level 3 remains dashboard and weekly report only.
- Duplicate medium findings are deduplicated in notification channels but preserved in Wazuh.
- Critical notifications are never suppressed.

## Fail Criteria

Notification testing fails when:

- Critical events do not notify security immediately.
- High-risk events do not notify security and engineering.
- Medium or informational findings notify critical channels without configured promotion.
- Notification suppression hides events from Wazuh.
- The wrong environment, source, or product is routed as an INSSA alert.
