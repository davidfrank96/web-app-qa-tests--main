# Stabilization closure and operating baseline

Wave 1: **CLOSED — Operationally complete with known observations.** The historical Firebase observation remains closed unless it becomes reproducible.

Wave 2: **CERTIFIED and CLOSED**, by operator instruction on 2026-09-14. Release: PR #19, main `d37edbc37d770916a23b7b6d2f4de86702de9339`, DigitalOcean deployment `db01322b-7496-4358-bbd0-610ce1a28ccf` in `kbean-qa-webapp` (`25bef95b-e762-4675-b850-65794c62aa10`).

| Baseline | Expected operation |
| --- | --- |
| Idle execution-job reads | Roughly ≤15/min; measured 12.18/min after Wave 2, 89.1% below baseline |
| Terminal Runs workspace requests | Roughly 4/min; measured 80% below baseline |
| Cleanup viewing writes | 0 |
| Maximum intentional idle claim wait | Approximately 10 seconds, plus database/network/scheduling time |
| Execution lease | 120 seconds |
| Heartbeat | 15 seconds |
| Production dependency vulnerabilities | 0 |
| Safe Suite | 12/12 |
| Production authentication schedules | Disabled |
| Staging authentication schedules | 12:00 and 18:00, Europe/Dublin |

Investigate material regression; otherwise leave these areas alone. Wave 3 is limited to evidence retention policy, holds and a read-only planner. It does not change auth, scheduling, mutations, execution safety or performance settings. No further stabilization wave is authorized by this document.
