# INSSA operator sheet — 3 October 2026

**Full-demo certification pending.** See [audit and acceptance matrix](pre-demo-test-reliability-audit.md) and [runbook](demo-readiness-runbook.md). Demo date unknown; allow two hours, with a 35–45 minute core.

- Check health, signed-in admin, exact release, idle worker and uploaded evidence first. **One execution at a time**, including indexing. Never click Run again because a result is slow.
- Show health → auth status → certified Safe Suite → report/JSON/trace → governance → only certified lifecycle/artifact demonstrations.
- Staging password must pass. Google **Blocked by provider** and Apple **Missing configuration** make the full monitor **Degraded**, not failed. Production is password-only and read-only.
- Safe Suite: 12 tests, one worker, **zero retries**. Local pass took 2.1 min; hosted 3/3 pending. INSSA writes account activity/notification metadata; no publish/save/upload is intended. Report slow/unstable telemetry truthfully.
- New evidence is **Spaces**, historical evidence remains **Supabase + Spaces**. Reopen the exact run after fresh login. JSON has safe text preview; downloads remain available (preview cap 2 MiB).
- Health/auth/certified Safe checks can repeat after terminal completion. Security/report/SIEM/artifact commands require real source inputs. Missing coverage is blocked, never a success.
- Text/Media/Video/Cross-User/Reveal Create **create staging data**. Use only certified flows and deliberate consent. A failed run may already have created an object: inspect evidence/ledger before doing anything else. Cleanup is manual and nonblocking.
- Reveal-Later: prefer a prepared approved artifact; verify reveal timestamp and mode. Do not wait through a long reveal interval live. Public share stays conditional until the current contract is proven.
- If a check fails, preserve it, explain the boundary, and switch to dated uploaded evidence. Do not retry mutations, hide failure with retries, force production errors, send synthetic alerts or delete product records.
- Check actual scheduled occurrences before starting; do not change schedules. Freeze deployments 24 h before the eventual demo.
- Record shown run IDs and created object IDs afterward. **Phase 5B stays paused. No historical Supabase deletion.**
