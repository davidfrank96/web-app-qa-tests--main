# QA Operations Platform Security Guide

## Security Boundary

The dashboard, worker, scheduler, metadata store, evidence storage, and Wazuh ingestion service are server-side trusted components. Browsers, campaign output, report content, incoming SIEM payloads, and filesystem metadata are untrusted inputs. Authentication does not make an artifact safe: every path and every textual output must still be validated.

## Authentication And Authorization

- Supabase Auth establishes dashboard identity.
- Server-side RBAC enforces `viewer`, `operator`, and `admin` capabilities.
- The service-role key is server-only and must never use the `NEXT_PUBLIC_` prefix.
- Wazuh ingestion requires a bearer credential of at least 32 characters. Missing credentials stop service startup and missing/invalid request credentials return `401`.
- Dashboard SIEM sending requires `SIEM_WAZUH_TOKEN` and HTTPS, except for loopback development tests.

## Sensitive Output Policy

The platform redacts passwords, secrets, private keys, service-role keys, authorization headers, cookie headers, session IDs, bearer tokens, JWTs, share-token query parameters, signed URL parameters, and common API-key query parameters from runner logs, outbox payloads, textual report responses, textual evidence-bundle responses, SIEM exports, SIEM diagnostics, and historical log API responses.

Generated binary evidence may contain product state that cannot be safely transformed without invalidating evidence. Trace/video artifacts retain the existing `sensitive` classification and are not exposed through the compatibility file route. Access to evidence remains authenticated, private, and auditable. Operators must not capture credentials in screenshots or attachments.

## Evidence Path Policy

Evidence requests are resolved from artifact metadata only. The serving layer applies lexical traversal checks and then canonical `realpath` checks to the repository root, allowlisted report root, bundle root, and requested target. Symlinks cannot escape an allowlisted root. Arbitrary client paths and directory listings are not supported.

## Wazuh Ingestion

The ingestion service binds to `127.0.0.1`, receives TLS-terminated traffic through Nginx, validates a bearer credential with timing-safe comparison, enforces a one-megabyte body limit, validates the SIEM schema, rejects credential material, and writes one JSON event per line. Nginx must forward `Authorization` explicitly. Store the credential in `/etc/inssa-ingestion.env` with owner `root:root` and mode `0600`.

## Dependency Policy

Production dependencies are lockfile-pinned and must pass `npm audit --omit=dev --audit-level=high`. The dashboard pins Next.js `15.5.22`, React/React DOM `19.2.5`, and PostCSS `8.5.23`. npm overrides keep nested PostCSS on `8.5.23` and Sharp on `0.35.0`. Do not use `npm audit fix --force`; review and validate every framework upgrade.

## Verification

```bash
node --test services/inssa-ingestion/server.test.js scripts/siem/security-hardening.test.js
npm --prefix dashboard run test:execution-foundation
npm --prefix dashboard run build
npm --prefix dashboard audit
npm audit
git status --short
```

Release also requires the secret scan and deployment checks in [Platform Release Guide](./platform-release-guide.md).
