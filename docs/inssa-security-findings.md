# INSSA Security Findings

## Finding INSSA-SEC-001: Tokenless Capsule-by-ID Access Exposes Revealed Capsule Content

Severity: High

Category: Access Control

Evidence:

- `security-campaigns/verification/latest-security-verification.json`
- `security-campaigns/access-control.json`
- `lifecycle-campaigns/20ed1890ed7c-f658c3a631-campaign-text.json`
- `lifecycle-campaigns/4d084be2edcd-0193d65b64-campaign-media.json`
- `lifecycle-campaigns/25d81e2e79eb-b29df91b6b-campaign-video.json`

Reproduction:

1. Create or use a revealed QA live capsule artifact with a tokenized share URL.
2. Open the tokenized URL in a clean browser context.
3. Remove the `token` query parameter and open `/capsule/<id>`.
4. Observe exact QA subject and message are visible on tokenless route for multiple artifacts.

Observed Behavior:

`security-campaigns/verification/latest-security-verification.json` classified 13 tokenless capsule probes as `public-by-id`. Both tokenized and tokenless routes exposed exact QA content.

Expected Behavior:

If share tokens are intended as access-control material, `/capsule/<id>` without token should block or show only non-sensitive metadata. If public-by-ID is intended, product should explicitly document this sharing model.

Recommendation:

Confirm intended product policy. If tokenless access is unintended, enforce token or authorization checks before returning capsule content. Add regression coverage for token-required behavior.

## Finding INSSA-SEC-002: Revealed Capsules Are Share-Link Accessible but Authenticated Surfaces Are Generally Undiscoverable

Severity: Medium

Category: Discovery / Visibility

Evidence:

- `lifecycle-campaigns/20ed1890ed7c-f658c3a631-campaign-text.json`
- `lifecycle-campaigns/4d084be2edcd-0193d65b64-campaign-media.json`
- `lifecycle-campaigns/25d81e2e79eb-b29df91b6b-campaign-video.json`
- `reports/lifecycle/latest-lifecycle-summary.html`

Reproduction:

1. Run a lifecycle campaign for text, media, or video.
2. Use the generated artifact for authenticated discovery.
3. Probe home feed, search, messages, and profile/history.
4. Compare those surfaces with direct share route retrieval.

Observed Behavior:

Lifecycle campaigns passed creation and public share retrieval but reported authenticated discovery warning `share-link-only-visibility`. Created capsules were retrievable by share routes but were not broadly indexed in authenticated surfaces.

Expected Behavior:

Product should define whether created live capsules are intended to be discoverable in owner feed/search/profile/history or only through direct share/contact delivery.

Recommendation:

Product and engineering should confirm discovery semantics. If indexing is required, investigate feed/search/profile indexing. If share-link-only visibility is intended, document it and keep QA classification as warning, not hard failure.

## Finding INSSA-SEC-003: Cross-User Contact Delivery Works as Targeted Messages Access

Severity: Informational

Category: Access Control / Cross-User

Evidence:

- `security-campaigns/cross-user/latest-cross-user-verification.json`
- `reports/security/cross-user-security.html`
- `lifecycle-artifacts/0d877454785d-c98ca92b0e-contact-share-state-machine.json`

Reproduction:

1. Primary QA user creates a text capsule.
2. Primary selects exactly the secondary QA contact.
3. Primary clicks `Bury, send to 1 contact, then share more`.
4. Secondary logs in and opens Messages, feed, search, profile/history.

Observed Behavior:

Secondary user saw the exact QA subject and message in Messages. Feed, search, profile/history, profile connections, and drafts/messages tab did not expose the capsule. Classification: `expected-share-access`, `targeted-contact-surface-visible`, `routeAccess=isolated`.

Expected Behavior:

If contact delivery is intended, secondary Messages visibility is expected and non-targeted surfaces should remain limited.

Recommendation:

Keep this as regression coverage. Extend with media/video cross-user verification once cleanup and policy are confirmed.

## Finding INSSA-SEC-004: Reveal-Later Pre-Reveal Access Is Protected for Latest Scheduled Artifact

Severity: Informational

Category: Reveal-Later / Access Control

Evidence:

- `security-campaigns/reveal-later/latest-reveal-later-security.json`
- `reports/security/reveal-later-access-control.html`
- `lifecycle-artifacts/b952b1d4fe53-c271b67d56-reveal-later.json`

Reproduction:

1. Use reveal-later artifact `b952b1d4fe53-c271b67d56`.
2. Confirm scheduled reveal timestamp `2026-06-06T12:07:44.975Z`.
3. Before reveal time, probe tokenized, tokenless, authenticated direct, primary surfaces, and secondary surfaces.

Observed Behavior:

Before reveal, exact QA content was hidden through direct capsule route, tokenized route, tokenless route, primary authenticated route, secondary authenticated route, primary messages/feed/search/profile, and secondary messages/feed/search/profile. Classification: `reveal-protected`, `tokenBehavior=isolated`, `crossUserVisibility=isolated`.

Expected Behavior:

Reveal-later content should remain inaccessible until its scheduled timestamp.

Recommendation:

Run a follow-up after `2026-06-06T12:07:44.975Z` to verify after-reveal behavior and update classification.

## Finding INSSA-SEC-005: Security Header Coverage Is Incomplete on Staging

Severity: Medium

Category: Security Misconfiguration

Evidence:

- `security-campaigns/security-headers.json`

Reproduction:

1. Run the OWASP security campaign against staging.
2. Inspect `security-campaigns/security-headers.json`.

Observed Behavior:

HTTPS redirects to HTTPS and HSTS is present. CSP, Permissions-Policy, Referrer-Policy, X-Frame-Options, and X-Content-Type-Options were not observed in the captured headers.

Expected Behavior:

Staging should mirror production-grade baseline headers where feasible, especially for browser-facing app routes.

Recommendation:

Add or confirm policy for CSP, Referrer-Policy, Permissions-Policy, X-Frame-Options/frame-ancestors, and X-Content-Type-Options. Re-run header checks after deployment.

## Finding INSSA-SEC-006: Sensitive-Looking Local Storage Entry Requires Review

Severity: Low

Category: Cryptographic Failures / Storage

Evidence:

- `security-campaigns/security-headers.json`

Reproduction:

1. Run the OWASP security campaign with an authenticated QA account.
2. Inspect `storageSummary.localStorage`.

Observed Behavior:

The campaign observed `inssa:pending-shared-capsule-claims:v1` with a sensitive value pattern flag. It also observed `postAuthRedirectTo` with a sensitive-name flag. No concrete secret is printed in the report.

Expected Behavior:

Local storage should not retain bearer tokens, one-time tokens, credentials, or sensitive share secrets beyond intended UX needs.

Recommendation:

Engineering should inspect the storage schema and confirm whether pending shared capsule claim data is safe to store client-side. If tokens are present, consider shortening retention or moving sensitive material to server/session-backed storage.

## Finding INSSA-SEC-007: Lifecycle Network Warnings Occur During Successful Media/Video Runs

Severity: Low

Category: Media / Lifecycle

Evidence:

- `lifecycle-campaigns/4d084be2edcd-0193d65b64-campaign-media.json`
- `lifecycle-campaigns/25d81e2e79eb-b29df91b6b-campaign-video.json`
- `reports/siem/latest-siem-export.json`

Reproduction:

1. Run media or video lifecycle campaigns.
2. Inspect campaign warnings and SIEM event metadata.

Observed Behavior:

Successful media/video lifecycle campaigns recorded optional preview/media, analytics telemetry, and retryable transport request failures. Retrieval still succeeded and campaigns completed with warnings.

Expected Behavior:

Optional preview and telemetry failures should not block lifecycle success, but recurring transport failures should be observable and classified.

Recommendation:

Keep warning classification. Engineering should review noisy request classes if they correlate with user-visible latency or failed media previews.

## Finding INSSA-SEC-008: Manual Cleanup Remains Required for Live Capsule QA Data

Severity: Medium

Category: Lifecycle / Cleanup

Evidence:

- `docs/inssa-live-staging-lifecycle.md`
- `lifecycle-artifacts/*.json`
- `security-campaigns/cross-user/latest-cross-user-verification.json`
- `security-campaigns/reveal-later/latest-reveal-later-security.json`

Reproduction:

1. Run any live lifecycle campaign.
2. Inspect generated artifact cleanup instructions.

Observed Behavior:

Artifacts contain manual cleanup instructions. No verified safe automated cleanup path exists for created/published live capsules.

Expected Behavior:

Long-running staging QA should have a scoped cleanup mechanism for QA-tagged artifacts.

Recommendation:

Provide either a backend cleanup endpoint scoped to QA-tagged data, an admin cleanup workflow, or a verified owner UI cleanup path before scaling live lifecycle campaign volume.

