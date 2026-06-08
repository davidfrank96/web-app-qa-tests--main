# INSSA Ingestion Service

Lightweight Node.js receiver for INSSA QA SIEM events.

It accepts normalized INSSA QA events at `POST /inssa` and writes one JSON object per line to:

```text
/var/ossec/logs/inssa-qa.log
```

## Run Locally

```bash
node services/inssa-ingestion/server.js
```

No npm dependencies are required.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `INSSA_INGEST_HOST` | `127.0.0.1` | Bind host. |
| `INSSA_INGEST_PORT` | `8088` | Bind port. |
| `INSSA_INGEST_PATH` | `/inssa` | Ingestion route. |
| `INSSA_INGEST_EVENT_LOG_PATH` | `/var/ossec/logs/inssa-qa.log` | Wazuh JSONL event output. |
| `INSSA_INGEST_REQUEST_LOG_PATH` | `/var/ossec/logs/inssa-qa-ingestion-requests.log` | Request metadata log. |
| `INSSA_INGEST_FAILURE_LOG_PATH` | `/var/ossec/logs/inssa-qa-ingestion-errors.log` | Failure diagnostics log. |
| `INSSA_INGEST_MAX_BODY_BYTES` | `1048576` | Maximum request body size. |
| `INSSA_INGEST_SHARED_TOKEN` | empty | Optional bearer token requirement. |

## Accepted Payloads

- A single event object.
- A batch object with `events[]`.

Both modes validate `schemaVersion: "inssa-qa-siem.v1"`, `source: "web-app-qa-tests"`, and `product: "INSSA"`.
