# INSSA demo readiness runbook — 3 October 2026

**Certification pending hosted acceptance. Do not call the full demo certified yet.** The current audit and exact run inventory are in [pre-demo-test-reliability-audit.md](pre-demo-test-reliability-audit.md). This replaces the 29 September operating assumptions. The date is unconfirmed; plan a two-hour session with a 35–45 minute core.

## Operating boundary

Only QA app `kbean-qa-webapp` (`25bef95b-e762-4675-b850-65794c62aa10`) is in scope. Product writes target staging.inssa.us only. Production is password-auth monitoring only. Keep Phase 5B paused; no historical migration/deletion, retention change, source cleanup or credential/schedule change. New evidence belongs in private Spaces `kbean-qa-evidence`; historical Supabase and Spaces remain readable. Manual product cleanup is advisory and does not block testing.

One worker, one active execution, including evidence indexing. Wait for a terminal run **and uploaded evidence** before starting another. Never double-click Run to repair slowness. Preserve lease 120 s, heartbeat 15 s and failure limit 3. Check the actual scheduler/queue before every live action; avoid overlapping scheduled auth occurrences. Do not change schedules for the demo.

## Current test behavior

Staging password uses the real Profile → Sign out path, verifies matching account/profile and real session removal. A password pass with Google blocked by provider and Apple missing configuration is **Degraded**, which is expected. A password failure is **Failed** and must not be relabeled. Production uses its existing read-only password architecture.

Safe Suite uses one worker and zero retries. The local result is 12/12 in 2.1 minutes, with slow/unstable telemetry retained. The intended compose contract is an exact location-specific subject and valid nonempty seeded message; message copy may be generic. Safe Suite does not publish/save/upload. INSSA does persist account activity and notification-sync metadata (and may initialize account profile at login), so do not describe it as literally mutation-free. Unexpected capsule/draft/media/profile writes fail the suite.

Security Campaign is permitted only with input probes disabled; incomplete artifact coverage is disclosed. Security Verification with no usable artifacts/completed probes is a blocked prerequisite, not a green security result. Reports need real source summaries; missing input now fails. Public-share behavior needs valid current artifacts and a clear contract; absent that, do not demonstrate it live.

JSON evidence uses authenticated inert text preview with a 2 MiB cap; larger JSON remains downloadable. Download authorization and attachment behavior are unchanged. Raw result labels are humanized. Tailwind 4 preserves the dashboard layout; use a supported modern browser.

## Suggested two-hour sequence

1. First 10 min: explain staging/production separation, health, active worker and evidence providers. Show the exact certified release/run IDs from the audit.
2. Next 10 min: show staging password and expected OAuth degradation, then production password evidence. A fresh password check is optional only after certification and outside scheduled work.
3. Next 10 min: one certified Safe Suite, one worker, zero retries; explain account metadata side effects while it executes. Typical local time 2.1 min; allow evidence publication time.
4. Next 10 min: open that run's HTML, screenshots/trace and JSON evidence; identify the run timestamp/provider. Historical evidence must be labeled historical.
5. Next 5 min: governance preview, manual-cleanup advisory and artifact selection. Cancel preview unless the selected campaign has certified live execution and an operator deliberately intends to create staging data.
6. Remaining time: only certified lifecycle demonstrations and security/artifact evidence. Do not budget a long live wait for Reveal-Later. Prefer a prepared artifact with a verified timestamp, or show Create mode and explain pending reveal. Leave time to record exact created IDs for manual cleanup.

## Repeatability and failure handling

Health, password monitoring and a certified Safe Suite may be rerun after completion, with no simultaneous work. Reports, SIEM export and artifact validation require current source evidence. SIEM export is local evidence generation; external SIEM sending is not part of this audit. No synthetic failure email or intentionally invalid production password.

Text, Media, Video, Cross-User and Reveal Create flows create persistent staging objects. This audit allows at most one controlled run per campaign; a failed result may already have created an object. Do not repeat a mutation for confidence. Inspect run evidence and cleanup ledger first. Never directly delete product database records or mark an object cleaned without independent proof.

If a live check fails, keep the result and move to an explicitly dated, uploaded evidence walkthrough. Inspect the error stage and object state. Do not average away failed repeatability, add retries/timeouts, disable assertions or claim missing coverage passed. Only the final matrix in the audit determines GREEN/AMBER/RED status.

## Pre-demo and after-demo checklist

Before the eventual demo, freeze release changes for 24 hours, recheck health/queue, sign in fresh, reopen one new Spaces bundle and one historical Supabase bundle, and verify required artifacts/accounts/fixtures. A point-in-time audit is not a guarantee for an unspecified future date.

Afterward record shown run IDs and any created staging IDs, hand those to the manual-cleanup owner, and preserve evidence. Do not resume Phase 5B or begin another optimization sprint.
