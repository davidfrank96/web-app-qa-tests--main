# INSSA Alert Runbook

This runbook covers notification failures, escalation failures, routing validation, and recovery procedures for INSSA QA Wazuh alerts.

Related documents:

- [inssa-alert-routing.md](inssa-alert-routing.md)
- [inssa-notification-testing.md](inssa-notification-testing.md)
- [inssa-siem-operations.md](inssa-siem-operations.md)
- [inssa-siem-disaster-recovery.md](inssa-siem-disaster-recovery.md)

## Notification Failure Response

Symptoms:

- Wazuh dashboard shows a matching alert, but Slack or email does not receive it.
- Security owner reports missing critical notification.
- High-risk alert appears only in dashboard.

Checks:

```text
Confirm the event exists in Wazuh Dashboard.
Confirm rule.level matches expected notification tier.
Confirm classification matches the routing model.
Confirm notification integration status in Wazuh.
Confirm channel webhook or email connector health.
```

Operational commands:

```bash
sudo tail -n 100 /var/ossec/logs/ossec.log
sudo /var/ossec/bin/wazuh-logtest
```

Recovery:

1. Confirm event ingestion is healthy.
2. Confirm decoder and rules are working.
3. Confirm Wazuh notification integration is enabled.
4. Send a validation event for the missing tier.
5. If delivery still fails, notify Platform and Security through an alternate communication channel.

## Escalation Failure Response

Symptoms:

- Critical alert is delivered but no owner acknowledges.
- High-risk alert is delivered but no ticket is created.
- Medium repeated findings are not promoted to weekly triage.

Escalation actions:

| Failure | Immediate Action |
| --- | --- |
| Critical not acknowledged in 15 minutes | Security lead contacts engineering owner directly. |
| Critical not acknowledged in 30 minutes | Security lead recommends incident creation. |
| High not acknowledged by same business day | QA owner escalates to Security and Engineering leads. |
| Medium repeated three times in seven days | QA owner adds to weekly security triage. |
| Informational report missing | QA owner includes finding in next weekly report. |

Required evidence:

- Wazuh event timestamp.
- Classification.
- Rule level.
- Campaign.
- Run ID.
- Screenshot or exported dashboard row if available.
- Report reference.

## Routing Validation

Run validation after any change to:

- Wazuh notification integration.
- Slack or email routing.
- Dashboard alert monitors.
- Security or engineering channel ownership.

Validation event command pattern:

```bash
curl -s -X POST https://wazuh.kbeanprobo.com/inssa \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:00:00.000Z","campaign":"notification-validation","environment":"staging","severity":"high","classification":"public-by-id","status":"warning"}'
```

If bearer-token protection is enabled, include:

```text
Authorization: Bearer the-configured-ingestion-token
```

Expected validation sequence:

1. Event is accepted by ingestion API.
2. Event appears in `/var/ossec/logs/inssa-qa.log`.
3. Wazuh decoder identifies INSSA event.
4. Wazuh rule assigns expected level.
5. Expected notification route receives event.
6. Unexpected notification routes remain quiet.

## Recovery Procedures

### Ingestion Healthy, Notification Missing

1. Verify event reached Wazuh:

```bash
sudo tail -n 5 /var/ossec/logs/inssa-qa.log
```

2. Verify rules:

```bash
sudo /var/ossec/bin/wazuh-logtest
```

3. Verify notification integration configuration in Wazuh Dashboard.

4. Send one validation event for the affected level.

5. If still missing, route manually:

```text
Critical: direct security escalation.
High: security and engineering channels.
Medium: QA channel and daily summary.
Informational: dashboard review only.
```

### Notification Delivered To Wrong Channel

1. Capture event classification and level.
2. Compare to [inssa-alert-routing.md](inssa-alert-routing.md).
3. Correct notification connector routing in Wazuh or notification middleware.
4. Send validation event.
5. Confirm corrected channel receives it.

### Duplicate Notification Storm

1. Confirm whether events share the same deduplication key:

```text
product + environment + classification + campaign + runId
```

2. Check if the source campaign is repeatedly sending the same export.

3. Apply allowed suppression only if it does not affect critical or high-risk visibility.

4. Preserve all events in Wazuh; suppress notification duplicates, not ingestion.

### Critical Notification Delivery Failure

1. Manually alert Security through the alternate incident channel.
2. Attach Wazuh dashboard evidence.
3. Assign owner.
4. Open incident record if validation confirms exposure.
5. Restore automated notification route after the incident is under control.

## Recovery Validation

After any alert routing recovery:

1. Send a level 3 validation event.
2. Send a level 7 validation event.
3. Send a level 10 validation event.
4. Send a level 14 validation event in a clearly marked validation context.
5. Confirm destinations match the routing model.
6. Confirm dashboard records all events.
7. Record validation result in release-gate notes.

## Operational Safety

Do not:

- Lower Wazuh rule levels to reduce notification volume.
- Disable ingestion to stop notifications.
- Drop events before Wazuh ingestion.
- Suppress critical classifications.
- Use production INSSA data for notification tests.

Do:

- Use clearly labeled validation events.
- Keep notification suppression separate from detection.
- Preserve dashboard visibility.
- Document every routing change.
