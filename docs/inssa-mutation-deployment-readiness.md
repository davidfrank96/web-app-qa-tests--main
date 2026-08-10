# INSSA Mutation Deployment Readiness

Assessment date: 2026-08-03

## Verdict

**DEPLOYMENT BLOCKED**

Readiness: **67%**. The runtime and staging controls are healthy, but the target Supabase project is unprovisioned, durable evidence storage is inactive, Cross-User created an unidentified capsule, and two required Reveal-Later validations could not run.

## Readiness Score

| Area | Weight | Earned | Evidence |
| --- | ---: | ---: | --- |
| Dashboard runtime/build | 15 | 15 | Clean Next.js 15.5.22 build; `/login` 200; protected APIs 401 anonymously |
| Worker, scheduler, restart recovery | 15 | 15 | Supervisor restart succeeded; worker claimed sequential jobs; scheduler heartbeat current with no error |
| Chromium and run-owned evidence | 15 | 8 | Playwright 1.59.1 available; videos/traces/screenshots retained for Media, Video, Cross-User; Text lacks video; Reveal runs absent |
| Environment and mutation safety | 15 | 15 | Staging-only host, Admin preflight, one active run, no retry, dedicated QA flags, limits and sanitization validated |
| Supabase metadata and evidence storage | 20 | 0 | `persistence:verify` reports all 12 platform tables missing; active metadata/evidence providers are local |
| Persistent logs, health and supervision | 10 | 7 | Incremental local logs and CLI healthcheck work; no application liveness endpoint or DigitalOcean process unit is supplied |
| Required campaign completion | 10 | 7 | Four campaigns executed once; Reveal-Later pair blocked by the required unknown-object stop |
| **Total** | **100** | **67** | Target of 80% not met |

## Component Assessment

| Component | Result | Notes |
| --- | --- | --- |
| Dashboard | PASS | Production build and restart passed. Mutation status cards and exact deferred-cleanup banner are implemented. Authenticated visual review still requires an Admin dashboard login. |
| Worker | PASS | Durable job claiming, one-active-run behavior, and sequential execution observed. |
| Scheduler | PASS | Two definitions evaluated; current heartbeat; no scheduler error. |
| Chromium/Playwright | PASS WITH WARNING | Runtime installed and campaigns executed. Text run has no retained video because it occurred before phase-scoped output isolation. |
| Supabase metadata | FAIL | The configured project returns 404 for every required table, including `cleanup_ledger`. |
| Supabase evidence storage | FAIL | Cannot be certified before schema provisioning; active provider remains local filesystem. |
| Environment | PASS | `INSSA_URL` is staging and deferred-cleanup limits are present. Secrets were not printed or persisted in the cleanup ledger. |
| Persistent logs | PARTIAL | JSONL logs are incremental but local; DigitalOcean requires a persistent volume or Supabase metadata before deployment. |
| Restart recovery | PASS | Supervisor stopped cleanly, rebuilt, and restarted Next.js, worker and scheduler. |
| Health endpoint | PARTIAL | `npm run platform:healthcheck` returns PASS WITH WARNINGS; no dedicated dashboard liveness/readiness route exists. |
| Process supervision | PARTIAL | Repository supervisor works locally; no DigitalOcean systemd/App Platform process declaration was found. |

## Validation Results

- `npm --prefix dashboard run typecheck`: PASS.
- `npm --prefix dashboard run test:execution-foundation`: PASS, 33/33.
- `npm --prefix dashboard run build`: PASS; Runtime Doctor PASS.
- `npm run platform:healthcheck`: PASS WITH WARNINGS; Wazuh ingestion reachable, dashboard visibility remains external/manual.
- `npm --prefix dashboard run persistence:verify`: FAIL; 12/12 metadata resources missing.
- `/login`: 200.
- Anonymous `/api/runs`, `/api/cleanup-ledger`, `/api/scheduler/status`: 401.
- Mutation sequence: Text failed, Media failed, Video failed, Cross-User passed with warnings but cleanup identity blocked, Reveal-Later pair not run.

## Deployment Blockers

1. Apply all nine Supabase migrations, verify all 12 RLS-protected tables, provision the private evidence bucket, then enable Supabase metadata/evidence providers.
2. Recover the Cross-User capsule ID from sanitized write evidence or the product, record it in the ledger, and only then release the mutation hold.
3. Update Media and Video contact-selection assumptions without weakening finalization assertions.
4. Run one fresh Text campaign after phase-scoped recording is deployed to prove video retention.
5. Execute Reveal-Later Lifecycle and Reveal-Later Security only after the Cross-User object is identified; use the artifact timestamp as source of truth and mark future reveal checks `pending_post_reveal_validation`.
6. Add DigitalOcean process supervision and persistent-volume configuration, or use certified Supabase persistence for all durable state.
7. Provide a deployment health endpoint suitable for liveness/readiness probes.

## Release Decision

The platform is safe to continue developing locally against staging, and Deferred Cleanup Mode behaves fail-closed. It is not ready for DigitalOcean deployment because durable persistence is absent and the unresolved Cross-User object violates cleanup identity requirements.
