# INSSA SIEM Disaster Recovery

This document defines recovery procedures for the INSSA QA to Wazuh integration.

## Recovery Priorities

1. Preserve existing Wazuh data and logs.
2. Restore event ingestion to `/var/ossec/logs/inssa-qa.log`.
3. Restore decoder and rules.
4. Restore dashboard visibility and alert routes.
5. Resume QA SIEM sends.

## Backup Locations

| Component | Primary Path | Backup Command |
| --- | --- | --- |
| Decoder | `/var/ossec/etc/decoders/local_decoder.xml` | `sudo cp /var/ossec/etc/decoders/local_decoder.xml /var/ossec/etc/decoders/local_decoder.xml.bak.$(date +%Y%m%d%H%M%S)` |
| Rules | `/var/ossec/etc/rules/local_rules.xml` | `sudo cp /var/ossec/etc/rules/local_rules.xml /var/ossec/etc/rules/local_rules.xml.bak.$(date +%Y%m%d%H%M%S)` |
| Ingestion service | `/opt/web-app-qa-tests/services/inssa-ingestion/` | `sudo tar -czf /opt/inssa-ingestion-backup-$(date +%Y%m%d%H%M%S).tgz /opt/web-app-qa-tests/services/inssa-ingestion` |
| Systemd unit | `/etc/systemd/system/inssa-ingestion.service` | `sudo cp /etc/systemd/system/inssa-ingestion.service /etc/systemd/system/inssa-ingestion.service.bak.$(date +%Y%m%d%H%M%S)` |
| Event log | `/var/ossec/logs/inssa-qa.log` | Preserve through Wazuh retention policy. |
| Nginx config | Active site config for `wazuh.kbeanprobo.com` | `sudo nginx -T > /tmp/nginx-effective-$(date +%Y%m%d%H%M%S).conf` |

## Decoder Recovery

Symptoms:

- Events are written to `/var/ossec/logs/inssa-qa.log`.
- Wazuh does not identify `source=web-app-qa-tests` or `product=INSSA`.
- `wazuh-logtest` does not show `decoder.name=inssa_qa`.

Recovery:

```bash
DECODER_BACKUP="/var/ossec/etc/decoders/local_decoder.xml.broken.$(date +%Y%m%d%H%M%S)"
sudo cp /var/ossec/etc/decoders/local_decoder.xml "$DECODER_BACKUP"
echo "$DECODER_BACKUP"
```

Restore the decoder XML from [wazuh-inssa-decoder.md](wazuh-inssa-decoder.md), then validate:

```bash
sudo /var/ossec/bin/wazuh-logtest
sudo systemctl restart wazuh-manager
sudo systemctl status wazuh-manager --no-pager
```

Rollback:

```bash
DECODER_RESTORE="$(ls -1t /var/ossec/etc/decoders/local_decoder.xml.broken.* | head -n 1)"
sudo cp "$DECODER_RESTORE" /var/ossec/etc/decoders/local_decoder.xml
sudo systemctl restart wazuh-manager
```

The restore command uses the newest decoder backup created by the recovery step.

## Rule Recovery

Symptoms:

- Decoder works.
- Events appear as INSSA.
- Expected levels or groups are missing.
- Critical classifications do not alert.

Recovery:

```bash
RULES_BACKUP="/var/ossec/etc/rules/local_rules.xml.broken.$(date +%Y%m%d%H%M%S)"
sudo cp /var/ossec/etc/rules/local_rules.xml "$RULES_BACKUP"
echo "$RULES_BACKUP"
```

Restore the rule XML from [wazuh-inssa-rules.md](wazuh-inssa-rules.md), then validate:

```bash
sudo /var/ossec/bin/wazuh-logtest
sudo systemctl restart wazuh-manager
sudo systemctl status wazuh-manager --no-pager
```

Rollback:

```bash
RULES_RESTORE="$(ls -1t /var/ossec/etc/rules/local_rules.xml.broken.* | head -n 1)"
sudo cp "$RULES_RESTORE" /var/ossec/etc/rules/local_rules.xml
sudo systemctl restart wazuh-manager
```

The restore command uses the newest rules backup created by the recovery step.

## Ingestion Service Recovery

Symptoms:

- `curl -s http://127.0.0.1:8088/healthz` fails.
- Nginx returns `502`.
- `sudo systemctl status inssa-ingestion --no-pager` shows failed.

Recovery:

```bash
sudo systemctl restart inssa-ingestion
sudo systemctl status inssa-ingestion --no-pager
sudo journalctl -u inssa-ingestion -n 100 --no-pager
```

If files are missing, redeploy:

```bash
sudo mkdir -p /opt/web-app-qa-tests/services
sudo rsync -a services/inssa-ingestion/ /opt/web-app-qa-tests/services/inssa-ingestion/
sudo cp /opt/web-app-qa-tests/services/inssa-ingestion/inssa-ingestion.service /etc/systemd/system/inssa-ingestion.service
sudo systemctl daemon-reload
sudo systemctl enable --now inssa-ingestion
```

Validate:

```bash
curl -s http://127.0.0.1:8088/healthz
```

## Nginx Recovery

Symptoms:

- Local ingestion health works.
- Public `https://wazuh.kbeanprobo.com/inssa` fails.
- Nginx returns `404`, `405` for wrong method only, or `502`.

Recovery:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo nginx -T | grep -n "location = /inssa" -A 20
```

Restore the location snippet from [wazuh-inssa-ingestion.md](wazuh-inssa-ingestion.md), then reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Rollback:

```bash
sudo nginx -T > /tmp/nginx-before-rollback.conf
sudo systemctl reload nginx
```

Use the platform Nginx configuration management process to revert the active site file to the last known-good version.

## Wazuh Recovery

Symptoms:

- Ingestion log receives events.
- Wazuh dashboard has no new documents.
- `/var/ossec/logs/ossec.log` shows logcollector, decoder, rules, manager, or indexer errors.

Recovery:

```bash
sudo systemctl status wazuh-manager --no-pager
sudo tail -n 200 /var/ossec/logs/ossec.log
sudo systemctl restart wazuh-manager
```

Validate localfile input exists:

```bash
sudo grep -n "inssa-qa.log" /var/ossec/etc/ossec.conf
```

Expected localfile:

```xml
<localfile>
  <log_format>json</log_format>
  <location>/var/ossec/logs/inssa-qa.log</location>
</localfile>
```

## End-To-End Recovery Validation

After any recovery, run:

```bash
curl -s http://127.0.0.1:8088/healthz
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
sudo tail -n 5 /var/ossec/logs/inssa-qa.log
sudo /var/ossec/bin/wazuh-logtest
```

Dashboard validation:

```text
Filter source:web-app-qa-tests.
Filter product:INSSA.
Confirm the latest sent event appears.
Confirm expected severity and classification.
```

## Rollback Procedures

Rollback order:

1. Stop sending new events from QA.
2. Revert Nginx route if public endpoint is misrouting.
3. Revert ingestion service if event writes are broken.
4. Revert decoder if parsing is broken.
5. Revert rules if alert routing is broken.
6. Restart Wazuh manager.
7. Send one validation event.

Commands:

```bash
sudo systemctl disable --now inssa-ingestion
sudo systemctl reload nginx
sudo systemctl restart wazuh-manager
```

Preserve `/var/ossec/logs/inssa-qa.log` unless retention policy requires removal.
