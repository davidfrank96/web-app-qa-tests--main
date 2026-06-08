# INSSA Risk Matrix

| Risk | Category | Severity | Status | Evidence | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Tokenless `/capsule/<id>` exposes exact revealed capsule content. | Access Control | High | Confirmed | `security-campaigns/verification/latest-security-verification.json`, `security-campaigns/access-control.json` | Confirm product policy. If unintended, require token or authorization for capsule content. |
| Revealed capsules are share-link accessible but not generally discoverable in authenticated home/search/profile surfaces. | Discovery / Visibility | Medium | Confirmed behavior, policy unclear | `lifecycle-campaigns/20ed1890ed7c-f658c3a631-campaign-text.json`, `reports/lifecycle/latest-lifecycle-summary.html` | Product should define indexing semantics; engineering should fix indexing only if broad discovery is intended. |
| Cross-user contact delivery exposes exact capsule only through targeted secondary Messages. | Access Control | Informational | Verified expected behavior | `security-campaigns/cross-user/latest-cross-user-verification.json` | Keep as regression coverage; expand to media/video once policy and cleanup are ready. |
| Reveal-later content hidden before scheduled timestamp. | Reveal-Later | Informational | Verified pre-reveal | `security-campaigns/reveal-later/latest-reveal-later-security.json`, `reports/security/reveal-later-access-control.html` | Run after-reveal follow-up after `2026-06-06T12:07:44.975Z`. |
| Reveal-later after-reveal behavior not yet validated for latest scheduled artifact. | Reveal-Later | Medium | Pending | `lifecycle-artifacts/b952b1d4fe53-c271b67d56-reveal-later.json` | Schedule and run follow-up probe after reveal time. |
| Security headers incomplete on staging. | Authentication / Security Misconfiguration | Medium | Confirmed | `security-campaigns/security-headers.json` | Add CSP, Referrer-Policy, Permissions-Policy, X-Frame-Options/frame-ancestors, and X-Content-Type-Options where appropriate. |
| Sensitive-looking local storage entry requires review. | Authentication / Storage | Low | Needs engineering review | `security-campaigns/security-headers.json` | Inspect `inssa:pending-shared-capsule-claims:v1` contents and retention policy. |
| Optional media/preview/network failures occur during successful lifecycle runs. | Media / Lifecycle | Low | Confirmed warning | `lifecycle-campaigns/4d084be2edcd-0193d65b64-campaign-media.json`, `lifecycle-campaigns/25d81e2e79eb-b29df91b6b-campaign-video.json` | Keep warning classification; review if user-visible media preview instability is reported. |
| Live capsule cleanup remains manual. | Lifecycle | Medium | Confirmed harness limitation | `lifecycle-artifacts/*.json`, `docs/inssa-live-staging-lifecycle.md` | Add scoped QA cleanup endpoint, admin action, or verified owner UI cleanup before scaling live runs. |
| Generated campaign artifacts can contain sensitive staging evidence if tracked. | Lifecycle / Security Operations | Medium | Mitigated in working tree, history review needed | `docs/release-gate-gitignore-audit.md` | Keep artifacts ignored; ensure branch history does not publish tokenized filenames/artifacts. |
| Tokenized public share retrieval works for live text/media/video capsules. | Visibility | Informational | Confirmed | `lifecycle-campaigns/*campaign-*.json`, `reports/lifecycle/latest-lifecycle-summary.html` | Keep as lifecycle regression coverage. |
| SIEM export is metadata-only and excludes screenshots/videos/traces. | Security Operations | Informational | Implemented | `reports/siem/latest-siem-export.json` | Use for dashboarding and alert triage; keep raw artifacts local or controlled. |

## Severity Definitions

| Severity | Meaning |
| --- | --- |
| Critical | Confirmed unauthorized access or sensitive data exposure with clear exploit-class impact. |
| High | Confirmed access-control exposure or privacy-sensitive behavior needing product/security decision. |
| Medium | Confirmed gap, incomplete validation, or operational risk requiring engineering follow-up. |
| Low | Non-blocking technical or operational issue with limited immediate risk. |
| Informational | Expected or validated behavior worth preserving as regression coverage. |

## Current Top Priorities

1. Resolve product/security intent for tokenless capsule-by-ID access.
2. Complete after-reveal validation for latest reveal-later artifact.
3. Decide owner/discovery indexing expectations for live capsules.
4. Provide a safe cleanup path for QA-created live staging data.
5. Harden staging security headers.

