# Stabilization Wave 2 — three efficiency fixes

Wave 1 is **Operationally complete with known observations**, closed by the operator on 2026-09-14. Reopen only for a hard Safe failure (especially the historical Firebase collision), repeated flakiness of the same scheduled Safe test, failed evidence upload, evidence checksum/storage failure, or a natural hosted timeout exposing a gap. The historical retry and lack of a natural timeout do not keep Wave 1 open.

Wave 2 changes only idle worker waits, terminal Runs/Execution details, and cleanup ledger reads. No Authentication Monitoring, mutation tests, scheduler cadence, lease/heartbeat protection, production INSSA configuration, retention, or other DigitalOcean resource changes are included.

| Measurement | Before | After local implementation |
| --- | --- | --- |
| Hosted idle execution-job reads/minute | 111.33, 546 reads in 294.272271 seconds | Hosted post-deployment measurement pending |
| Terminal Runs workspace requests/minute | 20 (16 detail + 4 list) | 4 (0 detail + 4 list), 80% reduction |
| Cleanup persistence writes from three actual GET calls | 35 tracked hosted upsert calls in 76.491 seconds of idle Overview viewing | 0, file contents and modification time unchanged |
| Queue arrival just after maximum idle wait starts | Approximately one-second baseline poll interval | 10,002 ms measured with the actual worker and local durable job store |
| Worker idle CPU / RSS | Hosted sample recorded in measurement JSON | Hosted post-deployment sample pending |

The browser comparison serves the real dashboard component from the main commit and this branch in Chromium with identical loopback-only API fixtures. Each measurement covers 60.1 seconds of wall clock after initial detail loading. This is a controlled browser measurement, not a hosted network capture. The run-list request remains at 15 seconds while idle to discover new runs and meaningful state/version changes. Active work retains the existing three-second polling interval.

Worker waits increase through 1, 2, 4, 8, and 10 seconds on empty queues. Recovery or a claim resets the wait. Queue arrival during the longest wait has at most ten seconds of intentional delay, plus recovery/claim database latency and normal process scheduling. Database outages cannot have a finite claim-time guarantee. Recovery still runs before every claim. The lease remains 120 seconds, heartbeat 15 seconds, and heartbeat failure limit three; ownership loss handling and idempotency are unchanged. The 60-second worker liveness window comfortably covers the idle cap.

Terminal detail snapshots are keyed by run ID, status, and updatedAt (with completedAt/createdAt fallbacks), held in memory for at most ten runs. Active or failed fetches are not retained as successful cache entries. Selecting another run, a new durable version, or explicit “Refresh run details” loads the appropriate snapshot; manual cleanup confirmation also invalidates it. Request sequencing prevents an old selection's delayed response from replacing the current details. A failed detail load remains visibly failed and can be explicitly retried.

Cleanup initialization occurs once at worker startup. Supabase uses an atomic conflict-ignore insert on the existing originating-run/object-type/object-ID identity; local initialization uses the store's existing write lock. Existing durable values, including resolved status, notes, timestamps, and evidence, take precedence. GET and launch-time validation read a fresh snapshot and never persist it. Configured objects absent during startup remain conservatively visible in the read-only snapshot, preserving the original validation policy. The unchanged mutation-readiness tests verify account, identity, sanitization, age, object-count, and deferred-mode protections.

Regression coverage includes the real worker at maximum backoff, an expired claim, one claim per job, unchanged lease contract, existing heartbeat/ownership tests, the actual client in Chromium, explicit refresh, terminal version changes, active polling, terminal transitions, selection races, evidence failure retry, the actual cleanup GET, preserved manual resolution, fresh unsafe-state rejection, and Supabase conflict-ignore request semantics.

Local gates: 90 dashboard platform tests plus 7 policy tests; root/dashboard TypeScript, platform/worker/scheduler/cleanup/readiness, Safe Suite (12/12), security regression (5/5), production build, Runtime Doctor, zero-vulnerability root/dashboard production audits, and diff integrity. Final CI and hosted verification are recorded in the release report after both **QA Enforcement** and **Playwright QA** pass. The only deployment target is **kbean-qa-webapp** (`25bef95b-e762-4675-b850-65794c62aa10`).

Measurement inputs and method limits: [measurement JSON](stabilization-wave-2-measurements-2026-09.json). Reference baseline: [September baseline](platform-stabilization-baseline-2026-09.md). Stop after these three fixes; retention is outside this wave.
