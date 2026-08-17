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
| Self-registration or unassigned-user access | Unauthorized private run/evidence access | Magic-link user creation disabled; role resolution denies identities without app-metadata role or explicit allowlist admission. |
| Credential stuffing or email bombing | Account compromise, provider abuse, or availability loss | Durable global/IP/account/combined rate limits with hashed scopes and `429 Retry-After`. |
| CSRF and host-header redirect abuse | Unauthorized state change or poisoned auth redirect | Canonical public origin, strict mutation Origin checks, JSON body enforcement, POST-only logout. |
| Expired access token | Dashboard remains open while APIs fail or role state becomes stale | Supabase SSR middleware refreshes cookies; central client `401` handling stops polling and returns to login. |
| Vulnerable framework dependency | Auth bypass, XSS, SSRF, or DoS | Lockfile pinning, audit-clean Next/PostCSS graph, build regression. |
| Production campaign misuse | Product mutation or account impact | Command registry, RBAC, environment guards, explicit production monitoring confirmation. |
| Duplicate/replayed execution | Duplicate product activity and evidence | Durable job idempotency, leases, occurrence keys, and one-active-run policy. |

## Residual Risks

- Binary evidence can visually contain sensitive product content; capture discipline and private storage remain required.
- A compromised worker host can access test credentials and local scratch evidence.
- The Wazuh shared credential is a single deployment secret and requires rotation after suspected exposure.
- Historical ignored local artifacts may predate current redaction. They must remain outside Git and be retained only on controlled hosts.
- Full Git history still requires separate disposition or approved rewriting when historical secret scanners identify removed investigation artifacts. The current-tree CI gate prevents new tracked credential material.

## Review Triggers

Re-review this model before exposing lifecycle mutation campaigns, enabling SIEM send in the dashboard, adding a notification dispatcher, changing evidence access, or deploying another product.
