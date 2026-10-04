# INSSA operator sheet — 4 October 2026

**FULL DEMO BLOCKED: staging password passed 2/3, then timed out before Profile navigation; zero retries.** See [audit and acceptance matrix](pre-demo-test-reliability-audit.md) and [runbook](demo-readiness-runbook.md). Demo date unknown; allow two hours, with a 35–45 minute core.

- Current tested release: `469236d`, deployment `62ca4342-1507-4631-985f-8b4c15522395`. Password run times: 81.3 / 80.3 / 81.5 s. Preserve failed run `119ec434-d17a-4fda-b62a-25fd91480248`; do not click Run to replace it.
- Until the P0 is resolved, show only health, dated evidence, JSON preview and governance preflights. All six preflights PASS; none of the six live campaigns is certified. Catalog: 0 usable artifacts. Production/Safe/security acceptance stopped behind the auth gate.
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
