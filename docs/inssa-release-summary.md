# INSSA QA Infrastructure Release Summary

## Executive Summary

This release packages the INSSA Playwright QA harness for controlled staging lifecycle, security, reporting, SIEM, cross-user, and reveal-later validation. The repo remains a black-box QA harness against `https://staging.inssa.us`; it does not contain INSSA application source code.

The infrastructure is push-ready with warnings. Safe non-mutating INSSA coverage is green, live mutation paths remain explicitly gated, production is hard-blocked for live lifecycle work, campaign evidence is persisted outside transient Playwright output, and engineering/security handoff documents are in place.

Primary warnings are product/security findings, not harness blockers: tokenless capsule-by-ID access for revealed capsules, public media accessibility cases, manual cleanup requirements, and pending after-reveal validation for the latest reveal-later artifact.

## Major Deliverables

| Area | Deliverable |
| --- | --- |
| Safe INSSA coverage | Non-mutating compose, USA location matrix, and media capability checks. |
| Draft mutation coverage | Opt-in draft write/cleanup through QA-tagged data and Buried drafts cleanup. |
| Live lifecycle coverage | Text, media, video, reveal-later, contact-share, public-share, and discovery campaign support. |
| Artifact persistence | Persistent lifecycle artifacts in `lifecycle-artifacts/` and campaign summaries in `lifecycle-campaigns/` and `security-campaigns/`. |
| Campaign orchestration | Focused lifecycle, security, cross-user, reveal-later, and verification runners. |
| Reporting | Human-readable security/lifecycle reports and latest summary reports. |
| SIEM | Metadata-only SIEM export under `reports/siem/latest-siem-export.json`. |
| Engineering handoff | Engineering review, security findings, risk matrix, product behavior audit, and release-gate gitignore audit docs. |

## Lifecycle Campaigns

Lifecycle campaigns create one controlled staging capsule, persist cleanup evidence, and pass the resulting artifact into downstream discovery/public-share validation.

Validated lifecycle areas:

- Text live capsule lifecycle.
- Media live capsule lifecycle.
- Video live capsule lifecycle using a static video fixture instead of runtime FFmpeg generation.
- Contact-share delivery state machine.
- Public share retrieval.
- Authenticated direct retrieval and discovery diagnostics.
- Reveal-later creation and scheduling metadata capture.

Known lifecycle classification:

- Tokenized public-share retrieval works for revealed capsules.
- Authenticated broad surfaces generally do not index live capsules unless delivered through contact-share.
- Media/video lifecycle can succeed with warning-only optional network failures when retrieval is proven.
- Live capsule cleanup remains manual through the development team.

## Security Campaigns

The OWASP-aligned security campaign covers black-box staging checks only. It does not perform brute force, denial-of-service, destructive exploitation, production testing, or backend/database access.

Coverage includes:

- A01 Broken Access Control: tokenized, tokenless, authenticated, logged-out, cross-user, and reveal-later access behavior.
- A02 Cryptographic Failures: HTTPS, HSTS, cookie/security storage observations, token exposure, and local/session storage review.
- A03 Injection: safe payload handling through gated input probes.
- A04 Insecure Design: lifecycle visibility, reveal-now/reveal-later semantics, token behavior, and indexing behavior.
- A05 Security Misconfiguration: security headers and verbose client-visible error checks.
- A06 Vulnerable and Outdated Components: visible component/bundle fingerprinting only.
- A07 Identification and Authentication Failures: session persistence, logout, redirects, and route guarding.
- A08 Software and Data Integrity Failures: third-party resources and script policy observations.
- A09 Logging and Monitoring Failures: user-visible lifecycle traceability and campaign evidence.
- A10 SSRF: identification of URL/media import entry points only; no internal probing.

Latest security campaign result:

- Status: `passed-with-findings`.
- Latest report: `reports/security/latest-security-summary.html`.
- Latest campaign artifact: `security-campaigns/20ed1890ed7c-5fd91d5835-security.json`.

## Security Verification

The verification campaign consumes known lifecycle artifacts and confirms whether previously detected findings still reproduce.

Latest verification result:

| Area | Result |
| --- | --- |
| Source artifacts | 30 |
| Usable artifacts | 15 |
| Tokenless capsules | 14 `public-by-id`, 1 inaccessible |
| Media access | 2 `media-publicly-accessible`, 5 `media-authenticated-only` |
| Reveal-later access | 1 `reveal-protected`, remaining skipped or elapsed/unknown schedule |
| Cross-user visibility aggregate | 14 `unauthorized-visible`, 1 isolated |

Latest output:

- `security-campaigns/verification/latest-security-verification.json`
- `reports/security/security-verification.html`

## Cross-User Validation

Dedicated cross-user validation verifies targeted contact delivery with a primary QA user and a secondary QA user.

Latest result:

| Field | Value |
| --- | --- |
| Classification | `expected-share-access` |
| Route access | `isolated` |
| Surface access | `targeted-contact-surface-visible` |
| Media | `media-not-observed` |
| Risk level | Informational |
| Subject | `QA_LIVE_CAPSULE_0d877454785d-c98ca92b0e_20260605T114055Z` |

Confirmed behavior:

- Secondary QA user receives the capsule through Messages after explicit contact selection.
- Feed, search, profile/history, connections, and drafts/messages tab did not expose the exact capsule.
- Text-only artifact had no media URLs to verify.

Latest outputs:

- `security-campaigns/cross-user/latest-cross-user-verification.json`
- `reports/security/cross-user-security.html`

## Reveal-Later Validation

Reveal-later validation now follows the observed staging state machine. Step 1 is timing-first and does not require `Shared capsule`.

Current reveal-later behavior:

1. Compose.
2. Media.
3. Bury.
4. Reveal settings.
5. Select Reveal later.
6. Continue.
7. Contact-share step.
8. Finalization through the current contact-share flow.

Latest reveal-later security result:

| Field | Value |
| --- | --- |
| Classification | `reveal-protected` |
| Token behavior | `isolated` |
| Cross-user visibility | `isolated` |
| Risk | Informational |
| Scheduled reveal | `2026-06-06T12:07:44.975Z` |
| Subject | `QA_REVEAL_LATER_CAPSULE_b952b1d4fe53-c271b67d56_20260605T120726Z` |

Pre-reveal access was protected across tokenized, tokenless, authenticated direct, primary surfaces, and secondary surfaces. After-reveal validation remains pending until the scheduled reveal time.

Latest outputs:

- `security-campaigns/reveal-later/latest-reveal-later-security.json`
- `reports/security/reveal-later-access-control.html`

## Reporting

Reporting outputs are generated in ignored local artifact directories:

| Report Type | Location |
| --- | --- |
| Playwright report | `playwright-report/` |
| Lifecycle reports | `reports/lifecycle/` |
| Security reports | `reports/security/` |
| SIEM export | `reports/siem/` |

Latest key reports:

- `reports/lifecycle/latest-lifecycle-summary.html`
- `reports/security/latest-security-summary.html`
- `reports/security/security-verification.html`
- `reports/security/cross-user-security.html`
- `reports/security/reveal-later-access-control.html`
- `reports/siem/latest-siem-export.json`

## SIEM Integration

SIEM integration exports metadata-only campaign events. Screenshots, videos, traces, and raw browser evidence are not uploaded.

Supported event types:

- `release_gate`
- `lifecycle_campaign`
- `security_campaign`
- `discovery_campaign`
- `cleanup_audit`

Latest SIEM export:

| Field | Value |
| --- | --- |
| Output | `reports/siem/latest-siem-export.json` |
| Event count | 46 |
| Metadata only | true |
| Media policy | screenshots/videos/traces excluded |

Export command:

```bash
npm run siem:export
```

## Known Findings

| Finding | Severity | Status |
| --- | --- | --- |
| Tokenless `/capsule/<id>` exposes exact revealed capsule content for many artifacts. | High | Confirmed |
| Uploaded media has public accessibility cases. | High | Confirmed |
| Revealed capsules are share-link accessible but generally not indexed in authenticated home/search/profile surfaces. | Medium | Confirmed behavior, policy unclear |
| Security headers are incomplete on staging. | Medium | Confirmed |
| Live capsule cleanup remains manual. | Medium | Confirmed harness/product limitation |
| Reveal-later pre-reveal protection worked for the latest scheduled artifact. | Informational | Confirmed |
| Cross-user contact delivery works through targeted Messages. | Informational | Confirmed |

Detailed findings:

- `docs/inssa-security-findings.md`
- `docs/inssa-risk-matrix.md`
- `docs/inssa-engineering-review.md`

## Known Risks

- Production must remain blocked for live lifecycle and security mutation tests.
- Live staging campaigns create QA data and require manual development-team cleanup.
- Generated artifacts may contain staging evidence and must stay ignored.
- Tokenless capsule access and media accessibility require product/security policy decisions before being downgraded.
- Reveal-later after-reveal behavior remains pending for the latest future-scheduled artifact.
- Broad authenticated indexing semantics remain unclear by product design.

## Cleanup Targets

Known cleanup targets from latest validation:

| Campaign | Subject | Cleanup |
| --- | --- | --- |
| Cross-user contact-share | `QA_LIVE_CAPSULE_0d877454785d-c98ca92b0e_20260605T114055Z` | Development team should delete from staging after verification. |
| Reveal-later | `QA_REVEAL_LATER_CAPSULE_b952b1d4fe53-c271b67d56_20260605T120726Z` | Development team should delete from staging after verification and after any after-reveal follow-up. |

Additional historical QA live artifacts exist under ignored `lifecycle-artifacts/` and should be reviewed by the development team for staging cleanup.

## Release Verdict

Verdict: PASS WITH WARNINGS.

Push recommendation: proceed with the PR after confirming the intended tracked files are staged and generated artifacts remain ignored.

Release evidence:

- Safe INSSA suite passed: `npm run test:inssa:safe` returned `10 passed`.
- Security campaign passed with findings.
- Security verification passed with confirmed findings.
- Cross-user latest output exists and classifies targeted contact delivery as expected share access.
- Reveal-later latest output exists and classifies pre-reveal access as protected.
- SIEM export succeeds and remains metadata-only.
- Required engineering/security/risk docs exist.

Warnings are intentionally preserved as engineering findings and should not be hidden or downgraded.
