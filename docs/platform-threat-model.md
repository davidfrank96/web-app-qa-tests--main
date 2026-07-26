# QA Operations Platform Threat Model

## Assets

- Staging and production monitoring credentials.
- Supabase service-role credential and authenticated sessions.
- Campaign run history, logs, findings, and audit events.
- Evidence bundles, screenshots, traces, videos, and reports.
- Wazuh ingestion credential and SIEM event integrity.
- Worker job leases and scheduler occurrence keys.

## Trust Boundaries

```text
Operator browser
  -> authenticated Next.js API
  -> durable metadata / private evidence storage

Scheduler
  -> durable execution jobs
  -> worker
  -> Playwright / campaign scripts
  -> evidence and notification outbox

SIEM sender
  -> TLS + bearer authentication
  -> Nginx
  -> ingestion service
  -> Wazuh JSONL / logcollector
```

## Threats And Mitigations

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Anonymous SIEM ingestion | Forged findings and alert fatigue | Required shared credential, timing-safe comparison, fail-closed startup. |
| Credential-bearing SIEM event | Secret persistence in Wazuh | Sender and receiver reject bearer tokens, JWTs, signed URLs, and structured credential fields. |
| Artifact path traversal | Arbitrary server file disclosure | Metadata-only resolution, allowlisted roots, lexical checks, canonical `realpath` containment. |
| Symlink escape | Bypass of lexical path checks | Canonical repository/root/target validation before reads. |
| Secret leakage through logs | Credential disclosure to viewers | Redaction before persistence and again on historical API responses. |
| Secret leakage through reports | Durable credential disclosure | Textual response redaction and sensitive artifact classification. |
| Service-role key in browser | Full persistence compromise | Server-only environment variable; no `NEXT_PUBLIC_` service credential. |
| Vulnerable framework dependency | Auth bypass, XSS, SSRF, or DoS | Lockfile pinning, audit-clean Next/PostCSS graph, build regression. |
| Production campaign misuse | Product mutation or account impact | Command registry, RBAC, environment guards, explicit production monitoring confirmation. |
| Duplicate/replayed execution | Duplicate product activity and evidence | Durable job idempotency, leases, occurrence keys, and one-active-run policy. |

## Residual Risks

- Binary evidence can visually contain sensitive product content; capture discipline and private storage remain required.
- A compromised worker host can access test credentials and local scratch evidence.
- The Wazuh shared credential is a single deployment secret and requires rotation after suspected exposure.
- Historical ignored local artifacts may predate current redaction. They must remain outside Git and be retained only on controlled hosts.

## Review Triggers

Re-review this model before exposing lifecycle mutation campaigns, enabling SIEM send in the dashboard, adding a notification dispatcher, changing evidence access, or deploying another product.
