# INSSA SIEM Release Gate

This checklist must pass before changing or releasing the INSSA QA to Wazuh integration.

## Scope

Applies to:

- SIEM export scripts.
- `send-to-wazuh.js`.
- INSSA ingestion service.
- Nginx `/inssa` reverse proxy.
- Wazuh localfile collection.
- INSSA decoder.
- INSSA rules.
- Dashboard and alert routing.

## Pre-Deployment Checklist

| Check | Command Or Evidence | Pass Criteria |
| --- | --- | --- |
| Decoder loaded | `sudo /var/ossec/bin/wazuh-logtest` | INSSA event shows `decoder.name=inssa_qa`. |
| Rules loaded | `sudo /var/ossec/bin/wazuh-logtest` | Known classifications map to expected levels. |
| Ingestion service running | `sudo systemctl status inssa-ingestion --no-pager` | Service is active. |
| Ingestion health passes | `curl -s http://127.0.0.1:8088/healthz` | Returns `ok:true`. |
| Nginx config valid | `sudo nginx -t` | Syntax is successful. |
| Nginx route present | `sudo nginx -T | grep -n "location = /inssa" -A 20` | `/inssa` proxies to `127.0.0.1:8088/inssa`. |
| Logcollector monitoring | `sudo grep -n "inssa-qa.log" /var/ossec/etc/ossec.conf` | Localfile input references `/var/ossec/logs/inssa-qa.log`. |
| Event log writable | Local validation POST, then `sudo tail -n 1 /var/ossec/logs/inssa-qa.log` | One JSON object is appended. |
| Request logging works | `sudo tail -n 1 /var/ossec/logs/inssa-qa-ingestion-requests.log` | Request metadata appears. |
| Failure logging works | Invalid schema POST, then `sudo tail -n 1 /var/ossec/logs/inssa-qa-ingestion-errors.log` | Schema failure appears. |
| Dashboard receiving events | Wazuh dashboard filter `source:web-app-qa-tests AND product:INSSA` | Latest validation event appears. |
| SIEM send successful | `SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send` | Sender exits successfully. |
| Alerts generated | Logtest or dashboard validation for `public-by-id` | Expected Wazuh level and group are present. |

## Local QA Repository Checks

Run before release:

```bash
node --check services/inssa-ingestion/server.js
node --check scripts/siem/send-to-wazuh.js
git diff --check -- services/inssa-ingestion scripts/siem docs
npm run siem:export
npm run siem:send -- --dry-run
```

Pass criteria:

- Node syntax checks pass.
- `git diff --check` has no whitespace errors.
- SIEM export is generated.
- Dry-run prints event count, severity counts, status counts, and the Wazuh endpoint example.

## Wazuh Validation Payloads

Informational:

```json
{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:00:00.000Z","campaign":"security","environment":"staging","severity":"informational","classification":"reveal-protected","status":"passed"}
```

High:

```json
{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:00:00.000Z","campaign":"security","environment":"staging","severity":"high","classification":"public-by-id","status":"warning"}
```

Critical:

```json
{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","timestamp":"2026-06-06T00:00:00.000Z","campaign":"security-verification","environment":"staging","severity":"critical","classification":"unauthorized-visible","status":"failed"}
```

## Pass Criteria

The release gate passes when:

- Decoder recognizes INSSA QA events.
- Rules map classifications to the documented Wazuh levels.
- Ingestion service is active and healthy.
- Nginx proxies `POST /inssa` to the local service.
- Missing ingestion credentials prevent service startup, and anonymous POSTs return `401`.
- Valid single-event and batch payloads append one JSON object per line.
- Invalid schema and oversized payloads are rejected.
- Wazuh Logcollector reads `/var/ossec/logs/inssa-qa.log`.
- Dashboard shows latest events.
- Critical and high classifications route according to alert policy.
- Documentation links resolve within `docs/`.

## Fail Criteria

The release gate fails when:

- Production or non-INSSA events are accepted as valid INSSA QA events.
- `schemaVersion` validation is bypassed.
- Valid events do not reach `/var/ossec/logs/inssa-qa.log`.
- Events reach the log but Wazuh does not decode them.
- Rules do not classify critical or high findings correctly.
- The sender attempts to send screenshots, videos, traces, or unredacted tokens.
- The public endpoint is exposed without TLS.
- The dashboard cannot show the latest validation event.

## Release Decision

Use one of these outcomes:

| Verdict | Meaning |
| --- | --- |
| `PASS` | All checks pass and no cleanup or product warning blocks release. |
| `PASS WITH WARNINGS` | Platform is operational with documented product findings or manual cleanup targets. |
| `BLOCKED` | Any fail criterion is present. Do not release. |

## Post-Deployment Verification

Run:

```bash
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

Then verify:

```bash
sudo tail -n 5 /var/ossec/logs/inssa-qa.log
sudo tail -n 5 /var/ossec/logs/inssa-qa-ingestion-requests.log
```

Dashboard:

```text
Filter source:web-app-qa-tests.
Filter product:INSSA.
Confirm the latest campaign event is visible.
Confirm severity and classification match the SIEM export.
```
