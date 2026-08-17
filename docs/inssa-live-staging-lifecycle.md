# INSSA Live Staging Lifecycle Runner

This QA harness tests the hosted INSSA staging app at `https://staging.inssa.us`.
Live lifecycle tests intentionally create staging data and must never run against production.

For the authoritative operations entry point, start with [INSSA QA Operations Guide](inssa-qa-operations-guide.md).

## Current Validated State

The harness currently supports:

- Safe authenticated compose render coverage.
- Draft-only QA-tagged write and Buried-drafts cleanup coverage.
- Text, media, video, and reveal-later live create specs.
- Reveal settings handling, including the Step 2 contact/share decision.
- Persistent lifecycle artifact storage.
- Focused lifecycle campaigns that chain create, authenticated discovery, and public-share validation.
- Lifecycle request-failure classification into fatal issues vs warning-only network noise.
- Read-only security/access-control campaign coverage.

Current known product/security findings:

- Draft restore fidelity is broken product-side; persisted QA-authored draft content can be overwritten by template/location defaults on reopen.
- Tokenized share retrieval works.
- Tokenless `/capsule/<id>` currently exposes exact QA content on staging.
- Media/video Firebase Storage bytes were observed as tokenless-accessible from captured artifact URLs.
- Authenticated direct retrieval works, but feed/search/messages/profile do not expose the exact QA capsule in current runs.
- Automated live capsule cleanup is not verified safe; cleanup remains manual/dev-team owned.

## Setup

1. Copy the template:

```bash
cp .env.inssa.live-staging.example .env.inssa.live-staging
```

2. Fill `INSSA_TEST_EMAIL` and `INSSA_TEST_PASSWORD` in `.env.inssa.live-staging`.

3. Keep `INSSA_URL=https://staging.inssa.us`.

The local `.env.inssa.live-staging` file is ignored by git. Do not commit real credentials.

## Flags

| Env flag | Purpose |
| --- | --- |
| `INSSA_URL` | Must be exactly `https://staging.inssa.us` for live mutation tests. |
| `INSSA_TEST_EMAIL` / `INSSA_TEST_PASSWORD` | Authenticated QA account credentials. |
| `INSSA_ENABLE_LIVE_CAPSULE_TESTS=1` | Enables live capsule creation specs. |
| `INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1` | Acknowledges dev-team manual cleanup responsibility. |
| `INSSA_ENABLE_MEDIA_CAPSULE_TESTS=1` | Enables one-image live media capsule creation. |
| `INSSA_ENABLE_VIDEO_CAPSULE_TESTS=1` | Enables one-video live capsule creation. |
| `INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS=1` | Enables reveal-later live capsule creation. |
| `INSSA_REVEAL_LATER_LIFECYCLE_ARTIFACT_PATH` | Runner-managed approved artifact path for explicit dashboard Resume mode. |
| `INSSA_ENABLE_MUTATION_TESTS=1` | Enables draft-write and draft-restore mutation-gated specs. |
| `INSSA_US_MARKET_LOCATION=nyc` | Selects one live USA market location for media/video tests. |
| `INSSA_LIVE_CAPSULE_ARTIFACT_PATH` | Explicit artifact JSON consumed by read-only lifecycle specs. |
| `INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1` | Helper to select the latest creation artifact and print its path. Keep enabled for the full sequential lifecycle script. |
| `INSSA_DEBUG_LIFECYCLE_NETWORK=1` | Optional live-create diagnostic mode. Captures sanitized post-Bury/post-Continue request and response summaries in lifecycle artifacts. |
| `INSSA_DISCOVERY_DELAY_MS` | Optional authenticated-discovery delay before a second read-only surface probe. Default is no delay. |
| `INSSA_ENABLE_SECURITY_INPUT_PROBES=1` | Optional security input/reflection probes. Keep disabled unless intentionally auditing draft-side input handling. |
| `INSSA_ENABLE_BURY_NAV_AUDIT=1` | Investigation-only Bury navigation audit. Keep disabled unless diagnosing navigation. |

## Skipped-Test Audit

| Test file | Test or area | Why skipped by default | Env needed to run | Mutates staging |
| --- | --- | --- | --- | --- |
| `tests/inssa/live-capsule-create.spec.ts` | Text live capsule create | Live + manual cleanup flags missing | `INSSA_ENABLE_LIVE_CAPSULE_TESTS=1`, `INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1` | Yes |
| `tests/inssa/live-capsule-media-create.spec.ts` | Image media live capsule create | Live, media, cleanup, and location gates missing | Live flags, `INSSA_ENABLE_MEDIA_CAPSULE_TESTS=1`, `INSSA_US_MARKET_LOCATION=nyc` | Yes |
| `tests/inssa/live-capsule-video-create.spec.ts` | Video live capsule create | Live, video, cleanup, and location gates missing | Live flags, `INSSA_ENABLE_VIDEO_CAPSULE_TESTS=1`, `INSSA_US_MARKET_LOCATION=nyc` | Yes |
| `tests/inssa/live-capsule-reveal-later-create.spec.ts` | Reveal-later live capsule create | Live, cleanup, and reveal-later gates missing | Live flags, `INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS=1` | Yes |
| `tests/inssa/live-capsule-discovery.spec.ts` | Public share-link validation | Artifact path missing | `INSSA_LIVE_CAPSULE_ARTIFACT_PATH=<artifact.json>` or `INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1` | No |
| `tests/inssa/live-capsule-authenticated-discovery.spec.ts` | Authenticated capsule discovery | Artifact path missing | Artifact path or latest-artifact opt-in | No |
| `tests/inssa/live-capsule-public-share-lifecycle.spec.ts` | Clean/logged-out/authenticated public share lifecycle | Artifact path missing | Artifact path or latest-artifact opt-in | No |
| `tests/inssa/live-capsule-cleanup-capability-audit.spec.ts` | Cleanup capability audit | Artifact path missing | Artifact path or latest-artifact opt-in | No |
| `tests/inssa/draft-write-cleanup.spec.ts` | QA-tagged draft write/discard | Mutation flag missing | `INSSA_ENABLE_MUTATION_TESTS=1` | Draft only |
| `tests/inssa/draft-restore-hydration.spec.ts` | Draft restore blocker audit | Mutation flag missing | `INSSA_ENABLE_MUTATION_TESTS=1` | Draft only |
| `tests/inssa/interactions.spec.ts` | Generic create submission branch | Mutation flag missing for INSSA create path | `INSSA_ENABLE_MUTATION_TESTS=1` | Potentially yes |
| `tests/inssa/cleanup-capability-audit.spec.ts` | Legacy draft cleanup audit | Mutation flag missing, then hard `fixme` because superseded | Remains intentionally skipped | No |
| `tests/inssa/bury-navigation-investigation.spec.ts` | Bury transition investigation | Investigation flag missing | `INSSA_ENABLE_BURY_NAV_AUDIT=1` | No intended mutation |
| `tests/inssa/interactions.spec.ts` | Edit/loading optional branches | UI surface not exposed in current build | No env; conditional on UI availability | No |

## Recommended Order

### A. Safe Baseline

```bash
npx playwright test tests/inssa/inssa-time-capsule-create.spec.ts --project=inssa-chrome
npx playwright test tests/inssa/us-compose-location-matrix.spec.ts --project=inssa-chrome
npx playwright test tests/inssa/media-step-capability.spec.ts --project=inssa-chrome
```

Or:

```bash
npm run test:inssa:safe
```

## Lifecycle Campaigns

Focused lifecycle campaigns are the preferred way to run live staging lifecycle coverage. Each campaign creates exactly one live staging capsule, passes the exact artifact generated by that create phase into read-only authenticated discovery, then passes the same artifact into public-share validation.

Campaign flow:

```text
CREATE -> AUTHENTICATED DISCOVERY -> PUBLIC SHARE VALIDATION
```

Campaign scripts:

```bash
npm run test:inssa:campaign:text
npm run test:inssa:campaign:media
npm run test:inssa:campaign:video
npm run test:inssa:campaign:reveal-later
```

The campaign runner is:

```text
scripts/inssa/run-lifecycle-campaign.js
```

It loads `.env.inssa.live-staging` when present, hard-blocks non-staging hosts, runs one create spec with one worker and zero retries, locates the newly written `lifecycle-artifacts/<runId>*.json` artifact by exact QA subject prefix for that campaign type, then sets `INSSA_LIVE_CAPSULE_ARTIFACT_PATH` for downstream read-only phases. It does not use latest-artifact lookup inside a campaign after creation.

### Dashboard Admin Execution

The dashboard exposes only the four governed campaign wrappers above, never `live-text`, `live-media`, `live-video`, `reveal-later`, or the broad `live-staging` primitive. An authenticated admin must use `Review and Run`, confirm the exact staging target, complete all five acknowledgements, type `RUN STAGING MUTATION`, and pass campaign-specific server preflight. Viewer/operator execution is denied with `403`.

Every mutation job has one attempt so the final Bury/share action is not automatically retried. The worker preserves immutable run evidence and creates `cleanup-manifest.json`. Deferred Cleanup Mode may permit the next live campaign when every unresolved object is identified, attributed to a dedicated QA account, sanitized, safely represented in the durable ledger, within age/count/rate limits, and truthfully marked `deferred` or `cleanup_unavailable`. Unknown or unexpected objects remain blocking.

### Governed Certification Capacity

The unresolved-object threshold remains mandatory and finite. Before a complete governed certification cycle, operators must calculate the projected ledger peak rather than disabling the threshold. The August 2026 staging baseline contains nine unresolved, safely accounted records. One sequential Text, Media, Video, Cross-User, Reveal-Later Lifecycle, and Reveal-Later Security cycle can add at most eight records: one Text capsule, a Media capsule and image, a Video capsule and MP4, one Cross-User capsule, one Reveal-Later capsule, and one additional Reveal-Later Security capsule if create mode is used. The bounded minimum for that certification window is therefore `INSSA_MAX_UNRESOLVED_OBJECTS=17`.

This value is a staging-only operational ceiling, not a new default and not cleanup completion. The default remains `10`. The temporary value must be recorded with the certification run, reviewed after the cycle, and reduced when cleanup capability or ledger disposition permits. Production mutation remains prohibited. Age, daily-rate, QA ownership, identity, sanitization, and deferred-mode gates remain unchanged.

The current Text flow is:

```text
Compose
→ Add media & bury
→ Bury
→ Reveal settings (Step 1 of 2)
→ Shared capsule + Reveal now
→ Continue
→ Send or save (Step 2 of 2)
→ 0 selected
→ select the configured secondary QA contact
→ 1 selected
→ Bury, send to 1 contact, then share more
→ success/share surface
```

The Text harness requires `INSSA_SECONDARY_TEST_EMAIL`, verifies the exact contact identity and `0 → 1` count transition, and invokes the final contact-share action once. A successful persistence response without a captured capsule ID is classified `failed_cleanup_identity`; it requires cleanup investigation and forbids automatic retry.

### Active Cleanup Hold (2026-08-02)

Failed dashboard run `dd7b8a3d-7bcc-4409-8d3c-ef7a99ad70bb` created staging draft `timeCapsules/Zd7QsNEJGbMXOSvAn3qc` before contact finalization. The trace proves a successful Firestore write and no recipients, share token, or media. The one owner UI Delete attempt completed its confirmation, but the dialog explicitly described removing the message for the current user while retaining it for recipients. At `2026-08-02T21:30:08.755Z`, a fresh authenticated direct-route load and exact-document Firestore read/listen traffic still confirmed the active draft. This is tracked as [INSSA-CLEANUP-001](./inssa-text-lifecycle-cleanup-defect.md) with `cleanup_unavailable`, the exact originating run, dedicated QA ownership, sanitized evidence, and a 90-day retention target. It remains unresolved INSSA staging data; the ledger does not claim or perform deletion.

Reveal-Later supports two explicit modes:

- Create: run the normal create phase and record the new run-owned artifact.
- Resume: select a successful staging reveal-later artifact with owner, scheduled timestamp, and lifecycle-state evidence. The server passes the validated path through `INSSA_REVEAL_LATER_LIFECYCLE_ARTIFACT_PATH`.

Campaign artifact matching:

| Campaign | Create spec | Artifact match |
| --- | --- | --- |
| `text` | `tests/inssa/live-capsule-create.spec.ts` | subject starts `QA_LIVE_CAPSULE_` |
| `media` | `tests/inssa/live-capsule-media-create.spec.ts` | subject starts `QA_LIVE_MEDIA_CAPSULE_` |
| `video` | `tests/inssa/live-capsule-video-create.spec.ts` | subject starts `QA_LIVE_VIDEO_CAPSULE_` |
| `reveal-later` | `tests/inssa/live-capsule-reveal-later-create.spec.ts` | subject starts `QA_REVEAL_LATER_CAPSULE_` |

Campaign summaries are written to:

```text
lifecycle-campaigns/<runId>-campaign-<type>.json
```

`lifecycle-campaigns/` is ignored by git and should be preserved with `lifecycle-artifacts/` when handing off campaign evidence.

Human-readable lifecycle reports are written to:

```text
reports/lifecycle/lifecycle-campaign-<runId>.html
reports/lifecycle/latest-lifecycle-summary.html
```

The HTML report includes create, discovery, public share, visibility classification, cleanup requirements, artifact links, Playwright report links, and embedded screenshots when available.

### Campaign Failure Semantics

Hard failures stop the campaign:

- Create phase fails or exits without a new finalized creation artifact.
- Authenticated discovery cannot retrieve exact QA content through direct capsule/share routes.
- Tokenized access is unavailable when the artifact includes tokenized share evidence.
- Public-share validation fails in clean, logged-out, or authenticated contexts.

Warnings do not stop the campaign:

- `share-link-only-visibility`
- `authenticated-surface-undiscoverable`
- `direct-access-without-indexing`
- `tokenized-only-access`
- `delayed-indexing`

These warnings mean direct retrieval works, but feed/search/messages/profile indexing semantics do not expose the capsule. The campaign still proceeds to public-share validation.

Example campaign result:

```text
Lifecycle campaign result:
- campaign: text
- status: passed-with-warnings
- creation: passed
- retrieval: passed
- public-share: passed
- authenticated discovery: warning
- classification: share-link-only-visibility
- artifact: lifecycle-artifacts/<runId>.json
- cleanup: Development team should delete this QA live capsule from staging after verification.
```

### B. Text Live Capsule

```bash
npm run test:inssa:live-text
```

This writes:

```text
lifecycle-artifacts/<runId>.json
lifecycle-artifacts/<runId>.png
```

Artifacts are also mirrored to `test-results/inssa-live-capsule-artifacts/` during the transition, but `lifecycle-artifacts/` is the source of truth.

### C. Authenticated Discovery Using Artifact

Set one of:

```bash
INSSA_LIVE_CAPSULE_ARTIFACT_PATH=lifecycle-artifacts/<runId>.json
INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1
```

For npm scripts, put the selected value in `.env.inssa.live-staging` because the scripts source that file before running Playwright.

Then run:

```bash
npm run test:inssa:discovery
```

### D. Public Share Lifecycle Using Artifact

```bash
npm run test:inssa:public-share
```

The public-share lifecycle requires exact QA subject/message visibility through the tokenized share link in clean, logged-out, and authenticated contexts. A tokenless `/capsule/<id>` probe is recorded separately as observed product behavior; it does not replace the tokenized share-link assertion.

### E. Media Live Capsule

```bash
npm run test:inssa:live-media
```

### F. Video Live Capsule

```bash
npm run test:inssa:live-video
```

The default video fixture is:

```text
tests/fixtures/media/sample-video.mp4
```

This is intentionally static and tiny. Runtime FFmpeg generation is not part of the test path because it created local harness failures before the INSSA upload lifecycle began. Use `INSSA_TEST_VIDEO_FIXTURE_PATH` only when intentionally testing a different local MP4 fixture.

### G. Reveal-Later Live Capsule

```bash
npm run test:inssa:reveal-later
```

### H. Cleanup Capability Audit

```bash
npm run test:inssa:cleanup-audit
```

The cleanup audit is read-only. It detects whether cleanup controls exist, but does not click delete, archive, hide, edit, or unpublish.

## Legacy Full Live-Staging Script

The focused campaign scripts above are the primary workflow. The older broad live-staging script remains available for compatibility, but it should not be the default way to run lifecycle validation because it chains multiple creation phases in one command.

```bash
npm run test:inssa:live-staging
```

For read-only artifact-dependent steps to auto-select the most recent creation artifact, set:

```bash
INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1
```

The helper prints the exact artifact path before using it. If this flag is not set, pass `INSSA_LIVE_CAPSULE_ARTIFACT_PATH` explicitly.

## Artifact Lookup

Artifact-driven lifecycle tests are read-only. They never create a capsule and require evidence from an earlier live create run.

Persistent lifecycle artifacts live in:

```text
lifecycle-artifacts/
```

This directory is gitignored and should not be auto-deleted. It is intentionally separate from Playwright's transient `test-results/` output, which can be cleaned, rotated, or overwritten between runs.

Use an explicit artifact path when validating one known capsule:

```bash
INSSA_LIVE_CAPSULE_ARTIFACT_PATH=lifecycle-artifacts/<runId>.json \
npx playwright test tests/inssa/live-capsule-authenticated-discovery.spec.ts --project=inssa-chrome --workers=1 --retries=0
```

Use auto-latest when you want the harness to select the newest valid creation artifact:

```bash
INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1 \
npx playwright test tests/inssa/live-capsule-authenticated-discovery.spec.ts --project=inssa-chrome --workers=1 --retries=0
```

Auto-latest scans:

```text
lifecycle-artifacts/
test-results/inssa-live-capsule-artifacts/  # fallback only
```

It first selects the newest valid JSON in `lifecycle-artifacts/`. If none exists, it falls back to the legacy Playwright output path. A valid live creation artifact has:

- `environment` is `staging`
- `runId`, `subject`, `message`, `createdAt`, and `cleanupInstruction` are present
- finalization evidence is present through `buryClicked=true`, `revealSettingsOpened=true`, `revealSettingsContinueClicked=true`, `observedCreateSuccess=true`, and non-empty `successSignals`

The selected path is printed before the test runs. Share-link extraction is reported separately. If a finalized artifact has no `finalShareLink`, `possibleFinalCapsuleId`, `possibleShareToken`, or `/capsule/...` `finalUrl`, authenticated discovery can still proceed, but public share-link tests will skip until share-link evidence is captured.

Artifacts that failed before Bury, before Reveal settings Continue, or before observed create success are listed in diagnostics but are not selected.

## Lifecycle Network Diagnostics

Set this only when diagnosing live finalization:

```bash
INSSA_DEBUG_LIFECYCLE_NETWORK=1 npm run test:inssa:live-text
```

When enabled, live create artifacts include:

- `lifecycleClassification`
- `lifecycleNetworkSummary`
- sanitized `writesObserved` request/response entries
- post-Bury and post-Continue request counts
- Firestore write counts
- Firebase Storage call counts
- possible document IDs, capsule IDs, and share tokens
- collection-path summaries when Firestore document paths are visible

Auth/session/API secrets are redacted from URLs and body snippets. Share-link metadata is still captured in dedicated artifact fields when the app exposes it.

Current lifecycle classifications are:

- `finalized-and-retrievable`: finalization produced share-link/capsule/token evidence.
- `reveal-now-needs-recipient-selection`: Shared + Reveal now reached the recipient/share-link follow-up step, but no recipient/link follow-up was completed yet.
- `persistence-created-but-not-surfaced`: backend persistence evidence exists, but no share-link or UI retrieval metadata was exposed.
- `finalized-without-share-link`: success evidence exists, but no share-link/capsule/token was exposed.
- `optimistic-ui-without-persistence`: UI success was inferred, but no post-Continue backend persistence response was captured.
- `finalization-response-missing`: Continue happened, but no finalization response was observed.
- `finalized-but-unindexed`: retrieval metadata exists, but authenticated discovery still cannot find the capsule.

Use delayed read-only discovery only when checking indexing lag:

```bash
INSSA_DISCOVERY_DELAY_MS=60000 \
INSSA_LIVE_CAPSULE_ARTIFACT_PATH=lifecycle-artifacts/<runId>.json \
npx playwright test tests/inssa/live-capsule-authenticated-discovery.spec.ts --project=inssa-chrome --workers=1 --retries=0
```

## Missing Artifact Troubleshooting

If `INSSA_LIVE_CAPSULE_ARTIFACT_PATH` points to a missing file, the resolver fails before browser execution and prints:

- requested artifact path
- resolved absolute path
- current working directory
- persistent artifact directory
- legacy artifact directory
- available artifact JSON files
- whether each JSON is a usable creation artifact

If no valid artifacts exist, run a live create test first, or explicitly point to the intended JSON:

```bash
npm run test:inssa:live-text
INSSA_LIVE_CAPSULE_ARTIFACT_PATH=lifecycle-artifacts/<runId>.json \
npx playwright test tests/inssa/live-capsule-authenticated-discovery.spec.ts --project=inssa-chrome --workers=1 --retries=0
```

If a valid artifact exists and you want the newest one:

```bash
INSSA_USE_LATEST_LIVE_CAPSULE_ARTIFACT=1 \
npx playwright test tests/inssa/live-capsule-authenticated-discovery.spec.ts --project=inssa-chrome --workers=1 --retries=0
```

## Cleanup Responsibility

All live create tests create staging data. Manual cleanup by the development team is required after each successful run.

Do not rerun a live create spec after `Bury` or Reveal settings `Continue` was clicked unless the previous artifact has been checked and the staging capsule has been cleaned up or intentionally retained.

Cleanup automation is not considered safe until the cleanup capability audit proves scoped destructive controls and confirmation behavior for exact QA-owned artifacts.

## Next Work

- Product engineering should fix draft restore precedence before QA turns restore assertions into a green lifecycle gate.
- Product/security should decide whether tokenless capsule and tokenless media access are intended staging behavior or access-control defects.
- QA should create a fresh reveal-later artifact with a future reveal window before reclassifying premature reveal protection.
- QA should keep live creation campaigns single-artifact and opt-in until cleanup automation is proven safe.

## Artifact Retention

Do not delete `lifecycle-artifacts/` as part of normal Playwright cleanup. It is intentionally ignored by git and should be preserved between runs so discovery, public-share, and cleanup-audit specs can consume prior live creation artifacts.

`test-results/` remains disposable. If only legacy artifacts exist there, auto-latest can still use them as a fallback, but new live creation specs write persistent artifacts first.
