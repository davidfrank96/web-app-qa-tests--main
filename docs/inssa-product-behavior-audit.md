# INSSA Product Behavior Audit

Date: 2026-05-31

Target: `https://staging.inssa.us`

Repository: QA harness only. This repo does not contain INSSA product source code.

## Executive Summary

This audit mapped the current INSSA staging behavior from the authenticated QA account through black-box browser inspection. The run was staging-only and hard-blocked non-staging hosts.

The audit created one QA-tagged draft-side compose artifact to inspect the Time Capsule flow:

```text
QA_PRODUCT_AUDIT_DRAFT_audit-20260531T115504
```

No live capsule was finalized during this audit. The audit clicked `Bury` only to open Reveal settings, then stopped before contact/share finalization. No destructive cleanup controls were clicked.

Key findings:

- Authenticated staging routes are accessible for home/map, profile, settings, connections, requests, points ledger, messages, time capsule compose, and known capsule routes.
- The browser-session privacy warning appears broadly and can obscure modal inspection unless dismissed before snapshotting.
- Time Capsule compose is a three-step flow: `Compose -> Media -> Share -> Bury -> Reveal settings`.
- Current Reveal settings Step 1 is timing-first in this audit: `Reveal now`, `Reveal later`, `Continue`, `Cancel`. It did not show `Shared capsule` or `Personal memory` on Step 1.
- Reveal-later Step 1 exposes scheduling controls before Continue. Step 2 exposes contact/save/share-link finalization choices.
- Existing QA-created live artifacts remain directly retrievable through known capsule URLs, but home/search/profile/messages did not reliably expose exact QA subjects/messages as indexed content.
- Tokenless `/capsule/<id>` access exposed exact QA content in multiple security probes. Treat this as a staging access-control product question, not a harness assertion gap.
- No UI delete/archive/unpublish controls were found on audited direct capsule, profile, or messages surfaces. Live capsule cleanup remains manual/dev-team owned.

## Artifacts

Machine-readable artifacts were written under:

```text
lifecycle-investigations/
```

Screenshots were written under:

```text
lifecycle-investigations/screenshots/
```

Primary artifacts:

| Artifact | Purpose |
| --- | --- |
| `lifecycle-investigations/audit-summary.json` | Environment, selected live artifacts, run metadata. |
| `lifecycle-investigations/routes.json` | Route inventory with final URL, visible buttons, headings, toasts, screenshots. |
| `lifecycle-investigations/navigation-controls.json` | Route-level navigation-control capture shell. Use `routes.json` for the populated visible button inventory from this run. |
| `lifecycle-investigations/timecapsule-flow.json` | Compose, Media, Share, Reveal settings, and reveal-later snapshots. |
| `lifecycle-investigations/reveal-later-flow.json` | Focused reveal-later state-machine snapshot. |
| `lifecycle-investigations/discovery-visibility.json` | Direct/share and authenticated surface visibility checks for existing artifacts. |
| `lifecycle-investigations/security-access.json` | Tokenized/tokenless access probes in clean, logged-out, and authenticated contexts. |
| `lifecycle-investigations/cleanup-capability.json` | Non-destructive cleanup-control inventory. |

## Environment And Account Context

Confirmed environment:

- `INSSA_URL`: `https://staging.inssa.us`
- Hostname: `staging.inssa.us`
- Run ID: `audit-20260531T115504`
- Browser context: Playwright Chromium with existing authenticated INSSA storage state.
- Authenticated profile route redirects `/me` to `/u/test`.

Visible account surfaces:

- `/u/test` profile shows profile summary, sign-out, alerts, following, and loved tabs/counts.
- `/settings` shows theme selection and an upgrade path.
- `/profile/connections` shows existing contacts and remove controls.
- `/profile/connections/requests` shows pending request cancel controls.
- `/messages` shows `Received`, `Buried`, and `Memories` tabs.

No admin, role-management, creator-only, or elevated settings were observed in this audit.

## Route Map

The following routes were probed with the authenticated QA context:

| Route label | Target | Final URL | Classification | Notable visible controls |
| --- | --- | --- | --- | --- |
| `home` | `/` | `/` | accessible | `Got it`; map/home surface. |
| `signin` | `/signin` | `/` | accessible/redirected authenticated | `Find`, `Bury`; authenticated session preserved. |
| `me` | `/me` | `/u/test` | accessible | `Back`, `Sign Out`, `Alerts (0)`, `Following`, `Loved (0)`. |
| `settings` | `/settings` | `/settings` | accessible with permission warning | Theme buttons, `Upgrade to Insider`, permission guidance. |
| `connections` | `/profile/connections` | `/profile/connections` | accessible | `My Contacts`, `Remove`. |
| `connection-requests` | `/profile/connections/requests` | same | accessible | Multiple `Cancel` controls. |
| `points-ledger` | `/points-ledger` | same | accessible | No destructive controls observed. |
| `messages` | `/messages` | same | accessible | `Received`, `Buried`, `Memories`. |
| `timecapsule-empty` | `/timecapsule` | `/timecapsule` | accessible | Browser-session warning visible. |
| `timecapsule-nyc` | `/timecapsule?lat=40.7128...` | same | accessible | Browser-session warning visible. |
| `known-capsule-tokenless` | `/capsule/<id>` | same | accessible | `Back`, capsule loading/content surfaces depending on context. |
| `known-capsule-tokenized` | `/capsule/<id>?token=<token>` | same | accessible | `Back`, capsule loading/content surfaces depending on context. |

No route was classified as missing. `/settings` emitted permissions guidance and was classified as privileged/blocked by the artifact script because browser permission guidance was visible, but the settings page itself rendered.

## Visible Navigation And Controls

Common observed controls:

- Home/map: `Find`, `Bury`.
- Profile: `Back`, `Sign Out`, `Alerts`, `Following`, `Loved`.
- Settings: theme options, `Upgrade to Insider`.
- Connections: `Remove`.
- Requests: `Cancel`.
- Messages: `Received`, `Buried`, `Memories`, `More message views`.
- Capsule routes: `Back`.
- Time Capsule compose: `Discard draft`, `Clear subject`, `Clear message`, `Back and save`, `Save & exit`, `Next step`.

Safe control exploration was intentionally conservative. Destructive or finalizing controls such as `Remove`, `Discard draft`, final share/bury decisions, delete/archive/unpublish, and contact send actions were not clicked.

## Time Capsule Lifecycle Map

Confirmed draft-side compose flow:

```text
/timecapsule?lat=...&lng=...&address=...
-> Step 1: Compose
-> Step 2: Media
-> Step 3: Share
-> Bury opens Reveal settings
```

### Step 1: Compose

Visible fields:

- `Subject*`
- `Your Message*`

Observed behavior:

- Character counters were visible after typing.
- Draft creation feedback appeared: `Draft created and saved to Buried drafts.`
- Browser-session warning can appear and should be dismissed before modal inspection.
- Compose controls included `Discard draft`, `Clear subject`, `Clear message`, `Back and save`, `Save & exit`, and `Next step`.

### Step 2: Media

Visible copy and limits:

```text
Add up to 12 files. Up to 2 can be videos (10s max each).
Selected 0/12 files · 0/2 videos
```

Visible media controls:

- `Photo`
- `Video`
- `Gallery`

File input:

- `accept`: `image/*,video/*`
- `multiple`: `true`

Clicking `Video` in this browser context opened a permission guidance modal:

```text
Camera and microphone access is blocked.
```

This was classified as expected browser-permission behavior, not an INSSA lifecycle failure.

### Step 3: Share

Visible summary:

- `Subject: <QA subject>`
- `Message: <QA message>`
- `Tap Bury to choose reveal timing, then pick connections or share by link.`

Visible controls:

- `Discard draft`
- `Back`
- `Save & exit`
- `Bury`

In this audit, `Bury` opened Reveal settings. No finalization action was taken.

## Reveal-Now State Machine

Current audit confirmed the Step 1 modal structure after `Bury`:

```text
Reveal settings
Step 1 of 2
Reveal timing
Reveal now
Reveal later
Continue
Cancel
```

In this audit snapshot, `Shared capsule` and `Personal memory` were not visible on Step 1. Existing earlier lifecycle artifacts still show a reveal-now path with:

```text
Shared capsule -> Reveal now -> Continue -> Step 2 contact/share decision -> Skip contacts & share link with others -> final share-link state
```

Current test helpers should not assume `Shared capsule` is always present on Step 1. They should snapshot after dismissing browser-session warnings and branch based on actual modal content.

## Reveal-Later State Machine

Current reveal-later classification:

```text
timing-first-contact-after-timing
```

Observed Step 1 after selecting `Reveal later`:

- Title: `Reveal settings Step 1 of 2`
- Step label: `Step 1 of 2`
- Timing controls: `Reveal now`, `Reveal later`
- Scheduling input: `Reveal date & time`
- Date picker control: `Choose date, selected date is May 31, 2026`
- Input placeholder: `MM/DD/YYYY hh:mm aa`
- `Shared capsule`: not visible
- `Personal memory`: not visible

Observed Step 2 after one `Continue`:

- Step label: `Step 2 of 2`
- Header copy: `Send or save`
- Copy: `0 selected · Step 2 of 2`, `Choose one or more ways to finish`
- Input: `Search by name or email`
- Contact controls: `Select all`, two visible contact rows.
- Finalization choices:
  - `Save as personal memory Keep a copy just for me`
  - `Select contacts or memory to bury`
  - `Bury & share link with others`
  - `Back`

The audit stopped at Step 2. It did not click personal memory, contact send, or share-link finalization.

Test impact:

- `chooseRevealSettingsForQaRevealLaterCapsule()` must not require `Shared capsule`.
- It should select `Reveal later`, click `Continue` once, then inspect Step 2 before making any finalization decision.
- It should record title, step label, visible text, buttons, inputs, schedule controls, and contact controls before failing or proceeding.

## Share-Link And Existing Lifecycle Behavior

Existing lifecycle artifacts were available for:

- Text live capsule: `20ed1890ed7c-f658c3a631`
- Media live capsule: `4d084be2edcd-0193d65b64`
- Video live capsule: `25d81e2e79eb-b29df91b6b`
- Reveal-later capsule: `b952b1d4fe53-c9c5347751`

Existing text artifact shows the full successful reveal-now share-link path:

```text
Bury clicked: true
Reveal settings opened: true
Shared capsule selected: true
Reveal now selected: true
Continue clicked: true
Step 2 contact/share decision reached: true
Skip contacts & share link with others clicked: true
Observed create success: true
Final share link captured: true
```

The final share-link state can expose:

- `Copy share link`
- `Share link`
- `Home`
- `/capsule/<id>?token=<token>`

The route can remain `/timecapsule?...` while the final share-link state is shown, so tests should not require a route transition to `/capsule/`.

## Discovery And Indexing Behavior

Discovery probes checked:

- Direct tokenized share link.
- Tokenless capsule URL.
- Home feed.
- Search-home route.
- Profile/history.
- Messages.

Observed authenticated indexing behavior:

- Home feed did not show exact QA subject/message for audited artifacts.
- Search did not show exact QA subject/message for audited artifacts.
- Profile/history did not show exact QA subject/message for audited artifacts.
- Messages showed capsule-like UI but did not reliably expose the exact current QA subject/message being checked.

Classification:

```text
share-link-only-visibility / direct access without authenticated surface indexing
```

This should remain a product behavior classification, not a harness failure, when direct/tokenized retrieval succeeds.

## Security And Access-Control Behavior

Security probes used only known QA-created capsule artifacts. No ID enumeration or brute-force behavior was performed.

Contexts:

- Clean browser context.
- Logged-out browser context.
- Authenticated browser context.

Routes:

- Tokenized `/capsule/<id>?token=<token>`.
- Tokenless `/capsule/<id>`.

Confirmed risk behavior:

- Text capsule exact subject/message was visible tokenized and tokenless in clean, logged-out, and authenticated contexts.
- Media capsule exact subject/message was visible in clean tokenized and tokenless contexts, logged-out tokenized context, and authenticated tokenless context. Some tokenized/authenticated probes were inconsistent.
- Video capsule access was inconsistent by context in this audit, but prior security campaign evidence classified media/video retrieval as publicly accessible from captured artifact URLs.
- Reveal-later existing artifact was visible tokenized and tokenless in multiple contexts, but that artifact may already have passed its scheduled reveal time.

Security classification from prior campaign remains relevant:

- `token-optional`
- `public-by-id`
- `share-link-only`
- `delayed-indexing`
- `media-publicly-accessible`

Risk framing:

- Tokenless `/capsule/<id>` exact content exposure is a high-risk staging product finding unless intended by product design.
- Media/video tokenless access should be reviewed by engineering/product for intended sharing semantics.
- Reveal-later protection must be revalidated with a future-scheduled artifact before classifying bypass behavior.

## Media And Video Behavior

Media step capabilities:

- App supports a combined `image/*,video/*` file input with `multiple=true`.
- UI states a limit of 12 total files and 2 videos.
- Video capture path in browser can be blocked by camera/microphone permissions.

Existing lifecycle campaigns already validate media and video creation using controlled fixtures. This audit did not create new media/video capsules.

Open media/video questions:

- Whether uploaded storage objects are intended to be public by URL.
- Whether token/auth should gate media bytes separately from capsule page access.
- Whether thumbnail/preload request failures are expected warning-only noise.

## Cleanup Capability

Non-destructive cleanup audit checked:

- Direct tokenized capsule route.
- Tokenless capsule route.
- `/me`.
- `/messages`.

No visible delete/archive/hide/unpublish/edit controls were found for known QA-created artifacts on audited surfaces.

Classification:

```text
manual dev cleanup only / unavailable in audited surfaces
```

Draft-side cleanup:

- The audit may have left a draft-side artifact with exact subject `QA_PRODUCT_AUDIT_DRAFT_audit-20260531T115504`.
- Dev/QA can remove it by exact subject if desired.
- Do not use broad draft cleanup selectors for user data.

## Confirmed Product Behavior

- Staging host was used exclusively.
- Authenticated storage state opens INSSA surfaces.
- `/signin` with auth redirects/preserves authenticated home state.
- `/me` resolves to `/u/test`.
- Time Capsule compose fields and draft creation feedback render.
- Media step exposes Photo, Video, Gallery, combined image/video file input, and media limits.
- Share step shows authored subject/message summary and Bury.
- Bury opens Reveal settings and does not immediately complete creation.
- Current Reveal settings Step 1 can be timing-only.
- Reveal-later Step 2 exposes save/contact/share-link finalization choices.
- Existing live artifacts can be directly retrieved through known capsule routes.
- Authenticated indexed surfaces do not reliably expose exact QA capsule content.
- Tokenless capsule access can expose exact QA content.
- No UI cleanup controls were observed for live capsules in audited surfaces.

## Suspected Behavior

- Authenticated feed/search/messages/profile may intentionally exclude share-link capsules, or indexing may be delayed/limited.
- Tokenless capsule access may be intended for public share semantics, but this needs explicit product confirmation.
- Reveal-now and reveal-later modal structure may vary by app state, feature flag, account setting, or prior selection.
- Browser-session warning can affect timing and modal snapshot stability if not dismissed.

## QA Harness Gaps

- Reveal-later helpers must handle timing-first Step 1 without requiring `Shared capsule`.
- Modal helpers should dismiss browser-session warnings after Bury and before Reveal settings inspection.
- After warning dismissal, helpers should capture a fresh modal snapshot before asserting available options.
- Discovery tests should continue classifying authenticated undiscoverability as warning behavior when direct retrieval works.
- Security tests should keep tokenless access as a finding, not a reason to weaken direct-share validation.

## Product Questions For Engineering

- Is tokenless `/capsule/<id>` content visibility intended for all shared capsules?
- Should media/video storage bytes be retrievable without token/auth when the capsule page is public by ID?
- Should share-link capsules appear in home/search/profile/messages for the owner?
- What is the intended visibility model for `Received`, `Buried`, and `Memories` tabs?
- Is current Reveal settings Step 1 expected to be timing-first, audience-first, or conditional?
- What exact conditions determine whether `Shared capsule` and `Personal memory` appear on Step 1?
- Should reveal-later content be inaccessible before the scheduled reveal time through both tokenized and tokenless routes?
- What is the supported UI cleanup path for QA-created live capsules?

## Recommended Next Tests

1. Update reveal-later test helpers to dismiss session warnings, snapshot Step 1, select `Reveal later`, click `Continue` once, then inspect Step 2 before failing or finalizing.
2. Run a single future-scheduled reveal-later lifecycle campaign and immediately run security probes before the scheduled reveal time.
3. Add assertion-level separation between tokenized retrieval success and tokenless exposure findings.
4. Add read-only owner-surface discovery diagnostics for `Received`, `Buried`, and `Memories` tabs individually.
5. Add non-destructive cleanup capability snapshots after navigating from direct capsule pages, profile, and messages.
6. Ask engineering/product to confirm intended tokenless access and owner indexing semantics before treating those findings as pass/fail gates.

## Cleanup Note

This audit did not create a live capsule. It may have created a draft-side compose artifact:

```text
Subject: QA_PRODUCT_AUDIT_DRAFT_audit-20260531T115504
Message: QA product behavior audit draft. Safe to delete. run=audit-20260531T115504
```

If cleanup is desired, remove only this exact QA-tagged draft. No broad cleanup should be performed from these audit results.
