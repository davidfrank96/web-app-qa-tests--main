# Safe Suite classification and governed Home/Bury

Home initialization calls `discover_seedQuickFindCategories`, which can create/update persistent system-owned discovery capsules and hydrate stored media. Both guest and authenticated Home/Bury assertions therefore belong to the existing staging Text Lifecycle, not the Safe Suite. No new campaign is introduced.

The deployed source audit established that exact POST `https://us-central1-kbean-stg-fcm.cloudfunctions.net/listMyRaffleClaims` only reads raffleTickets, raffles, and businesses. Only this method/host/path is allowed as READ_ONLY_DEPENDENCY. The seed function is PRODUCT_MUTATION and remains blocked, including responses that reuse capsules. Unknown Cloud Function POSTs remain blocked.

Safe authentication setup is guarded before navigation and uses a direct-compose sign-in return route. A failed guarded login cannot leave a reusable cached session. Normal staging service workers remain enabled and their outbound requests meet the context guard; production auth policy is unchanged. Current-session activity/FCM metadata and verified unchanged profile hydration are separately classified benign initialization, not product content creation. Unknown/changed profile content, drafts, capsules, and uploads fail closed.

Text Lifecycle retains its staging-only/admin/approval/confirmation, single active mutation, dedicated QA account, manual cleanup, fixture, evidence, and zero-retry controls. Home seed evidence records timestamp, optional counts, and reported IDs without request payloads. These are system-owned review candidates, never QA ownership or deletion authorization. Missing identities stay unknown. Seed responses are kept out of the normal QA capsule identity inference and cleanup candidates. Automatic deletion is not introduced.

## Local acceptance (2026-10-04 23:27 UTC)

One full `npm run test:inssa:safe -- --max-failures=1` execution: **10/10 passed**, zero skipped, flaky, or failed; one worker, zero retries; 90.477 seconds. The ten tests are two isolated-context checks, direct compose, media capability, and six compose locations. Neither Home/Bury test is in this command.

Recorded Safe and authentication setup traffic: zero seed calls, zero blocked/unexpected writes, zero unknown writes forwarded, and zero observed product mutations. Direct compose remains in Safe on this evidence. This is browser-request observation, not an independent database-wide before/after audit.

Text Lifecycle preflight only passed against the local configuration with an actual supervised worker, isolated empty worker queue, manual-cleanup mode enabled for the check, and no scheduler. No live lifecycle execution was launched. API admin/approval enforcement is additionally tested through regressions; the local component preflight is not proof of a logged-in hosted admin session.

Validation: root/dashboard TypeScript; 236 dashboard regressions (including governance, mutation readiness, manual cleanup, worker/scheduler, providers, retention and Phase 5A); focused write-policy/session/service-worker/guarded-auth/Home-Bury fixtures; 18 staging authentication cases; production auth and cache fixtures; security and secret scan; Reports features and 20 theme/viewport layouts; manual-cleanup and auth-monitor UI; production build; Runtime Doctor; root/dashboard dependency audits (zero vulnerabilities); diff whitespace check. Focused lifecycle tests were repeated after tightening seed identity separation.

Local detailed evidence is under `output/playwright/safe-suite-home-bury/` and is not committed because browser artifacts can contain session information.

## Release gates

Exact-head QA Enforcement and Playwright QA must pass before merge. Deploy only kbean-qa-webapp (25bef95b-e762-4675-b850-65794c62aa10). Hosted acceptance requires two consecutive Safe passes, Text preflight, and new Spaces evidence integrity/fresh-login retrieval. Stop after the first hosted failure. This document does not claim those pending gates have passed.

Production INSSA mutation stays disabled. Monitoring schedules, Brevo, Reports, storage architecture, and Phase 5A are unchanged. Phase 5B has not started; historical deletion is zero.
