# INSSA Security Campaign

This campaign is black-box QA against `https://staging.inssa.us`. It has no source, backend, database, or cloud access. It is validation and detection only.

For the authoritative operations entry point, see [INSSA QA Operations Guide](inssa-qa-operations-guide.md).

## Command

```bash
npm run test:inssa:campaign:security
```

The runner loads `.env.inssa.live-staging` when present and hard-blocks any `INSSA_URL` host other than `staging.inssa.us`.

## Architecture

The campaign has two layers:

- OWASP Top 10 baseline spec: `tests/inssa/security/owasp-top10.spec.ts`
- Lifecycle artifact security runner: `scripts/inssa/run-security-campaign.js`

The baseline spec writes fixed phase artifacts:

```text
security-campaigns/access-control.json
security-campaigns/injection.json
security-campaigns/authentication.json
security-campaigns/security-headers.json
security-campaigns/misconfiguration.json
```

The lifecycle runner consumes existing finalized artifacts from:

```text
lifecycle-artifacts/
```

and writes:

```text
security-campaigns/lifecycle-security.json
security-campaigns/<runId>-security.json
```

`security-campaigns/` is ignored by git and should be preserved during evidence handoff.

Human-readable reports are written to:

```text
reports/security/security-campaign-<runId>.html
reports/security/latest-security-summary.html
```

The HTML report includes executive summary, risk grouping, findings, evidence links, embedded screenshots when available, reproduction steps, and recommendations. It also links the Playwright HTML report at `playwright-report/index.html`.

## Safety Rules

- Staging only: `INSSA_URL` must resolve to `staging.inssa.us`.
- No production access.
- No denial-of-service activity.
- No credential brute force.
- No destructive exploitation.
- No capsule creation by the security campaign.
- No delete/archive/unpublish actions.
- No database, backend, or cloud access.
- Media/video ACL probes use only URLs already captured in lifecycle artifacts.
- Injection probes are safe input/reflection checks only.
- Subject/message injection probes are gated behind `INSSA_ENABLE_SECURITY_INPUT_PROBES=1` because compose fields may autosave a draft.

## OWASP Coverage Matrix

| OWASP category | Campaign coverage | Output |
| --- | --- | --- |
| A01 Broken Access Control | Tokenized/tokenless capsule routes, authenticated/logged-out route access, protected profile/settings/points/connections/messages routes, reveal-later artifact state. | `access-control.json`, `lifecycle-security.json` |
| A02 Cryptographic Failures | HTTPS behavior, HTTP-to-HTTPS redirect signal, HSTS, secure cookies, SameSite, local/session storage sensitive indicators, token-in-URL observation. | `security-headers.json` |
| A03 Injection | Safe SQLi/XSS/template-string payloads in visible text/search inputs. Compose subject/message probes are optional and gated. | `injection.json` |
| A04 Insecure Design | Reveal-now/reveal-later lifecycle semantics, tokenized vs tokenless sharing, share-link-only visibility, indexing behavior. | `lifecycle-security.json`, `misconfiguration.json` |
| A05 Security Misconfiguration | CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, verbose error text. | `security-headers.json`, `misconfiguration.json` |
| A06 Vulnerable and Outdated Components | Visible JS bundles, framework fingerprints, explicit version data only when exposed by public resources. | `misconfiguration.json` |
| A07 Identification and Authentication Failures | Session persistence, protected route behavior in authenticated vs logged-out contexts, direct route guarding. | `authentication.json` |
| A08 Software and Data Integrity Failures | External script/resource inventory, third-party domains, CSP/header context. | `misconfiguration.json` |
| A09 Security Logging and Monitoring Failures | Lifecycle traceability through run IDs, artifacts, cleanup instructions, and campaign summaries. | `lifecycle-security.json`, `misconfiguration.json` |
| A10 SSRF | Visible URL/link/image input inventory only. No internal URLs or metadata endpoints are requested. | `misconfiguration.json` |

## Risk Model

Findings use these risk levels:

- `Informational`: Expected or useful context.
- `Low`: Minor hardening issue or incomplete signal.
- `Medium`: Security control absent or ambiguous behavior needing product confirmation.
- `High`: Evidence-backed exposure risk, such as tokenless content visibility, but product intent is not yet confirmed.
- `Critical`: Confirmed exploit-class behavior, such as confirmed authentication bypass, confirmed reflected/stored XSS, confirmed sensitive data exposure, or confirmed access-control bypass.

The campaign only fails automatically for confirmed critical findings:

- confirmed access-control bypass
- confirmed authentication bypass
- confirmed reflected/stored XSS
- confirmed sensitive data exposure

Everything else is reported and classified.

## Finding Format

Every finding follows this shape:

```text
Finding:
Risk:
Evidence:
Reproduction:
Affected Route:
Classification:
Recommendation:
```

JSON finding fields use camelCase equivalents:

```json
{
  "finding": "Tokenless capsule route exposes exact QA-created content",
  "risk": "High",
  "evidence": {
    "tokenlessExactContent": true
  },
  "reproduction": "Open a known QA-created /capsule/<id> URL without the token in a clean or logged-out browser context.",
  "affectedRoute": "/capsule/<id>",
  "classification": "high-risk",
  "recommendation": "Confirm whether tokenless capsule-by-ID access is intended."
}
```

## Artifact Inputs

Lifecycle checks are read-only. They consume newest finalized artifacts from `lifecycle-artifacts/`.

Expected prior artifacts:

| Lifecycle | Source command |
| --- | --- |
| Text | `npm run test:inssa:campaign:text` |
| Media | `npm run test:inssa:campaign:media` |
| Video | `npm run test:inssa:campaign:video` |
| Reveal later | `npm run test:inssa:campaign:reveal-later` |

Missing artifacts are warnings/skips. The security campaign does not create replacement capsules.

Reveal-later protection can only be classified while the artifact schedule is still pending. If the scheduled reveal time has elapsed, the campaign records that protection check as skipped/warning.

## Current Known Classifications

Prior campaign evidence found:

- Tokenized share retrieval works.
- Tokenless `/capsule/<id>` exposed exact QA content for multiple QA-created artifacts on staging.
- Authenticated direct retrieval worked.
- Feed/search/messages/profile did not expose the exact QA capsule in current runs.
- Media and video Firebase Storage media bytes were accessible without token from captured artifact URLs.
- Reveal-later premature-access protection requires a future-scheduled artifact to classify safely.

These are staging findings until product/engineering confirms intended visibility semantics.

## Optional Input Probes

By default, the injection phase avoids compose subject/message fields because they may autosave a draft.

To explicitly include subject/message draft-side probes:

```bash
INSSA_ENABLE_SECURITY_INPUT_PROBES=1 npm run test:inssa:campaign:security
```

This still does not publish a capsule, upload media, send contacts, or click final live creation actions.

## Example Commands

Run the full security campaign:

```bash
npm run test:inssa:campaign:security
```

Run cross-user access-control verification:

```bash
npm run test:inssa:campaign:cross-user
```

This campaign intentionally creates one QA-tagged staging capsule with the primary QA account, then signs in with the secondary QA account and probes exact known routes/surfaces. It requires:

```text
INSSA_TEST_EMAIL=
INSSA_TEST_PASSWORD=
INSSA_SECONDARY_TEST_EMAIL=
INSSA_SECONDARY_TEST_PASSWORD=
INSSA_ENABLE_LIVE_CAPSULE_TESTS=1
INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1
```

Cross-user outputs:

```text
security-campaigns/cross-user/latest-cross-user-verification.json
security-campaigns/cross-user/<runId>-cross-user-verification.json
reports/security/cross-user-security.html
```

Cross-user classifications:

| Area | Classifications |
| --- | --- |
| Capsule routes | `isolated`, `expected-share-access`, `unauthorized-visible`, `public-by-design`, `token-required`, `token-optional` |
| Media | `media-isolated`, `media-publicly-accessible`, `media-authenticated-only` |

Hard failures:

- `unauthorized-visible`
- `unexpected-authenticated-access`
- `media-publicly-accessible`

Manual cleanup remains required for the capsule created by User A.

List the OWASP baseline spec only:

```bash
npx playwright test tests/inssa/security/owasp-top10.spec.ts --project=inssa-chrome --list
```

Run the OWASP baseline spec only:

```bash
npx playwright test tests/inssa/security/owasp-top10.spec.ts --project=inssa-chrome --workers=1 --retries=0
```

Run lifecycle prerequisites:

```bash
npm run test:inssa:campaign:text
npm run test:inssa:campaign:media
npm run test:inssa:campaign:video
npm run test:inssa:campaign:reveal-later
```

## Example Output

Example campaign summary:

```text
INSSA lifecycle security campaign result:
- status: passed-with-findings
- owasp baseline: passed
- classifications: token-optional=3, public-by-id=3, share-link-only=3
- risks: critical=0, high-risk=3, warning=1, info=0
```

Example finding:

```text
Finding: Tokenless capsule route exposes exact QA-created content
Risk: High
Evidence: tokenless /capsule/<id> rendered exact QA subject/message
Reproduction: Open the known QA-created capsule ID without the token
Affected Route: /capsule/<id>
Classification: high-risk
Recommendation: Confirm intended share semantics; require token or authorization if tokenless access is not intended.
```
