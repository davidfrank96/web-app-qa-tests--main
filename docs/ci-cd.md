# CI/CD Pipeline

The repository has two required GitHub Actions contexts:

- `Playwright QA / test`
- `QA Enforcement / Playwright QA Gate`

Both workflows run on pushes and pull requests targeting `main`, and can be started with `workflow_dispatch`.

## Required Checks

### Playwright QA / test

This job is the browser gate. It:

1. Installs the root lockfile with `npm ci`.
2. Installs Playwright Chromium and its OS dependencies.
3. Lists the approved safe suite to prove test discovery.
4. Runs `npm run test:ci:playwright`.
5. Uploads `playwright-report/` and `test-results/` only on failure, with seven-day retention.

The approved suite is non-destructive and targets only `https://staging.inssa.us`. It does not run lifecycle mutation, cross-user mutation, authentication monitoring, SIEM transmission, or notification delivery.

Ordinary required CI is credential-free. Authenticated safe checks require `INSSA_TEST_EMAIL` and `INSSA_TEST_PASSWORD`, so those suites are explicitly reported as skipped while public smoke and logged-out safety checks run. This gives forked pull requests the same deterministic scope and keeps authenticated traces out of Actions artifacts. The dedicated authentication-monitor campaign remains discoverable but is not executed by this workflow.

### QA Enforcement / Playwright QA Gate

The final gate depends on these mandatory jobs:

| Job | Commands |
| --- | --- |
| Repository integrity | `npm ci`, safe-suite discovery, authentication-monitor discovery, `git diff --check` |
| Root TypeScript | `npm ci`, `npm run typecheck` |
| Dashboard build and runtime | root and dashboard `npm ci`, dashboard typecheck, `npm run dashboard:build`, `npm run dashboard:doctor` |
| Certified platform subsystems | dashboard `npm ci`, `npm run test:ci:platform` |
| Ingestion and SIEM security | root `npm ci`, `npm run test:ci:security` |
| Production dependency audit | root/dashboard `npm ci`, root/dashboard `npm audit --omit=dev --audit-level=high` |

The gate runs with `if: always()` and accepts only a `success` conclusion for every prerequisite. Failure, cancellation, or skip blocks the gate and the log prints each prerequisite conclusion.

The Playwright browser execution remains in the separate required `Playwright QA / test` context to avoid adding live browser access to every platform job. Branch protection must require both contexts.

## Environment And Secrets

| Variable | Classification | CI behavior |
| --- | --- | --- |
| `CI` | Required, non-secret | Set to `true`. |
| `INSSA_URL` | Required, public, staging-only | Fixed to `https://staging.inssa.us`. User-supplied targets are not accepted. |
| `PLAYWRIGHT_HTML_OPEN` | Required, non-secret | Set to `never`. |
| `AUTH_MONITOR_ALLOW_PRODUCTION` | Required safety control | Fixed to `0` in QA Enforcement. |
| `INSSA_TEST_EMAIL` / `INSSA_TEST_PASSWORD` | Campaign-specific secrets | Not supplied to ordinary CI. Approved credentialed safe-suite runs use a separate execution context. |
| `LOCALMAN_ADMIN_EMAIL` / `LOCALMAN_ADMIN_PASSWORD` | Campaign-specific secrets | Not required or supplied to ordinary CI. |
| `AUTH_MONITOR_*` credentials | Dedicated campaign secrets | Not required or supplied to ordinary CI. |
| Supabase browser/service values | Deployment secrets/configuration | Not required for compile-only dashboard CI; Runtime Doctor may report the expected configuration warning. |
| Wazuh/SIEM credentials | Delivery secrets | Not supplied. CI tests only fail-closed and redaction behavior. |

Any future credentialed workflow must use GitHub Actions secrets, never workflow YAML, and must not upload raw credential-bearing traces. GitHub does not expose repository secrets to forked pull requests.

Production URLs, production monitor confirmations, Supabase service-role keys, Wazuh bearer tokens, provider credentials, cookies, session IDs, and share tokens are prohibited from workflow files and uploaded artifacts.

## Local Reproduction

Use Node 22 LTS to match the package engine contract, Runtime Doctor, and GitHub Actions:

```bash
npm ci
npm --prefix dashboard ci
npm run typecheck
npm --prefix dashboard run typecheck
npm run test:ci:playwright:list
npm run test:ci:auth-monitor:discovery
npm run dashboard:build
npm run dashboard:doctor
npm run test:ci:platform
npm run test:ci:security
CI=true INSSA_URL=https://staging.inssa.us npm run test:ci:playwright
npm audit --omit=dev --audit-level=high
npm --prefix dashboard audit --omit=dev --audit-level=high
git diff --check
```

Do not invoke `next build`, `next dev`, or `next start` directly. Use the certified dashboard wrappers. Stop an active dashboard before a local clean build, or use an isolated clean checkout.

## Failure Evidence

The Playwright workflow uploads:

- `playwright-report/`
- `test-results/`
- retained traces, screenshots, and videos produced by the configured failure policy

Artifacts are retained for seven days. Local environment files, auth state under the operating-system temporary directory, `.next`, dashboard metadata, lifecycle artifacts, campaign outputs, and SIEM credentials are not uploaded.

The location-consent helper re-resolves the current dialog and visible button after staging re-renders the prompt. Retries are limited to transient detachment, stability, and visibility failures; no fixed sleep is used. Playwright retains traces, screenshots, and videos only for failed attempts.

The strict console classifier records the staging `logEvent` telemetry function's known HTTP `400` console message as acceptable staging noise. The rule is limited to that exact staging endpoint, status, and console issue type; other cloud-function failures, HTTP `5xx` responses, page errors, and functional API failures remain release-blocking.

## Prohibited CI Execution

Ordinary required checks must not execute:

- production authentication monitoring
- text, media, video, reveal-later, cross-user, or other live mutation campaigns
- SIEM send
- notification delivery
- broad `npm test` discovery followed by uncontrolled execution
- arbitrary product targets

Optional provider and mutation campaigns require separate, explicitly approved workflows and credentials.

## Failure Forensics

The 2026-07-26 failures in both required checks occurred in the Playwright command before browser execution. Full Actions logs showed `tests/localman/admin/user-management.spec.ts` and `tests/localman/admin/vendor-management.spec.ts` throwing during module import because Localman admin secrets were absent. Both workflows also used unrestricted `npm test`, which included credentialed and mutation suites outside the release-gate scope.

The repair moves Localman admin credentials behind explicit suite gates, makes INSSA authenticated safe checks skip clearly when fork-safe secrets are unavailable, and replaces unrestricted execution with named deterministic CI commands.

The 2026-07-27 remediation standardizes required CI on Node 22 LTS, installs both dependency trees before the certified dashboard build, pins patched Next.js and PostCSS releases, and synchronizes the location prompt through observable state. The aggregate gate remains unchanged and still requires every prerequisite to succeed. The separate `Playwright QA / test` check remains outside the aggregate job graph by design, so branch protection must continue to require both contexts.
