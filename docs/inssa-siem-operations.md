# INSSA SIEM Operations

This runbook standardizes daily and weekly operation of the INSSA QA to Wazuh integration.

## Operating Scope

Target environment:

```text
https://staging.inssa.us
```

Wazuh endpoint:

```text
https://wazuh.kbeanprobo.com/inssa
```

Operational goal:

```text
INSSA QA campaign evidence is exported, ingested, decoded, classified, indexed, and visible in dashboards.
```

## Daily Operations

1. Check ingestion service health:

```bash
sudo systemctl status inssa-ingestion --no-pager
curl -s http://127.0.0.1:8088/healthz
```

2. Check Nginx health:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
```

3. Check Wazuh manager health:

```bash
sudo systemctl status wazuh-manager --no-pager
sudo tail -n 50 /var/ossec/logs/ossec.log
```

4. Check latest INSSA ingestion:

```bash
sudo tail -n 20 /var/ossec/logs/inssa-qa.log
sudo tail -n 20 /var/ossec/logs/inssa-qa-ingestion-requests.log
sudo tail -n 20 /var/ossec/logs/inssa-qa-ingestion-errors.log
```

5. Check dashboard freshness:

```text
Open Wazuh Dashboard.
Filter source:web-app-qa-tests.
Filter product:INSSA.
Confirm the latest event timestamp matches the most recent QA send.
```

## Weekly Review Process

1. Run the safe INSSA suite:

```bash
npm run test:inssa:safe
```

2. Run the security campaign:

```bash
npm run test:inssa:campaign:security
```

3. Export and send SIEM events:

```bash
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

4. Review Wazuh dashboard counts by severity:

```text
Critical
High
Medium
Low
Informational
```

5. Review open cleanup targets from campaign artifacts and reports.

6. Confirm high-risk findings have an owner and ticket.

## Verify Ingestion

From the Wazuh host:

```bash
curl -s http://127.0.0.1:8088/healthz
```

Expected:

```json
{"ok":true,"service":"inssa-ingestion","schemaVersion":"inssa-qa-siem.v1"}
```

Send a validation event locally:

Load `INSSA_INGEST_SHARED_TOKEN` from `/etc/inssa-ingestion.env` in a root-controlled shell before running this request.

```bash
curl -s -X POST http://127.0.0.1:8088/inssa \
  -H "authorization: Bearer ${INSSA_INGEST_SHARED_TOKEN}" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"release_gate","timestamp":"2026-06-06T00:00:00.000Z","campaign":"release-gate","environment":"repository","severity":"informational","classification":"validation","status":"passed"}'
```

Confirm append:

```bash
sudo tail -n 1 /var/ossec/logs/inssa-qa.log
```

## Verify Alerts

Run Wazuh logtest:

```bash
sudo /var/ossec/bin/wazuh-logtest
```

Paste:

```json
{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:00:00.000Z","campaign":"security","environment":"staging","severity":"high","classification":"public-by-id","status":"warning"}
```

Expected:

```text
decoder.name=inssa_qa
classification=public-by-id
rule level=10
group contains inssa_qa
```

## Verify Dashboard Health

Dashboard checks:

| Check | Expected Result |
| --- | --- |
| Filter `source:web-app-qa-tests` | INSSA QA events are visible. |
| Filter `product:INSSA` | Only INSSA events remain. |
| Filter `classification:public-by-id` | High-risk access-control findings are visible when present. |
| Filter `classification:unauthorized-visible` | Critical findings alert immediately when present. |
| Time range last 24 hours | Recent campaign sends appear. |

If events exist in `/var/ossec/logs/inssa-qa.log` but not in the dashboard, inspect Wazuh manager, decoder, rules, indexer, and dashboard health in that order.

## Service Status Commands

Ingestion:

```bash
sudo systemctl status inssa-ingestion --no-pager
sudo journalctl -u inssa-ingestion -n 100 --no-pager
sudo systemctl restart inssa-ingestion
```

Nginx:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo journalctl -u nginx -n 100 --no-pager
sudo systemctl reload nginx
```

Wazuh:

```bash
sudo systemctl status wazuh-manager --no-pager
sudo tail -n 100 /var/ossec/logs/ossec.log
sudo systemctl restart wazuh-manager
```

## Log Locations

| Log | Path |
| --- | --- |
| INSSA accepted events | `/var/ossec/logs/inssa-qa.log` |
| INSSA request metadata | `/var/ossec/logs/inssa-qa-ingestion-requests.log` |
| INSSA ingestion failures | `/var/ossec/logs/inssa-qa-ingestion-errors.log` |
| Wazuh manager | `/var/ossec/logs/ossec.log` |
| Nginx access | Distribution-specific Nginx access log path. |
| Nginx error | Distribution-specific Nginx error log path. |

## Nginx Locations

Expected reverse proxy routes:

```text
/inssa
/inssa/healthz
```

Expected proxy target:

```text
http://127.0.0.1:8088/inssa
```

Validate:

```bash
sudo nginx -T | grep -n "location = /inssa" -A 20
```

## Wazuh Locations

| Item | Path |
| --- | --- |
| Decoder file | `/var/ossec/etc/decoders/local_decoder.xml` |
| Rule file | `/var/ossec/etc/rules/local_rules.xml` |
| Event log input | `/var/ossec/logs/inssa-qa.log` |
| Manager log | `/var/ossec/logs/ossec.log` |
| Logtest binary | `/var/ossec/bin/wazuh-logtest` |

## Troubleshooting Guide

### Sender Cannot Reach Endpoint

Command:

```bash
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_WAZUH_TOKEN="${SIEM_WAZUH_TOKEN}" SIEM_SEND_BATCH=1 npm run siem:send
```

Checks:

```bash
curl -i https://wazuh.kbeanprobo.com/inssa
sudo systemctl status nginx --no-pager
sudo systemctl status inssa-ingestion --no-pager
```

Expected `GET /inssa` can return `405`; authenticated `POST /inssa` with valid JSON should return `202`, while a missing or invalid bearer credential must return `401`.

### Events Accepted But Not Visible

Checks:

```bash
sudo tail -n 5 /var/ossec/logs/inssa-qa.log
sudo tail -n 100 /var/ossec/logs/ossec.log
sudo /var/ossec/bin/wazuh-logtest
```

Recovery:

```bash
sudo systemctl restart wazuh-manager
```

If decoder or rules fail logtest, restore from the documented XML in [wazuh-inssa-decoder.md](wazuh-inssa-decoder.md) and [wazuh-inssa-rules.md](wazuh-inssa-rules.md).

### Schema Validation Fails

Check failure log:

```bash
sudo tail -n 20 /var/ossec/logs/inssa-qa-ingestion-errors.log
```

Typical causes:

- Missing `schemaVersion`.
- Wrong `schemaVersion`.
- Missing required event fields.
- Batch object does not contain valid `events[]`.

### Payload Too Large

The receiver defaults to a 1 MB body limit.

Checks:

```bash
sudo tail -n 20 /var/ossec/logs/inssa-qa-ingestion-errors.log
```

Expected response:

```json
{"ok":false,"error":"payload_too_large","maxBodyBytes":1048576}
```

Resolution:

```text
Reduce event payload size. Do not send screenshots, videos, traces, or full raw artifacts to SIEM.
```
