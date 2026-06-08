# INSSA QA Harness Current State

Last updated: 2026-06-05

This is a historical current-state summary. The authoritative entry point is now [INSSA QA Operations Guide](inssa-qa-operations-guide.md).

This repository is the Playwright QA harness for INSSA staging. It is not the INSSA app source repository. All INSSA tests exercise the hosted staging app over HTTPS at `https://staging.inssa.us`.

Production `https://inssa.us` must not be used for live mutation or lifecycle campaigns.

## Baseline

Authentication is treated as the current working baseline. Auth helper implementation was not refactored during the capsule lifecycle work.

The safe INSSA baseline is:

```bash
npm run test:inssa:safe
```

This covers:

- Direct authenticated compose route rendering.
- USA compose location matrix rendering.
- Media-step capability inspection without upload or publish.

## Draft-Only Phase

Implemented and validated:

- Direct authenticated `/timecapsule?...` compose route coverage.
- Non-destructive compose render coverage.
- Mutation gate for risky generic INSSA create path in `tests/inssa/interactions.spec.ts`.
- Draft-only QA-tagged write/cleanup test in `tests/inssa/draft-write-cleanup.spec.ts`.
- Buried drafts cleanup scoped by exact draft ID first and exact QA subject fallback.

Known blocker:

- Draft restore fidelity remains product-side broken. Saved QA-authored subject/body are persisted and cleanup works, but reopen/restore can show template/location defaults instead of authored content.

Do not make draft restore tests green by weakening assertions. The app behavior must be fixed first.

## Live Lifecycle Phase

Implemented live lifecycle create specs:

- `tests/inssa/live-capsule-create.spec.ts`
- `tests/inssa/live-capsule-media-create.spec.ts`
- `tests/inssa/live-capsule-video-create.spec.ts`
- `tests/inssa/live-capsule-reveal-later-create.spec.ts`

All live create specs are staging-only and explicitly gated. They create one QA-tagged staging capsule per run and write persistent lifecycle artifacts.

Required live gates:

```text
INSSA_URL=https://staging.inssa.us
INSSA_ENABLE_LIVE_CAPSULE_TESTS=1
INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1
```

Additional media/video/reveal-later gates:

```text
INSSA_ENABLE_MEDIA_CAPSULE_TESTS=1
INSSA_ENABLE_VIDEO_CAPSULE_TESTS=1
INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS=1
INSSA_US_MARKET_LOCATION=nyc
```

The current INSSA lifecycle flow modeled by the harness is:

```text
Compose
-> Media
-> Add media & bury / Share
-> Bury
-> Reveal settings
-> Reveal now or Reveal later
-> Continue
-> Send or save contact step
-> optional contact selection
-> Bury, then choose who to share with
-> success/share surface
```

The old `Skip contacts & share link with others` path is not currently visible in the latest audited contact-share flow. Cross-user validation now uses targeted contact delivery to the configured secondary QA account.

## Lifecycle Campaigns

Focused lifecycle campaigns are implemented in:

```text
scripts/inssa/run-lifecycle-campaign.js
```

Campaign commands:

```bash
npm run test:inssa:campaign:text
npm run test:inssa:campaign:media
npm run test:inssa:campaign:video
npm run test:inssa:campaign:reveal-later
```

Each campaign runs:

```text
CREATE -> AUTHENTICATED DISCOVERY -> PUBLIC SHARE VALIDATION
```

Campaigns stop on true lifecycle failures and continue through non-fatal visibility warnings.

Latest validated campaign behavior:

- Text lifecycle: passed with warnings.
- Media lifecycle: passed with warnings.
- Video lifecycle: passed with warnings.
- Public-share retrieval: passed for tokenized clean, logged-out, and authenticated contexts.
- Authenticated direct retrieval: passed.
- Feed/search/messages/profile visibility: classified as share-link-only visibility, not a hard lifecycle failure.

Video lifecycle notes:

- Runtime FFmpeg video generation was removed from the harness.
- Video create coverage uses the static fixture at `tests/fixtures/media/sample-video.mp4` unless `INSSA_TEST_VIDEO_FIXTURE_PATH` is explicitly set.
- Do not reintroduce per-run FFmpeg synthesis into lifecycle tests.

## Network Failure Classification

Lifecycle request-failure handling now distinguishes fatal failures from warning-only noise.

Fatal examples:

- Auth/session failures that block lifecycle.
- Create/finalize failures.
- Firestore write failures before lifecycle retrieval is proven.
- Upload failures before upload evidence.
- Share-link/retrieval failures before retrieval evidence.

Warning examples after lifecycle and retrieval are proven:

- Firestore Listen/Write channel aborts.
- Background token refresh aborts.
- Sentry/Firebase telemetry failures.
- Optional media/preview/asset failures.

Lifecycle artifacts include:

- `fatalNetworkIssues`
- `warningNetworkIssues`
- `requestFailureSummary`
- `lifecycleSucceededDespiteWarnings`

## Artifact Storage

Persistent lifecycle artifacts are written to:

```text
lifecycle-artifacts/
```

Campaign summaries are written to:

```text
lifecycle-campaigns/
```

Security campaign summaries are written to:

```text
security-campaigns/
```

All three directories are gitignored. Preserve them for handoff; do not rely on Playwright's transient `test-results/` as the source of truth.

## Security Campaign

Implemented in:

```text
scripts/inssa/run-security-campaign.js
```

Command:

```bash
npm run test:inssa:campaign:security
```

The security campaign is read-only. It consumes existing lifecycle artifacts and does not create capsules.

Latest validated security findings:

- Tokenized share retrieval works.
- Tokenless `/capsule/<id>` exposes exact QA content for text, media, and video staging capsules.
- Authenticated direct retrieval works.
- Feed/search/messages/profile do not expose the capsule, producing share-link-only visibility classifications.
- Media and video Firebase Storage media bytes were accessible without token from captured artifact URLs.
- Reveal-later pre-reveal access was protected for the latest future-scheduled artifact. After-reveal validation remains pending until the scheduled reveal time.

Latest security summary classification:

```text
status: passed-with-findings
token-optional=3
public-by-id=3
share-link-only=3
delayed-indexing=3
media-publicly-accessible=2
critical=0
high-risk=3
warning=1
```

## Cleanup State

Live create tests do not auto-delete, archive, hide, or unpublish capsules.

Manual cleanup by the development team is required for QA-tagged live staging capsules.

Cleanup audit remains read-only:

```bash
npm run test:inssa:cleanup-audit
```

The cleanup audit detects available controls but does not click destructive actions.

## Known Blockers

- Product-side draft restore fidelity remains broken.
- No verified safe automated cleanup path exists for live/published capsules.
- Cleanup permission scoping to the QA account is not proven.
- Reveal-later protection needs a fresh pending reveal-later artifact before premature-access can be classified.
- Tokenless capsule access and tokenless media access are high-risk staging findings that need product/security review.
- Browser execution in the local sandbox can fail with Chromium MachPort errors; rerun Playwright commands outside the sandbox when that happens.
- Global `npx tsc --noEmit` currently fails on unrelated Localman type errors; targeted INSSA checks have been used for INSSA work.

## Recommended Next Work

1. Hand off the draft restore fidelity bug to app engineering and rerun `tests/inssa/draft-restore-hydration.spec.ts` only after a product fix.
2. Review tokenless `/capsule/<id>` access semantics with product/security leadership.
3. Review Firebase Storage media URL access semantics for media/video capsules.
4. Create a fresh reveal-later artifact with a longer future reveal window, then rerun `npm run test:inssa:campaign:security`.
5. Run cleanup capability audit and define a safe, scoped cleanup strategy before adding automated destructive cleanup.
6. Keep lifecycle campaigns focused; do not replace them with a broad uncontrolled mega-suite.
