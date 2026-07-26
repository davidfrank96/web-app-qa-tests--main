# INSSA Platform Stabilization Validation

> Historical regression record. Current runtime and subsystem validation commands are documented in `dashboard-runtime.md` and `platform-release-guide.md`.

Date: 2026-07-13

## Scope

This validation pass covered the currently exposed INSSA QA Operations Platform workflows and the safe INSSA staging suite. It did not add new campaign types, expose live mutation campaigns, change Playwright lifecycle assertions, or modify dashboard business logic.

## Executive Summary

The platform is stable for the validated read-only and safe operational surface after three fixes:

- Dashboard production runtime chunk loading was corrected and guarded by `dashboard:doctor`.
- The safe INSSA landing-entry harness was updated for the current staging onboarding, browser-session warning, and location prompt behavior.
- The dashboard-exposed safe suite was serialized with `--workers=1` to avoid staging race/load failures observed under five-worker parallel execution.

## Validation Matrix

| Area | Command or Probe | Result | Evidence |
| --- | --- | --- | --- |
| Safe INSSA suite | `npm run test:inssa:safe` | PASS | `10 passed`, 1 worker |
| Dashboard build | `npm run dashboard:build` | PASS | Next.js production build emitted all app/API routes |
| Dashboard runtime doctor | `npm run dashboard:doctor` | PASS | Runtime manifests, route bundles, chunk loader, env, Supabase config, runner prerequisites, Playwright install all passed |
| Dashboard login route | `GET /login` on fresh `dashboard:start` runtime | PASS | HTTP 200 |
| Protected dashboard API | `GET /api/runs` unauthenticated | PASS | HTTP 401, no 500 |
| Protected command API | `GET /api/campaign-definitions` unauthenticated | PASS | HTTP 401, no 500 |
| Platform healthcheck | `npm run platform:healthcheck` | PASS WITH WARNINGS | Wazuh UI dashboard visibility remains an external/manual check |
| Security report render | `npm run report:security` | PASS | Generated `reports/security/security-campaign-20ed1890ed7c-5fd91d5835.html` and latest summary |
| Lifecycle report render | `npm run report:lifecycle` | PASS | Generated `reports/lifecycle/lifecycle-campaign-text-1783902523471.html` and latest summary |
| SIEM export | `npm run siem:export` | PASS | Generated `reports/siem/latest-siem-export.json` with 52 events |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors |

## Bug Register

| ID | Severity | Status | Root Cause | Resolution |
| --- | --- | --- | --- | --- |
| STAB-001 | Critical | Fixed | `dashboard/next.config.ts` set `outputFileTracingRoot` to the repo parent, producing a server webpack runtime that attempted to load chunks from the wrong path in production. | Scoped `outputFileTracingRoot` to the dashboard package root and added a doctor check that verifies server chunks load from `./chunks/`. |
| STAB-002 | High | Fixed | INSSA staging now shows onboarding and browser-session overlays before the landing actions; the public landing surface no longer requires a search field. | Updated `LandingPage` to dismiss current overlays and validate the current public action surface: `Sign In`, `Find`, and `Bury`. |
| STAB-003 | High | Fixed | The staging location prompt is modal and hides background actions from role locators; Escape is not a reliable dismiss path. | The harness follows the product-supported path by granting Playwright geolocation for staging and clicking `Use my location`. |
| STAB-004 | High | Fixed | `getByRole` could not see visible background landing actions while the location modal owned the accessibility tree. | Switched landing action locators to visible DOM button/link selectors with strict text filters. |
| STAB-005 | Medium | Fixed | The safe suite ran five workers against staging, causing navigation timeouts and modal races not reproduced serially. | Serialized `test:inssa:safe` with `--workers=1`. |
| STAB-006 | Medium | Open external dependency | Dashboard Supabase password login returned `401 Invalid email or password` with the configured INSSA app QA credentials. | Code path is not rejecting users before Supabase; a valid dashboard Supabase user is required for authenticated UI command execution validation. |

## Safe Suite Behavior

The safe suite remains non-mutating. It covers:

- Logged-out Bury entry redirecting to `/signin?next=/timecapsule...`
- Authenticated Bury entry opening the compose surface
- Direct authenticated compose route rendering
- Media step capability visibility without upload
- USA compose location matrix through Compose -> Media -> Share without publishing

The safe suite is serialized intentionally because it black-box tests staging over HTTPS and uses shared staging account/session behavior. This avoids false release blockers from staging load/race behavior while preserving assertions.

## Runtime Stability

The production runtime now validates:

- `BUILD_ID`
- `build-manifest.json`
- `routes-manifest.json`
- `pages-manifest.json`
- `app-paths-manifest.json`
- Required API route bundles
- Server chunk loader path
- Server chunk directory contents

The fresh production smoke test confirmed:

- `/login` returns 200.
- `/api/runs` returns 401 unauthenticated.
- `/api/campaign-definitions` returns 401 unauthenticated.
- No missing chunk, `/_app`, `/_error`, or manifest-related 500s were observed.

## Known External Warnings

- `platform:healthcheck` remains `PASS WITH WARNINGS` because live Wazuh dashboard visibility requires Wazuh UI access.
- Browser output includes `NO_COLOR` / `FORCE_COLOR` warnings from the Node environment. These are non-fatal.
- Safe suite monitor summaries can mark individual steps as `slow` when staging or Google Maps is slow, but the final serialized suite passed.

## Regression Notes

No live mutation campaign was run. No capsule was created by this stabilization pass.

No dashboard API, runner, command registry, auth/RBAC, artifact indexing, report generation, SIEM export logic, or Playwright lifecycle creation logic was changed.

## Current Recommendation

The validated safe/read-only platform surface is stable enough to continue development. Before claiming full dashboard UI execution coverage, create or provide valid Supabase dashboard credentials for a `viewer`, `operator`, and `admin` account so authenticated API/UI command execution can be validated through the browser.
