# Wazuh INSSA Event Ingestion

Phase 12C provides the missing HTTP ingestion endpoint for INSSA QA SIEM events.

Native Wazuh does not provide a generic custom JSON event HTTP endpoint. The INSSA ingestion service receives normalized INSSA QA events over HTTP, validates them, and writes one JSON object per line to:

```text
/var/ossec/logs/inssa-qa.log
```

The existing Wazuh decoder and rules then process that JSONL file.

## Architecture

```text
web-app-qa-tests
  npm run siem:export
  npm run siem:send
        |
        v
https://wazuh.kbeanprobo.com/inssa
        |
        v
Nginx TLS reverse proxy
        |
        v
127.0.0.1:8088/inssa
        |
        v
services/inssa-ingestion/server.js
        |
        v
/var/ossec/logs/inssa-qa.log
        |
        v
Wazuh decoder and rules
```

Related docs:

- [wazuh-inssa-decoder.md](wazuh-inssa-decoder.md)
- [wazuh-inssa-rules.md](wazuh-inssa-rules.md)
- [wazuh-inssa-integration.md](wazuh-inssa-integration.md)

## Event Schema

The receiver accepts `application/json` only.

Supported payload modes:

- Single event object.
- Batch object with an `events[]` array.

Required event fields:

```json
{
  "schemaVersion": "inssa-qa-siem.v1",
  "source": "web-app-qa-tests",
  "product": "INSSA",
  "eventType": "security_campaign",
  "timestamp": "2026-06-06T00:00:00.000Z",
  "campaign": "security",
  "environment": "staging",
  "severity": "high",
  "classification": "public-by-id",
  "status": "warning"
}
```

Accepted events are written as compact JSONL. Batch payloads are split into one event per line.

## Service Files

```text
services/inssa-ingestion/server.js
services/inssa-ingestion/inssa-ingestion.service
services/inssa-ingestion/nginx-inssa-ingestion.conf
services/inssa-ingestion/README.md
```

The service uses Node.js built-ins only. No npm package install is required.

## Runtime Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `INSSA_INGEST_HOST` | `127.0.0.1` | Bind host. Keep local when using Nginx. |
| `INSSA_INGEST_PORT` | `8088` | Bind port. |
| `INSSA_INGEST_PATH` | `/inssa` | Ingestion route. |
| `INSSA_INGEST_EVENT_LOG_PATH` | `/var/ossec/logs/inssa-qa.log` | Wazuh JSONL event output. |
| `INSSA_INGEST_REQUEST_LOG_PATH` | `/var/ossec/logs/inssa-qa-ingestion-requests.log` | Request metadata log. |
| `INSSA_INGEST_FAILURE_LOG_PATH` | `/var/ossec/logs/inssa-qa-ingestion-errors.log` | Failure diagnostics log. |
| `INSSA_INGEST_MAX_BODY_BYTES` | `1048576` | Request body limit. |
| `INSSA_INGEST_SHARED_TOKEN` | none | Required bearer credential; minimum 32 characters. |

Every client must send:

```text
Authorization: Bearer <token>
```

## Deployment

Target server:

```text
wazuh.kbeanprobo.com
```

Recommended install location:

```text
/opt/web-app-qa-tests
```

Copy the service:

```bash
sudo mkdir -p /opt/web-app-qa-tests/services
sudo rsync -a services/inssa-ingestion/ /opt/web-app-qa-tests/services/inssa-ingestion/
```

Create Wazuh-side log files:

```bash
sudo install -o root -g wazuh -m 0640 /dev/null /var/ossec/logs/inssa-qa.log
sudo install -o root -g wazuh -m 0640 /dev/null /var/ossec/logs/inssa-qa-ingestion-requests.log
sudo install -o root -g wazuh -m 0640 /dev/null /var/ossec/logs/inssa-qa-ingestion-errors.log
```

Create the root-readable credential file before installing the service:

```bash
sudo sh -c 'umask 077; printf "INSSA_INGEST_SHARED_TOKEN=%s\n" "$(openssl rand -hex 32)" > /etc/inssa-ingestion.env'
sudo chown root:root /etc/inssa-ingestion.env
sudo chmod 0600 /etc/inssa-ingestion.env
```

Install the service:

```bash
sudo cp /opt/web-app-qa-tests/services/inssa-ingestion/inssa-ingestion.service /etc/systemd/system/inssa-ingestion.service
sudo systemctl daemon-reload
sudo systemctl enable --now inssa-ingestion
```

Restart after credential rotation:

```bash
sudo systemctl restart inssa-ingestion
```

## Systemd Unit

Ready-to-paste unit:

```ini
[Unit]
Description=INSSA QA event ingestion receiver
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/web-app-qa-tests
ExecStart=/usr/bin/node /opt/web-app-qa-tests/services/inssa-ingestion/server.js
Environment=INSSA_INGEST_HOST=127.0.0.1
Environment=INSSA_INGEST_PORT=8088
Environment=INSSA_INGEST_PATH=/inssa
Environment=INSSA_INGEST_EVENT_LOG_PATH=/var/ossec/logs/inssa-qa.log
Environment=INSSA_INGEST_REQUEST_LOG_PATH=/var/ossec/logs/inssa-qa-ingestion-requests.log
Environment=INSSA_INGEST_FAILURE_LOG_PATH=/var/ossec/logs/inssa-qa-ingestion-errors.log
Environment=INSSA_INGEST_MAX_BODY_BYTES=1048576
EnvironmentFile=/etc/inssa-ingestion.env
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths=/var/ossec/logs

[Install]
WantedBy=multi-user.target
```

## Nginx Reverse Proxy

Install the location snippet inside the TLS server block for `wazuh.kbeanprobo.com`:

```nginx
location = /inssa {
    if ($request_method != POST) {
        return 405;
    }

    client_max_body_size 1m;
    proxy_http_version 1.1;
    proxy_pass http://127.0.0.1:8088/inssa;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_send_timeout 10s;
    proxy_read_timeout 10s;
}

location = /inssa/healthz {
    allow 127.0.0.1;
    deny all;
    proxy_pass http://127.0.0.1:8088/healthz;
}
```

Validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Firewall Requirements

Recommended:

- Public ingress: `443/tcp` only.
- Service bind: `127.0.0.1:8088`.
- Restrict `https://wazuh.kbeanprobo.com/inssa` to known QA runner IPs if feasible.
- Require `INSSA_INGEST_SHARED_TOKEN` for every deployment, including loopback validation.

Do not expose `8088/tcp` directly to the internet.

If a direct-port emergency test is required:

```bash
sudo ufw allow from <qa-runner-ip> to any port 8088 proto tcp
sudo ufw deny 8088/tcp
```

## Wazuh Localfile Input

Add the ingestion log to Wazuh:

```xml
<localfile>
  <log_format>json</log_format>
  <location>/var/ossec/logs/inssa-qa.log</location>
</localfile>
```

Restart Wazuh after adding localfile input, decoder, and rules:

```bash
sudo systemctl restart wazuh-manager
```

## Validation

Health check on the server:

```bash
curl -s http://127.0.0.1:8088/healthz
```

Single event through localhost:

```bash
curl -s -X POST http://127.0.0.1:8088/inssa \
  -H "authorization: Bearer ${INSSA_INGEST_SHARED_TOKEN}" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"inssa-qa-siem.v1","source":"web-app-qa-tests","product":"INSSA","eventType":"release_gate","timestamp":"2026-06-06T00:00:00.000Z","campaign":"release-gate","environment":"repository","severity":"informational","classification":"validation","status":"passed"}'
```

Batch mode from the QA repo:

```bash
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_WAZUH_TOKEN="${SIEM_WAZUH_TOKEN}" SIEM_SEND_BATCH=1 npm run siem:send
```

Event-by-event mode from the QA repo:

```bash
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_WAZUH_TOKEN="${SIEM_WAZUH_TOKEN}" npm run siem:send
```

Credential validation:

```bash
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_WAZUH_TOKEN=<token> SIEM_SEND_BATCH=1 npm run siem:send
```

Confirm event output:

```bash
sudo tail -n 5 /var/ossec/logs/inssa-qa.log
```

Confirm request logging:

```bash
sudo tail -n 5 /var/ossec/logs/inssa-qa-ingestion-requests.log
```

Confirm failure logging:

```bash
curl -s -X POST http://127.0.0.1:8088/inssa \
  -H "authorization: Bearer ${INSSA_INGEST_SHARED_TOKEN}" \
  -H 'content-type: text/plain' \
  --data 'bad'
sudo tail -n 5 /var/ossec/logs/inssa-qa-ingestion-errors.log
```

Confirm schema rejection:

```bash
curl -s -X POST http://127.0.0.1:8088/inssa \
  -H "authorization: Bearer ${INSSA_INGEST_SHARED_TOKEN}" \
  -H 'content-type: application/json' \
  --data '{"schemaVersion":"wrong","source":"web-app-qa-tests","product":"INSSA"}'
```

Expected result:

```json
{"ok":false,"error":"schema_validation_failed","message":"event.schemaVersion must be inssa-qa-siem.v1; received wrong."}
```

## Sender Configuration

The QA sender posts metadata only. It refuses screenshots, videos, traces, and unredacted token values.

Endpoint:

```bash
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa
```

Compatible aliases:

```bash
WAZUH_WEBHOOK_URL=https://wazuh.kbeanprobo.com/inssa
WAZUH_URL=https://wazuh.kbeanprobo.com/inssa
```

## Rollback

Stop the service:

```bash
sudo systemctl disable --now inssa-ingestion
sudo rm /etc/systemd/system/inssa-ingestion.service
sudo systemctl daemon-reload
```

Remove the Nginx location block and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Preserve `/var/ossec/logs/inssa-qa.log` unless the Wazuh retention policy requires removal.
