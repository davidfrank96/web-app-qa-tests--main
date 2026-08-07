# INSSA Mutation Test Discovery Audit

Audit date: 2026-08-03 (Europe/Dublin)

## Safety Outcome

All attempted commands targeted `https://staging.inssa.us`, passed the Admin preflight, used one worker and `--retries=0`, and ran sequentially. Execution stopped after Cross-User because the successful finalization did not expose a capsule ID. Reveal-Later Lifecycle and Reveal-Later Security were not started. This is the required fail-closed behavior, not a skipped validation convenience.

The dashboard displays: **INSSA staging cleanup is deferred because direct database access is unavailable.** Deferred cleanup records evidence and ownership only. It does not delete INSSA data.

## Campaign Matrix

| Campaign | Command | Primary spec | Helpers and product screens | Routes and observed services | Accounts and fixtures | Result | Failure and classification | Cleanup | Evidence | Readiness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text Lifecycle | `npm run test:inssa:campaign:text` | `tests/inssa/live-capsule-create.spec.ts`; downstream discovery and public-share specs | `TimeCapsulePage`, auth helpers, lifecycle/network monitors; Compose -> Add media & bury -> Reveal settings -> Send or save -> success | `/timecapsule`, tokenized `/capsule/:id`; Firebase Auth lookup/refresh, Firestore Listen/Write | Primary dedicated QA account; text-only | `failed`, run `1376b7e6-f8f5-4f45-8e44-d1e2efab63f2`, exit 1, 206.8s | Creation and discovery completed. Public-share clean request returned 200 but exact subject/message did not render. Application/public-share issue. Current run also lacks video because the pre-fix multi-phase output was overwritten. | `timeCapsules/BKL0l2iupBRJl5pmHBUK`, `cleanup_unavailable`, safely tracked | Bundle `3d800467-2445-4201-95fa-c071056a3425`; report artifact `f4ca74d1-0073-4b5d-9055-29d924f60cef`; 44 artifacts, 16 screenshots, 2 traces, no retained video | `unstable` |
| Media Lifecycle | `npm run test:inssa:campaign:media` | `tests/inssa/live-capsule-media-create.spec.ts` | `TimeCapsulePage`; Compose -> Photo -> Add media & bury -> Reveal settings -> Send or save | `/timecapsule`; Firebase Storage upload plus Firebase/Firestore services | Primary dedicated QA account; static image; approved US market | `failed`, run `9ce50554-cda5-4d99-9339-677e74e4d352`, exit 1, 42.9s | Test expected a share-link finalization action at `0 selected`. Current UI requires contact selection or `Bury, then choose who to share with`. Test-script drift; no second final action was attempted. | `media/1785714464522-0-inssa-live-media-4d084be2edcd-328671fb58.webp`, `cleanup_unavailable` | Bundle `09432b1c-b601-4370-9440-4a1a56df4315`; video artifact `7e314770-0df0-443c-9282-b6500706db1b`; report `b131fc40-aa4c-41fd-ac9f-a139d538f69b` | `unstable` |
| Video Lifecycle | `npm run test:inssa:campaign:video` | `tests/inssa/live-capsule-video-create.spec.ts` | `TimeCapsulePage`; Compose -> Video -> Add media & bury -> Reveal settings -> Send or save | `/timecapsule`; Firebase Storage MP4 upload plus Firebase/Firestore services | Primary dedicated QA account; `tests/fixtures/media/sample-video.mp4`; approved US market | `failed`, run `ec7dbdc9-0d34-4e65-8905-acbf5d392ea6`, exit 1, 25.1s | Same confirmed 0-selected contact workflow drift as Media. Test-script issue; final contact-share action was not clicked. | `media/1785714850945-0-sample-video.mp4`, `cleanup_unavailable` | Bundle `bb533a22-9e29-4720-94e3-23456d09bbf6`; video `da0b08f5-cb47-42dc-94a6-4716ec076233`; report `e6411b75-e346-44e8-8fbe-7decc175b96d`; phase-scoped output retained | `unstable` |
| Cross-User | `npm run test:inssa:campaign:cross-user` | `tests/inssa/contact-share-state-machine.spec.ts`; scripted User B probes | `TimeCapsulePage`, contact selection/state helpers; Send or save 0 -> 1 selected -> final action -> success | `/timecapsule`, `/signin`, `/me`, Messages/Feed/Search/Profile surfaces; Firebase/Firestore | Distinct primary and secondary dedicated QA accounts | `passed_with_warnings`, run `85c3b935-9fa1-4e4f-ba05-456464af291d`, exit 0, 80.1s | Contact share and User B access passed, but success evidence contained no capsule ID, tokenized URL, or ID-bearing route. Test-harness/evidence identity blocker. | `pending`; capsule finalized but unidentified. No ledger record was fabricated. | Bundle `42442c39-2491-40ed-8ac1-c1c89ebfe073`; video `016df8a3-2fa6-4b7b-af30-a81221d30dec`; report `dc84cd33-8161-4a66-a0cd-ba7e6358fb30`; security report `f08f444d-a4b2-4f26-8341-3613cf55da17` | `blocked` |
| Reveal-Later Lifecycle | `npm run test:inssa:campaign:reveal-later` | `tests/inssa/live-capsule-reveal-later-create.spec.ts` | `TimeCapsulePage`; Reveal Later date/time input and timestamp-evidence collectors | `/timecapsule`; Firebase Auth/Firestore; visible `MM/DD/YYYY hh:mm aa` input | Primary dedicated QA account | Not executed after mandatory Cross-User stop | Current code captures visible date/time, storage and sanitized network candidates. Historical evidence proves the UI model, but this sprint did not create a fresh artifact and makes no current pass claim. | Not created | No sprint run/video/bundle | `blocked` |
| Reveal-Later Security | `npm run test:inssa:campaign:reveal-later-security` | `scripts/inssa/run-reveal-later-security-campaign.js`; reveal-later create spec when not resuming | Primary/secondary direct-route and authenticated-surface probes before/after reveal | `/capsule/:id`, `/signin`, `/me`, Messages/Feed/Search/Profile; Firebase/Firestore | Primary QA; optional secondary QA; approved reveal artifact for resume | Not executed after mandatory Cross-User stop | No fresh scheduled artifact was available because the preceding lifecycle campaign was blocked. No `pending_post_reveal_validation` status was fabricated. | Not created | No sprint run/video/bundle | `blocked` |

## Reveal-Later Flow Audit

Repository code recognizes the current Reveal-Later screen through the visible date/time input (`MM/DD/YYYY hh:mm aa`), captures `selectedDateText`, `selectedTimeText`, timezone evidence when exposed, and resolves `scheduledAtIso` from the strongest DOM/storage/network candidate. The security wrapper compares current time with that timestamp and skips post-reveal checks when it is still in the future.

The latest historical artifact, `lifecycle-artifacts/b952b1d4fe53-c271b67d56-reveal-later.json`, contains visible input evidence for `06/06/2026 01:07 PM` and a nested resolved timestamp of `2026-06-06T12:07:00.000Z`. Its legacy top-level `scheduledAtIso` is null. This is historical evidence only; it was not reused because the required fresh lifecycle run was never allowed to start.

## Known INSSA Issues

1. `INSSA-CLEANUP-001`: direct database cleanup is unavailable; QA objects require manual product-side cleanup.
2. A tokenized Text capsule returned HTTP 200 but did not render the exact QA subject/message in the public-share probe.
3. Media and Video now reach the contact-selection workflow at `Send or save · 0 selected · Step 2 of 2`; a share link is not exposed before contact handling.
4. The Cross-User success surface confirms burial and delivery but does not expose an object ID in the URL or visible success evidence.

## Known Harness Issues

1. Media and Video creation specs still assume the former pre-contact share-link action and fail before selecting a contact.
2. Cross-User does not derive the finalized capsule ID from sanitized Firestore write evidence, so cleanup cannot be safely attributed.
3. The first Text run predated phase-scoped Playwright output and lost its creation video when downstream phases reused the report directory. Phase-scoped output is now implemented for future multi-phase lifecycle runs.
4. Historical latest/report files can be rewritten by legacy campaign renderers. Cleanup identity now reads authoritative lifecycle/security campaign artifacts only, and the durable ledger replaces records per run.

## Unresolved Staging Objects

| Object | Originating run | Status | Retention target | Accounting |
| --- | --- | --- | --- | --- |
| `timeCapsules/Zd7QsNEJGbMXOSvAn3qc` | `dd7b8a3d-7bcc-4409-8d3c-ef7a99ad70bb` | `cleanup_unavailable` / `INSSA-CLEANUP-001` | 2026-10-31 | Identified, dedicated QA, safely accounted |
| `timeCapsules/BKL0l2iupBRJl5pmHBUK` | `1376b7e6-f8f5-4f45-8e44-d1e2efab63f2` | `cleanup_unavailable` | 2026-10-31 | Identified, dedicated QA, safely accounted |
| `media/1785714464522-0-inssa-live-media-4d084be2edcd-328671fb58.webp` | `9ce50554-cda5-4d99-9339-677e74e4d352` | `cleanup_unavailable` | 2026-11-01 | Identified Firebase Storage object, dedicated QA, safely accounted |
| `media/1785714850945-0-sample-video.mp4` | `ec7dbdc9-0d34-4e65-8905-acbf5d392ea6` | `cleanup_unavailable` | 2026-11-01 | Identified Firebase Storage object, dedicated QA, safely accounted |
| Unknown finalized Cross-User capsule | `85c3b935-9fa1-4e4f-ba05-456464af291d` | `pending` | Unset until identity is recovered | Blocking; successful creation but no object ID |

No automatic deletion was attempted. No unresolved object is marked completed.
