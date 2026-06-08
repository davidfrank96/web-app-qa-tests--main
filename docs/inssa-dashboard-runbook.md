# INSSA Dashboard Runbook

This runbook covers maintenance, validation, troubleshooting, and recovery for INSSA Wazuh dashboards and saved searches.

Related documents:

- [inssa-dashboard-engineering.md](inssa-dashboard-engineering.md)
- [inssa-siem-operations.md](inssa-siem-operations.md)
- [inssa-siem-release-gate.md](inssa-siem-release-gate.md)
- [inssa-siem-disaster-recovery.md](inssa-siem-disaster-recovery.md)

## Dashboard Inventory

| Dashboard | Purpose | Primary Audience |
| --- | --- | --- |
| INSSA Security Overview | Security risk visibility and alert triage. | Security team. |
| INSSA QA Operations | Release gates, campaign status, cleanup, and latest findings. | QA and release owners. |
| INSSA Engineering Review | Remediation queue and product-risk review. | Engineering owners. |

## Saved Search Inventory

| Saved Search | Maintenance Check |
| --- | --- |
| INSSA Critical Findings | Confirm `rule.level >= 14` returns critical events when present. |
| INSSA High Risk Findings | Confirm `rule.level >= 10` returns high and critical events. |
| INSSA Release Gate Failures | Confirm failed release-gate events appear. |
| INSSA Security Campaign Findings | Confirm `eventType:security_campaign` events appear. |
| INSSA Lifecycle Campaign Findings | Confirm `eventType:lifecycle_campaign` events appear. |
| INSSA Cleanup Targets | Confirm cleanup audit or cleanup-classification events appear. |
| INSSA Cross User Findings | Confirm cross-user campaign and classifications appear. |
| INSSA Reveal Later Findings | Confirm reveal-later campaign and classifications appear. |

## Dashboard Maintenance

Daily during active QA windows:

1. Open INSSA Security Overview.
2. Confirm latest campaign event timestamp is within the expected QA run window.
3. Confirm critical and high metrics are populated when matching events exist.
4. Open INSSA QA Operations.
5. Confirm Release Gate Status reflects the latest release-gate event.
6. Confirm Cleanup Targets does not contain stale staging cleanup obligations.

Weekly:

1. Review all saved search definitions against [inssa-dashboard-engineering.md](inssa-dashboard-engineering.md).
2. Verify widget filters still use `source:web-app-qa-tests AND product:INSSA`.
3. Export or screenshot executive, engineering, and security reporting views for review records.
4. Confirm high-risk and critical findings have ticket or incident references outside Wazuh.
5. Confirm dashboard time ranges are appropriate for the review.

Monthly:

1. Validate dashboard fields still match SIEM event schema.
2. Review classification list for new campaign outputs.
3. Confirm dashboard objects are backed up or reproducible from documentation.
4. Review cleanup target age and staging data pollution.

## Dashboard Validation

Run a fresh SIEM send:

```bash
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

Confirm Wazuh ingestion:

```bash
sudo tail -n 5 /var/ossec/logs/inssa-qa.log
sudo tail -n 5 /var/ossec/logs/inssa-qa-ingestion-requests.log
```

Dashboard validation steps:

1. Open Wazuh Dashboard.
2. Set time range to last 24 hours.
3. Filter `source:web-app-qa-tests`.
4. Filter `product:INSSA`.
5. Confirm the latest event appears.
6. Open each saved search and confirm the query returns expected matching events or an explainable empty result.
7. Open each INSSA dashboard and confirm all widgets render.

Expected empty results:

| Saved Search | Empty Result Is Acceptable When |
| --- | --- |
| INSSA Critical Findings | No critical findings exist in selected time range. |
| INSSA Release Gate Failures | Latest release gates passed. |
| INSSA Cleanup Targets | No cleanup-audit or cleanup-classification events exist. |

Unexpected empty results:

| Saved Search | Investigation |
| --- | --- |
| INSSA Security Campaign Findings | Check SIEM export and eventType mapping. |
| INSSA Lifecycle Campaign Findings | Check lifecycle campaign artifacts and SIEM export. |
| INSSA High Risk Findings | Confirm Wazuh rules assign levels for high classifications. |

## Dashboard Troubleshooting

### No INSSA Events In Dashboard

Check ingestion log:

```bash
sudo tail -n 20 /var/ossec/logs/inssa-qa.log
```

If empty, check sender and ingestion service:

```bash
npm run siem:send -- --dry-run
sudo systemctl status inssa-ingestion --no-pager
curl -s http://127.0.0.1:8088/healthz
```

If the log has events, check Wazuh:

```bash
sudo tail -n 100 /var/ossec/logs/ossec.log
sudo /var/ossec/bin/wazuh-logtest
```

### Saved Search Returns Too Many Events

Verify it includes both required filters:

```text
source:web-app-qa-tests
product:INSSA
```

Then add the saved-search-specific filter from [inssa-dashboard-engineering.md](inssa-dashboard-engineering.md).

### Saved Search Returns No Events

Check:

```text
Time range
Field name spelling
Event type
Classification value
Rule level availability
```

Use a broader query first:

```text
source:web-app-qa-tests AND product:INSSA
```

Then narrow one field at a time.

### Rule Level Widgets Are Empty

Likely causes:

- Decoder is not matching INSSA events.
- Rules are not assigning expected levels.
- Dashboard index pattern does not expose `rule.level`.

Checks:

```bash
sudo /var/ossec/bin/wazuh-logtest
sudo tail -n 100 /var/ossec/logs/ossec.log
```

### Classification Widgets Are Empty

Likely causes:

- SIEM export did not include `classification`.
- Dashboard is reading the wrong index pattern.
- Time range excludes latest events.

Checks:

```bash
grep -n '"classification"' reports/siem/latest-siem-export.json
```

If campaign output is missing classification, rerun:

```bash
npm run siem:export
```

## Dashboard Recovery

Recovery order:

1. Confirm raw events exist in `/var/ossec/logs/inssa-qa.log`.
2. Confirm Wazuh decodes events with `wazuh-logtest`.
3. Recreate saved searches using [inssa-dashboard-engineering.md](inssa-dashboard-engineering.md).
4. Recreate dashboards using the widget tables in [inssa-dashboard-engineering.md](inssa-dashboard-engineering.md).
5. Validate all widgets against a known recent SIEM send.

Minimum dashboard recovery set:

| Object | Required Before Operational Use |
| --- | --- |
| INSSA Critical Findings saved search | Yes |
| INSSA High Risk Findings saved search | Yes |
| INSSA Security Overview dashboard | Yes |
| INSSA QA Operations dashboard | Yes |
| INSSA Engineering Review dashboard | Recommended for engineering review, not incident response. |

## Dashboard Backup

Use the Wazuh Dashboard saved object export function after any dashboard change.

Recommended backup naming:

```text
inssa-wazuh-dashboard-saved-objects-YYYYMMDD.ndjson
```

Store backups in the approved Wazuh administration backup location. Do not commit exported dashboard objects if they contain environment-specific index IDs, user names, or internal URLs.

## Dashboard Change Control

Before changing dashboard objects:

1. Export current saved objects.
2. Record reason for change.
3. Apply change in Wazuh Dashboard.
4. Validate with fresh SIEM send.
5. Confirm no saved search lost base filters.
6. Update [inssa-dashboard-engineering.md](inssa-dashboard-engineering.md) if the operational design changed.

## Recovery Validation

After dashboard recovery, run:

```bash
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

Then confirm:

```text
INSSA Security Overview renders.
INSSA QA Operations renders.
INSSA Engineering Review renders.
INSSA Critical Findings saved search opens.
INSSA High Risk Findings saved search opens.
Latest event appears with source=web-app-qa-tests and product=INSSA.
```
