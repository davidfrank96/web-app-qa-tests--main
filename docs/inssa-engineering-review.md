# INSSA Engineering Review

## Executive Summary

The QA harness now supports controlled black-box lifecycle and security validation against INSSA staging at `https://staging.inssa.us`. The harness is explicitly staging-only for live mutation paths, uses opt-in environment flags for live capsule creation, persists lifecycle artifacts outside transient Playwright output, and produces security/lifecycle reports for engineering review.

Validated coverage includes draft write/cleanup, text live capsule lifecycle, media lifecycle, video lifecycle, contact-share delivery, authenticated/public retrieval, tokenized/tokenless route behavior, reveal-later scheduling capture, reveal-later pre-reveal access control, cross-user delivery, OWASP-oriented checks, SIEM metadata export, and reporting.

The highest-priority product finding remains tokenless capsule-by-ID access for revealed live capsules. Multiple successful lifecycle artifacts show exact QA capsule content visible at `/capsule/<id>` without a token. This should be reviewed as a product/security decision. Reveal-later pre-reveal access behaved correctly for the latest scheduled artifact: exact QA content was hidden through tokenized, tokenless, authenticated, primary, and secondary surfaces before reveal time.

## QA Architecture

The repo is a Playwright QA harness, not the INSSA application source. It black-box tests hosted staging over HTTPS.

Core architecture:

| Area | Implementation | Purpose |
| --- | --- | --- |
| Page objects | `pages/inssa/time-capsule.page.ts` | Compose, media, share, reveal settings, contact-share, timestamp evidence helpers. |
| Live lifecycle tests | `tests/inssa/live-capsule-*.spec.ts` | Explicitly gated staging live capsule creation. |
| Campaign runners | `scripts/inssa/run-lifecycle-campaign.js`, `scripts/inssa/run-reveal-later-security-campaign.js`, `scripts/inssa/run-cross-user-campaign.js` | Chain creation, discovery, public share, cross-user, and reveal-later probes. |
| Persistent artifacts | `lifecycle-artifacts/`, `lifecycle-campaigns/`, `security-campaigns/` | Machine-readable evidence and cleanup targets. |
| Reports | `reports/lifecycle/`, `reports/security/`, `reports/siem/` | Human-readable and SIEM-ready summaries. |
| Documentation | `docs/inssa-live-staging-lifecycle.md`, `docs/inssa-security-campaign.md`, `docs/inssa-product-behavior-audit.md` | Operator and engineering handoff guidance. |

Safety controls:

- Live mutation tests require `INSSA_URL=https://staging.inssa.us`.
- Live mutation tests require explicit flags such as `INSSA_ENABLE_LIVE_CAPSULE_TESTS=1` and `INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1`.
- Media, video, reveal-later, and draft mutations are separately gated.
- Campaigns run one lifecycle mutation per campaign and pass artifacts downstream.
- No production live mutation path is allowed.
- Cleanup is manual unless specifically audited as safe.

## Lifecycle Coverage

| Lifecycle | Status | Evidence |
| --- | --- | --- |
| Draft write and cleanup | Validated | `tests/inssa/draft-write-cleanup.spec.ts`, `utils/inssa-cleanup.ts` |
| Text live capsule | Validated with warnings | `lifecycle-campaigns/20ed1890ed7c-f658c3a631-campaign-text.json` |
| Media live capsule | Validated with warnings | `lifecycle-campaigns/4d084be2edcd-0193d65b64-campaign-media.json` |
| Video live capsule | Validated with warnings | `lifecycle-campaigns/25d81e2e79eb-b29df91b6b-campaign-video.json` |
| Contact-share delivery | Validated | `security-campaigns/cross-user/latest-cross-user-verification.json` |
| Reveal-later creation | Validated | `lifecycle-artifacts/b952b1d4fe53-c271b67d56-reveal-later.json` |
| Reveal-later pre-reveal protection | Validated | `security-campaigns/reveal-later/latest-reveal-later-security.json` |
| After-reveal reveal-later access | Pending follow-up | Reveal time for latest artifact is `2026-06-06T12:07:44.975Z`. |

## Security Coverage

| Area | Coverage | Evidence |
| --- | --- | --- |
| Access control | Tokenized, tokenless, authenticated, logged-out, cross-user routes | `security-campaigns/access-control.json`, `security-campaigns/verification/latest-security-verification.json` |
| Authentication | Route guarding and session behavior | `security-campaigns/authentication.json` |
| Security headers | HTTPS, HSTS, CSP, frame, referrer, permissions policy | `security-campaigns/security-headers.json` |
| Misconfiguration | Third-party scripts, visible errors, exposed external resources | `security-campaigns/misconfiguration.json` |
| Cross-user sharing | Primary sends to secondary contact; secondary retrieves via Messages | `security-campaigns/cross-user/latest-cross-user-verification.json` |
| Reveal-later | Pre-reveal tokenized/tokenless/authenticated/cross-user visibility | `security-campaigns/reveal-later/latest-reveal-later-security.json` |
| SIEM export | Metadata-only campaign event export | `reports/siem/latest-siem-export.json` |

## Confirmed Behaviors

- Text, media, and video lifecycle campaigns can create live staging capsules and validate public/share retrieval.
- Authenticated discovery does not generally index created capsules in home feed, search, messages, or profile/history unless a capsule is explicitly delivered to a contact.
- Public share validation succeeds for tokenized share routes for revealed capsules.
- Tokenless `/capsule/<id>` routes expose exact QA content for many revealed capsules.
- Cross-user contact-share flow delivers the exact capsule to the configured secondary QA account through Messages.
- Reveal-later Step 1 is timing-first and does not expose audience selection.
- Reveal-later scheduling is captured from a visible `MM/DD/YYYY hh:mm aa` input and backend Firestore `revealDate.timestampValue`.
- Latest reveal-later pre-reveal probe found exact QA content hidden across direct, tokenized, tokenless, primary, and secondary routes.

## Known Product Behaviors

- Current share workflow is `Compose -> Media -> Share -> Bury -> Reveal settings -> Continue -> Send or save/contact selection -> Bury, send to selected contact, then share more -> success`.
- The old `Skip contacts & share link with others` path is not currently visible in the audited contact-share flow.
- The success surface may show `Share link`, `Home`, and success UI while top-level artifact fields may not always retain `finalShareLink`; network evidence may contain the share URL.
- Optional preview/media, analytics, and retryable transport request failures occur during successful lifecycle runs and should be treated as warnings when retrieval succeeds.
- Cleanup for live capsules remains manual through the development team.

## Recommendations

1. Confirm intended policy for tokenless `/capsule/<id>` access. If tokens are intended to gate share access, this is the top access-control issue to fix.
2. Confirm whether revealed capsules should be discoverable in authenticated home/search/profile surfaces or remain share-link/contact-delivery only.
3. Keep reveal-later follow-up scheduled after `2026-06-06T12:07:44.975Z` to complete after-reveal validation for artifact `b952b1d4fe53-c271b67d56`.
4. Add backend cleanup support or a scoped owner UI cleanup flow before expanding high-volume lifecycle campaigns.
5. Add security headers currently absent on staging: CSP, Referrer-Policy, Permissions-Policy, X-Frame-Options, and X-Content-Type-Options where appropriate.
6. Keep campaign artifacts out of source control; use report summaries and SIEM metadata for durable sharing.

