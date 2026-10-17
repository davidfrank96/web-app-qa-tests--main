# INSSA compose failure investigation — 17 October 2026

Historical checkpoint: this report predates the targeted budget change for [run 704aebc3](compose-readiness-budget-704aebc3.md). Its no-timeout-change statement describes the earlier patch only; see the follow-up for current validation and remaining issues.

Status: **test defects corrected and locally verified; hosted initialization delay remains unresolved.**

Do not interpret the local green run as a fix for the application/platform latency. No timeout, retry, write guard, authentication policy, campaign, or deployment configuration was relaxed. No application deployment was made.

## Evidence and reproduction configuration

- Original run: `1248b09b-8cdc-4480-8629-225e6aa793ac`, [original report](https://kbean-qa-webapp-2ok9x.ondigitalocean.app/api/artifacts/04068c4f-5219-49c6-967a-913b79acb8a5/bundle/index.html).
- Unchanged hosted reproduction: `67163e92-abec-4b57-ab40-2162f1e4791a`, [reproduction report](https://kbean-qa-webapp-2ok9x.ondigitalocean.app/api/artifacts/0ae9e66c-823c-47a6-88d2-3317ceb023a1/bundle/index.html).
- Baseline repository/deployment commit: `6dd624294c2ccc16ebcb4ffa01e1ee1a932ae65f`; DigitalOcean deployment `6da6f815-8192-4073-be85-87cd2a8a81f2`. Trace-embedded versions of both tests, page object, fixtures, authentication helpers, monitor, assertions and warning helper match the checkout byte-for-byte.
- Target: `https://staging.inssa.us`; Desktop Chrome, Chromium 147, Playwright 1.59.1, 1280×720. The original host is Linux; the local comparison is macOS, Node 22.23.2, 10 logical CPUs, 16 GiB RAM. These are different resource environments.
- Every live run used **one worker, zero retries, fresh run-owned authentication state**, fresh browser contexts per test, normal service workers and the existing strict product-write guard. Local diagnostics retained traces for passing tests too. The hosted reproduction used the normal Safe Suite API and runner, including its normal recording settings.
- `run-safe-suite.js` overrides the global CI worker/retry defaults. The failed report did **not** run two workers. Campaign timeout is 25 minutes; individual direct test timeout is 30 seconds; city timeout is 120 seconds; Subject visibility timeout is 15 seconds; navigation timeout is 20 seconds.
- Raw reports/traces are private because traces contain authentication state. Sanitized local timings: `output/playwright/compose-readiness/sanitized-results.json`. Raw diagnostic files are not included in this patch.

## Findings and classification

| Finding | Classification | Evidence / confidence |
| --- | --- | --- |
| Four cities never ran because Los Angeles failed first in a serial group | Test — confirmed | Original Chicago, Miami, Austin and Seattle results are skipped, 0 ms, no worker execution. Each city has a fresh isolated context and no dependency on another city's product data. |
| Generic navigation readiness accepts a spinner, notice, main element or any body text | Test — confirmed limitation | `waitForMeaningfulRender` and `expectPageNotBlank` establish shell activity, not a usable compose form. A `renderObserved: true` log is not compose readiness. Subsequent field assertions correctly failed rather than producing a false pass. |
| First text input / first textarea selectors are structurally fragile | Test — confirmed weakness, **not established failure cause** | Actual rendered controls have accessible names `Subject*` and `Your Message*`. Original failures report missing elements, not selection of a wrong hidden input. Replacing selectors does not explain delayed rendering. |
| Warning dismissal followed the assertion that could fail | Test — confirmed ordering defect | The failing call prevented dismissal. It is now handled before readiness and again after hydration. |
| Warning prevents form initialization | **Not supported** | Published application source map shows `LimitedSessionNotice` is a conditional status Snackbar. Dismissal changes local component/sessionStorage state only. It is not a prerequisite for rendering the form. It can cover the Subject field's center, but an overlay does not by itself explain an element-not-found visibility assertion. |
| `requestStorageAccess: Permission denied` causes app failure | **Not supported** | Original console error originates in Google's reCAPTCHA iframe. It is distinct from INSSA's capability-based privacy notice. No corresponding failed authentication response or uncaught application exception was established. |
| Compose is gated on remote authentication/profile initialization | Application — confirmed implementation, contribution not fully measured | Published `ProtectedRoute` waits for auth, `getIdTokenResult(true)` and the user-profile subscription before rendering children, even on `/timecapsule` with no `requiredRoles` prop. Auth HTTP requests succeeded; the source and trace do not isolate how much remaining delay is React/JS execution, subscription delivery or host scheduling. Do not bypass this gate in tests. |
| Hosted compose has intermittent delayed initialization | Application/platform boundary — confirmed symptom; attribution incomplete | The unchanged hosted rerun passed direct and Los Angeles, then failed Miami with the same 15-second missing-Subject assertion. Local unchanged and patched runs both pass when network conditions are healthy. This is not a city-specific contract failure. |
| Host CPU throttling or recording overhead is the root cause | Platform — hypothesis, not proven | Hosted fixture isolation takes 3.9–4.6 s versus 0.15–0.19 s locally; even simple DOM operations take seconds in original traces. These support investigating overhead, but no host CPU quota/throttling sample or controlled recording comparison was obtained. Parent Node `process.resourceUsage()` excludes Chromium and is not proof of browser CPU utilization. |
| Local baseline suite had slow/stalled asset delivery | Network/application delivery — confirmed for that run; ownership unknown | Media and New York failed navigation at 20 s, not Subject readiness. Their main JS request remained incomplete. Direct main JS took 10.148 s; later document connection/TLS establishment took seconds. This is a different failure from the original hosted report and cannot be attributed to shared test state without further evidence. |

## Original timeline

Times below are relative to each `page.goto` start, from trace monotonic timestamps. Snapshots are bounds, not continuous DOM measurements; snapshots and screenshots after cancellation do not prove timely readiness.

| Event | Direct compose | Los Angeles |
| --- | ---: | ---: |
| Document HTTP response completes | ~0.30 s | ~0.20 s |
| Initial main JS download completes | ~0.85 s | ~0.65 s |
| `goto(...domcontentloaded)` returns | 4.04 s | 4.21 s |
| Generic meaningful-render check returns | 6.62 s | 6.69 s |
| Account lookup begins / completes | 8.69 / 9.57 s | 8.69 / 9.27 s |
| Forced token refresh begins / completes | 10.90 / 11.49 s | 11.20 / 12.09 s |
| Subject assertion starts | 15.50 s | 10.00 s |
| Subject assertion finishes | 28.21 s, success recorded after overall cancellation began | 26.28 s, assertion failed |
| First subsequent snapshot containing Subject | 28.90 s | 27.50 s |

Direct compose's 30-second test budget includes fixtures: teardown started about 26.59 s after navigation began, before the Subject assertion finished. Its reported 37.322 s includes teardown. Los Angeles's 15-second assertion took about 16.286 s of wall time. Successful screenshot capture later is not evidence that either deadline was met.

The hosted rerun failed Miami similarly: initial main JS completed in about 0.95 s from navigation start, account lookup completed around 9.77 s, token refresh around 12.39 s, and Subject failed around 25.09 s. This reproduces delayed readiness without a slow first JS download.

The app bundle stayed `main.2c673d87.js` across the inspected original and reproduction traces. Read-only published source-map inspection was possible; an editable INSSA application checkout was not available in the connected projects.

## Changes

- `pages/inssa/time-capsule.page.ts`: use unique accessible textbox names, retain all existing assertions, require both fields to be editable, and centralize early/late warning dismissal. No values are edited to test readiness.
- `tests/inssa/us-compose-location-matrix.spec.ts`: replace serial mode with default ordering. Each case remains isolated; a failure no longer automatically skips later cities. Safe Suite remains one worker.
- Direct-compose, city and media specs: remove redundant late-only warning calls now owned by the page object.
- `dashboard/scripts/test-compose-readiness.ts`: local-only regression scenarios cover an unrelated text-input decoy, an early notice, a notice arriving with hydration after the first check, a readonly Subject, and a permanently missing form. Negative cases must still fail at the existing 15-second assertion boundary.
- `dashboard/scripts/test-governed-home-bury.ts`: make the synthetic form's labels match the actual accessible application controls. No live lifecycle execution was performed.
- `package.json`: include the new regression in the existing Safe Suite fixture CI command.

## Results

Reported durations include Playwright fixture/teardown accounting; suite durations include fresh authentication setup. Do not interpret differences between runs as patch performance gains.

| Run | Direct | Los Angeles | Whole result |
| --- | ---: | ---: | --- |
| Original hosted | timeout, 37.322 s | failed, 36.303 s | 4 passed / 2 failed / 4 skipped |
| Unchanged local, isolated | passed, 8.211 s | passed, 11.980 s | each 1 passed |
| Unchanged local suite during network slowdown | passed, 19.183 s | skipped | 3 passed / 2 navigation failures / 5 skipped; 107.865 s |
| Unchanged hosted rerun | passed, 30.999 s | passed, 37.782 s | 7 passed / Miami failed / 2 skipped; 263.994 s runner duration |
| Patched local suite | passed, 3.528 s | passed, 3.541 s | **10 passed / 0 failed / 0 skipped**, 39.066 s |
| Patched local, isolated | passed, 3.561 s | passed, 4.731 s | each 1 passed |
| Unchanged local control repeated after network recovery | passed, 4.357 s | passed, 4.951 s | **10 passed / 0 failed / 0 skipped**, 44.943 s |

All four originally skipped cases actually executed in the patched live suite:

| City | Result | Duration |
| --- | --- | ---: |
| Chicago | passed | 3.553 s |
| Miami | passed | 3.593 s |
| Austin | passed | 4.538 s |
| Seattle | passed | 4.582 s |

Root and dashboard TypeScript checks pass. Safe Suite write-audit, session-warning, service-worker guard, fresh-auth and governed-routing fixture regressions pass. New readiness fixtures pass; readonly and absent forms still fail at approximately 15 seconds. No retries were used in live comparisons.

No save-draft, publish, upload or final capsule-creation action was executed. The strict audit reported zero blocked unexpected writes in the patched live suite. Normal allowed account/session initialization still occurred. The existing guard labels backend product mutation status `NOT_INDEPENDENTLY_VERIFIED`; this investigation did not independently audit all backend side effects.

## Remaining issue and next discriminating measurement

Reproduce through `npm run test:inssa:safe` on the existing QA host. On the unchanged deployment this produced a missing-Subject timeout in Miami on 17 October at approximately 09:11 UTC, with auth responses successful and the form rendered later. It is intermittent; a single green rerun does not close it.

The Chrome extension connection failed, and native Chrome could read DigitalOcean's signed-in app/Console but could not deliver terminal input. Consequently no isolated hosted run, cgroup CPU throttling measurement, or hosted run of this patch was completed. No host size change is justified from the available evidence.

Next: capture `cpu.max`, before/after `cpu.stat` deltas, memory limits/events and browser process CPU during one isolated hosted compose test and the normal one-worker suite, while recording client first-form timing/long tasks and auth/profile completion. Compare the same recording configuration first. If the host has headroom, profile `ProtectedRoute` and compose rendering in the application repository. If the container is throttled, address runner capacity/isolation and remeasure before proposing a timeout change. Preserve the same assertions and non-destructive scope.

**Release claim:** the skip cascade and test readiness weaknesses are fixed locally. The underlying hosted initialization failure is not claimed fixed, and this patch has not been deployed.
