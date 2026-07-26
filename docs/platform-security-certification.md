# Platform Security Certification

## Scope

Release Hardening Sprint C covers Wazuh ingestion authentication, sensitive-output redaction, dependency advisories, evidence path security, repository secrets, and production security documentation. It does not change campaign, runner, worker, scheduler, monitoring, persistence, or dashboard workflow architecture.

## Implemented Controls

- Ingestion refuses startup without a minimum 32-character shared credential.
- Every event POST requires a timing-safe bearer credential check.
- SIEM sender refuses anonymous delivery and non-TLS remote endpoints.
- Sender and receiver reject credential-bearing event metadata.
- Textual logs and evidence responses redact credential formats, including historical local records.
- Evidence file and bundle routes validate canonical repository, allowlist-root, and target paths.
- A symlink-escape regression test proves canonical bypass is blocked.
- Next.js is pinned to `15.5.18`; React/React DOM to `19.2.5`; PostCSS to `8.5.10`; overrides enforce patched nested PostCSS `8.5.10` and Sharp `0.35.0`.

## Audit Findings

- No real environment file, private-key file, service account file, or user credential file is tracked.
- Generated ignored lifecycle/security evidence from earlier runs contains share-link tokens. It remains outside Git; dashboard textual responses now redact it. Controlled-host cleanup and token expiry remain operational responsibilities.
- The tracked release-gate audit contains example secret signatures as documentation, not credential values.

## Validation Record

| Validation | Result |
| --- | --- |
| Root npm audit | PASS, zero vulnerabilities |
| Dashboard npm audit | PASS, zero vulnerabilities |
| Ingestion/SIEM security tests | PASS, 5 of 5 |
| Execution foundation tests | PASS, 15 of 15 |
| Dashboard build | PASS on Next.js 15.5.18 |
| Production runtime probe | PASS; `/login` returned `200`, anonymous `/api/runs` returned `401`, clean shutdown completed |
| Runtime Doctor | PASS |
| Platform healthcheck | PASS WITH WARNINGS; live Wazuh endpoint/UI were unreachable from the validation environment |
| Authentication-monitor discovery | PASS, 3 checks discovered without execution credentials |
| Tracked secret scan | PASS, no credential files tracked |
| Git history secret scan | BLOCKED; historical share tokens found in commit `3506a72a018f` |

## Certification Gate

Code-level security controls pass. Production release remains **BLOCKED** because commit `3506a72a018f` contains unredacted UUID-form share tokens in six historical `lifecycle-investigations/*.json` files. Before release, invalidate or confirm expiry of those product share tokens, rewrite the affected Git history with coordinated repository-owner approval, force-update all remote refs, and have every collaborator re-clone. The Wazuh deployment must also receive a unique `/etc/inssa-ingestion.env` credential and be revalidated after restart. Anonymous compatibility mode does not exist.
