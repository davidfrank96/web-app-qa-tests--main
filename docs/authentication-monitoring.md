# Authentication Monitoring Campaign

## Purpose

Authentication Monitoring is the first Continuous Platform Monitoring campaign. It uses the existing command registry, durable job queue, execution worker, immutable run output, Evidence Bundle, scheduler, and Notification Outbox without introducing a second execution path.

```mermaid
flowchart LR
  Definition["Authentication monitor definition"] --> Scheduler["Scheduler trigger"]
  Scheduler --> Job["Durable execution job"]
  Job --> Worker["Certified execution worker"]
  Worker --> Campaign["Authentication monitoring Playwright campaign"]
  Campaign --> Evidence["Evidence Bundle"]
  Worker --> Outbox["Notification Outbox"]
```

The scheduler only creates jobs. The worker remains the sole campaign executor, and no notification provider is called.

## Environments

| Environment | Target | Scheduled state | Safety boundary |
| --- | --- | --- | --- |
| INSSA Staging | `https://staging.inssa.us` | Enabled twice daily at 12:00 and 18:00 Europe/Dublin | Dedicated monitor credentials and explicit enabled-method configuration |
| INSSA Production | `https://inssa.us` | Midday and evening definitions are provisioned disabled | Requires explicit environment enablement, exact host confirmation, and production-only monitor accounts |

Production execution requires both:

```text
AUTH_MONITOR_ALLOW_PRODUCTION=1
AUTH_MONITOR_PRODUCTION_CONFIRMATION=inssa.us
```

The global Operations Platform `INSSA_URL` guard remains staging-only. Production is reachable only through the separately allowlisted production authentication command, whose wrapper replaces the child Playwright target after validating the production confirmation. Other campaigns cannot use this path.

## Independent Checks

The campaign runs three independent Playwright tests with one worker and no retries:

1. Username and password: sign-in page, credential submission, redirect, authenticated profile, and logout.
2. Google OAuth: provider launch, configured test-account completion, redirect, authenticated profile, and logout.
3. Apple Sign-In: provider launch, configured test-account completion, redirect, authenticated profile, and logout.

Each method records one of `passed`, `failed`, `blocked_external`, `missing_configuration`, `disabled`, or `timed_out`. Provider policy restrictions, MFA, CAPTCHA, and account restrictions are `blocked_external`; the campaign does not bypass them or substitute stubs. Missing credentials are `missing_configuration`, and explicit method selection can produce `disabled` without reporting a false failure.

All enabled methods execute even when another method fails. Username/password failure makes the overall campaign fail. An INSSA application failure or timeout also fails the campaign. Provider blocks or missing provider configuration produce `degraded`; disabled methods are excluded from the overall result. A degraded wrapper exits successfully with a warning so durable evidence is still uploaded and the platform records `passed_with_warnings`.

## Configuration

Authentication Monitoring uses one canonical credential namespace:

```text
AUTH_MONITOR_STAGING_EMAIL
AUTH_MONITOR_STAGING_PASSWORD
AUTH_MONITOR_STAGING_GOOGLE_EMAIL
AUTH_MONITOR_STAGING_GOOGLE_PASSWORD
AUTH_MONITOR_STAGING_APPLE_EMAIL
AUTH_MONITOR_STAGING_APPLE_PASSWORD
AUTH_MONITOR_PRODUCTION_EMAIL
AUTH_MONITOR_PRODUCTION_PASSWORD
AUTH_MONITOR_PRODUCTION_GOOGLE_EMAIL
AUTH_MONITOR_PRODUCTION_GOOGLE_PASSWORD
AUTH_MONITOR_PRODUCTION_APPLE_EMAIL
AUTH_MONITOR_PRODUCTION_APPLE_PASSWORD
AUTH_MONITOR_STAGING_METHODS
AUTH_MONITOR_PRODUCTION_METHODS
```

Method lists are comma-separated and accept only `username-password`, `google-oauth`, and `apple-sign-in`. Omitting a list preserves backward compatibility by enabling all three methods. Hosted deployments should set the list explicitly.

Staging email/password checks fall back to `INSSA_TEST_EMAIL` and `INSSA_TEST_PASSWORD` when dedicated monitor credentials are blank. Google and Apple always require dedicated provider credentials. Production requires dedicated values and never falls back to staging credentials.

The authentication wrapper uses Next's `loadEnvConfig` against `dashboard/`, matching the worker and scheduler. Store monitor credentials in the ignored `dashboard/.env.local` file for dashboard-managed execution. The wrapper does not independently load root `.env` or `.env.inssa.live-staging`.

`AUTH_MONITOR_ENVIRONMENT`, `AUTH_MONITOR_OUTPUT_DIR`, and `AUTH_MONITOR_RUN_ID` are execution-managed internal variables and should not be set for normal operation. The complete variable inventory is in `.env.example`. Secrets remain local and must not be written to logs, summaries, screenshots, or committed files.

## Evidence

Every enabled method writes:

- `result.json` with status and timing
- `console-log.json` with sanitized browser console entries
- `screenshot.png`

Failed, blocked, missing-configuration, and timed-out methods additionally write `network-log.json` and sanitized HAR diagnostics. Playwright uses `trace=retain-on-failure`, so these tests retain their trace bundle under the run-scoped `test-results` directory. Existing video-on-failure behavior remains unchanged.

The wrapper produces `authentication-monitoring-summary.json` both in the authentication evidence directory and inside the Playwright report bundle. This lets the authenticated dashboard read monitoring results through the certified bundle route without a new file-serving API.

## Commands

```bash
npm run test:inssa:monitor:auth:staging
npm run test:inssa:monitor:auth:production
```

The production command fails before browser startup unless the production gate is satisfied.

## Dashboard

The read-only Authentication Monitoring workspace displays:

- Overall status
- Independent method status and timing
- Execution time
- Last success and failure
- Environment and target host
- Playwright evidence link
- Historical environment-specific runs

It has no scheduler, retry, notification, or credential controls.

## Failure Handling

Playwright may exit non-zero when a method is blocked so its trace is retained. The wrapper derives the platform outcome from the independent result files: provider-only blocks become a successful degraded wrapper result, while username/password or application failures remain non-zero. The existing worker always finalizes immutable output and indexes artifacts and Evidence Bundle metadata. A degraded wrapper result exits zero, uploads durable evidence, becomes `passed_with_warnings`, and writes the deduplicated `run_completed` outbox event. A hard failure remains non-zero and uses the existing failed-run and `run_failed` paths.

Notification delivery remains unimplemented.
