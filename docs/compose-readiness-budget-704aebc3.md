# Safe Suite compose timing investigation — run 704aebc3

Investigation date: 17 October 2026. Target: `https://staging.inssa.us`.

Release follow-up (17 October 2026): the results below are the preserved pre-release investigation. PR #48 deployed the shared warning helper and landing diagnostics, but excluded the compose changes. This follow-up release layers the remaining compose patch onto `fc1f1a3`, keeps PR #48’s single-click warning helper with its unchanged default three-second budget, and includes both landing and compose fixtures in required CI. Historical “not deployed” and 500ms-default statements below describe the investigation checkpoint, not the release branch. The helper accepts the compose deadline remainder without restoring the old 500ms polling implementation.

**Verdict: targeted QA defects fixed and verified on the existing hosted runner. Final repeated cases 4/4 PASS; full Safe Suite 10/10 PASS, zero retries or skips. Application/platform startup remains slow and is not claimed fixed. No deployment was made.**

This follow-up covers [run 704aebc3-0f92-4da1-8131-37b712b9ae84](https://kbean-qa-webapp-2ok9x.ondigitalocean.app/api/artifacts/f8f3cf6b-7117-4148-93a5-8bceaf62624a/bundle/index.html). It adds a targeted timeout-budget correction to the earlier [readiness investigation](compose-readiness-investigation-2026-10-17.md). The earlier report describes the patch before this budget change.

No INSSA application source, deployment, infrastructure size, spending, mutation safeguard, retry setting, authentication policy or global Playwright timeout was changed. The patch is local; hosted validation uses a disposable private checkout, not the deployed files.

## Evidence and attribution

The deployed Git revision was read directly from the QA container: `6dd624294c2ccc16ebcb4ffa01e1ee1a932ae65f`. Trace-embedded source for the affected specs, compose page object, fixtures, monitor, assertions and write audit matches that baseline. This is not a failure of the uncommitted local patch. The report used one worker and zero retries, as enforced by `scripts/inssa/run-safe-suite.js`, not the global CI defaults.

| Finding | Classification | Evidence and limits |
| --- | --- | --- |
| Direct compose has an inconsistent total budget | QA orchestration — confirmed | Its 30-second budget includes fixture setup and navigation. Media already has 90 seconds and city cases 120 seconds. Timeout teardown starts before Subject finishes; later successful assertions do not undo the timeout. |
| Generic render observation is not functional readiness | QA instrumentation — confirmed | `utils/monitor.ts` accepts body text, an interactive element, a heading or main element. `expectPageNotBlank` also accepts nonempty shell text. Loading/session-warning UI can satisfy these checks. Actual compose assertions are still necessary. |
| Seattle renders after its assertion deadline | Slow initialization — confirmed symptom; application/platform attribution incomplete | The original selector matches the eventual Subject input. The trace records no match within its 15-second poll, then a full form in a later snapshot. This is not evidence of a selector mismatch. |
| Warning dismissal is ordered too late | QA — confirmed ordering weakness, not proven cause of delayed rendering | Original dismissal follows `expectComposeSurface`, so a failure prevents dismissal. The screenshot shows a status banner overlapping the form. Published application source identifies a dismissible notice, not a gate controlling compose rendering. |
| Session restoration and application initialization remain necessary | Application behavior — confirmed; latency contribution not isolated | Prepared state verifies identity/profile and the compose route, not a ready compose form. Each fresh context still initializes the application. Published `ProtectedRoute` waits for authentication, token refresh and profile state. Do not bypass it. |
| CPU pressure, recording or routing overhead causes the delay | Platform — hypotheses requiring controlled telemetry | Normal traces/video and strict request routing remain enabled. Successful HTTP requests do not rule out JS execution, event-loop, rendering or resource delays. The reported near-100% CPU chart is correlation; visible cgroup quota values do not establish actual platform throttling. |

Both failed traces have zero HTTP 4xx/5xx responses and zero uncaught page errors. Their console error is `requestStorageAccess: Permission denied` from reCAPTCHA. That is distinct from the INSSA session-warning banner. Both write-audit summaries record zero blocked unexpected writes; this does not independently prove absence of all backend side effects.

## Hosted trace timeline

Times are seconds relative to browser `page.goto` start. Browser and test-runner traces have separate call accounting; the table uses browser timing except the explicitly identified test teardown. Snapshots are observations, not continuous measurements of the first rendered frame.

| Event | Direct compose | Seattle |
| --- | ---: | ---: |
| Main JS download completes | 1.46 | 0.88 |
| Browser navigation returns | 4.99 | 4.02 |
| Account lookup starts / completes | 9.60 / 10.38 | 9.38 / 9.88 |
| Token refresh starts / completes | 11.61 / 12.31 | 11.38 / 12.27 |
| Subject visibility begins | 23.60 | 15.37 |
| Subject visibility ends | 26.41, success | 30.88, failure |
| First recorded full form snapshot | 27.10 | 31.78 |

For direct compose, test-runner teardown begins at monotonic time `76979.899ms`; the test-runner Subject step finishes at `78098.365ms`. Message, Discard draft, Save & exit, step labels, metadata and error checks finish later while timeout cleanup is already underway. Thus the successful detailed steps are consistent with a failed total test budget. The reported 37.309-second duration includes cleanup.

There is also substantial time inside simple QA/browser operations: direct compose's interactive-element `count()` occupies about 9.70 seconds. This supports investigating browser/runner scheduling or instrumentation, but does not isolate the cause. Seattle's rendered screenshot alone cannot prove the input was ready before the timeout.

## Minimal code changes and budget rationale

- `pages/inssa/time-capsule.page.ts`: one optional shared readiness deadline across the compose assertions; known warning dismissal before readiness and after hydration; unique accessible Subject/Your Message locators; both fields must be editable. Existing route, blank-page, field, action, step-label and required-metadata coverage remains. No field is edited to check readiness.
- `utils/inssa-compose-contract.ts`: Safe Suite compose-readiness budget of 30 seconds and direct/media total budget of 90 seconds. These are specific to safe compose checks, not global settings.
- `utils/inssa-session-warning.ts`: optionally use the caller's remaining readiness budget for polling and clicking. Existing callers retain their 3-second poll / 500ms click defaults. Hosted validation demonstrated that the separate click limit could expire on a visible banner; Safe Suite now shares its single deadline instead. Dismissal must still succeed or the notice must leave the page.
- Direct, city and media specs pass that bounded readiness budget. Only direct compose's total timeout increases (30 to 90 seconds), aligning with the existing safe media audit. Cities remain 120 seconds. Media's total remains 90 seconds.
- City cases use default ordered execution instead of serial failure propagation. Each case gets a fresh context and its own seeded route, so one failure must not skip independent cities. The safe runner remains one worker.
- `dashboard/scripts/test-compose-readiness.ts`, the existing governed-routing fixture, and `package.json`: offline regression coverage and matching accessible labels. Negative tests still reject missing or readonly forms. A controlled fixture verifies that delayed hydration consumes the same deadline rather than granting each control a new timeout.

The 30-second surface budget starts after navigation and the generic render observation. The observed hosted form snapshots occur at 27.1/31.8 seconds from navigation, so the old 15-second field limit can expire during cold initialization. A shared deadline bounds the entire assertion block instead of accumulating a separate extended allowance per control. The total direct budget reserves navigation (existing 20 seconds), readiness (30 seconds), metadata/error assertions and fixture/cleanup accounting, using the existing media-test policy.

This is a **functional deadline**, not a declaration that 30-second initialization is healthy. The existing monitor thresholds remain unchanged: over 5 seconds is slow; over 10 seconds is unstable. Local passing Seattle cases still produce unstable performance reports. No sleeps, test retries, skipped assertions, swallowed live-test errors or forced passes were added. The fixture-only hydration timer is not used in live tests.

## Local validation

Same Mac, staging target, Node 22.23.2, Playwright 1.59.1, Chromium 147, normal trace/video settings, one worker, zero retries. Each run prepares fresh protected authentication state; each case gets a fresh context. Runs were sequential. Network conditions varied, so the timings are not a benchmark of patch performance.

These local live runs preceded the final optional warning-budget correction. The final execution code is validated by the hosted repetitions/full run below and the final offline checks.

| Run | Direct compose | Seattle | Result / suite duration |
| --- | --- | --- | --- |
| Supplied hosted baseline | timeout, 37.309s | failed, 40.413s | 8 passed / 2 failed / 0 skipped; runner 382.240s |
| First local baseline attempt | not started | not started | Sign-in preflight failed after 20.500s; retained separately |
| Patched local, two repetitions | 8.663s / 7.291s | 11.175s / 22.187s | 4 passed / 0 skipped / 0 retries; 64.735s |
| Unchanged local control, two repetitions | 5.554s / 6.471s | 4.914s / 5.456s | 4 passed / 0 skipped / 0 retries; 31.481s |
| Patched supported full suite | 9.444s, passed | 21.605s, passed | 9 passed / 1 navigation failure / 0 skipped; 135.968s |

All six cities executed in the full run: New York 8.360s PASS; Los Angeles 8.282s PASS; Chicago 11.781s PASS; Miami 25.533s FAIL; Austin 11.135s PASS; Seattle 21.605s PASS. Austin and Seattle continued after Miami failed, directly verifying removal of the skip cascade. Media passed in 5.992s; both isolation cases passed.

Miami failed at the unchanged `page.goto(..., waitUntil: 'domcontentloaded')` 20-second navigation limit, **before compose readiness**. Its document returned HTTP 200 in 0.374s, but `/static/js/main.2c673d87.js` took 24.151s (23.918s receiving the response). This is an application-delivery/network symptom; ownership is not isolated. It is not fixed by this QA patch, and the navigation assertion remains intact. A separate uncompressed asset probe also stalled, but is not browser-equivalent and is not used as causal proof.

The initial offline deadline fixture was too tight for Playwright polling (900ms with delayed hydration), and failed waiting for Subject. The fixture budget was corrected to 3000ms, with an assertion that the readonly second field receives only the remainder; the final fixture passed at 3003ms. This changes only the offline test, not live limits. Existing readonly/missing-form negative fixtures fail as expected at approximately 15 seconds. Write-audit, session, service-worker, fresh-auth and governed-routing fixture checks passed.

Local command resource records: repeated baseline 32.06s wall / 16.78s user / 3.56s system; repeated patch 65.19s / 20.05s / 3.99s; full patch 136.58s / 38.43s / 8.08s. Reported maximum RSS was about 344MiB for each command. These are local command accounting, not hosted container/browser CPU telemetry or summed process-tree peak memory.

### Commands and retained evidence

Executed from the repository (baseline command uses a private archive of the exact baseline revision):

```sh
/usr/bin/time -l -o /private/tmp/inssa-compose-investigation/run-704aebc3/after-resources.txt \
  node /private/tmp/inssa-compose-investigation/repeat.cjs after

# The helper creates/deletes private run-owned authentication state and invokes:
npx playwright test tests/inssa/inssa-time-capsule-create.spec.ts \
  tests/inssa/us-compose-location-matrix.spec.ts \
  --grep 'authenticated direct compose|Seattle' \
  --project=inssa-chrome --workers=1 --retries=0 --repeat-each=2

INSSA_RUN_OUTPUT_DIR=/private/tmp/inssa-compose-investigation/run-704aebc3/full-after \
  /usr/bin/time -l -o /private/tmp/inssa-compose-investigation/run-704aebc3/full-after-resources.txt \
  npm run test:inssa:safe

npm run test:inssa:safe:fixtures
node --import ./dashboard/node_modules/tsx/dist/loader.mjs dashboard/scripts/test-compose-readiness.ts
npx tsc --noEmit
npm --prefix dashboard run typecheck
git diff --check
```

Sanitized local results: `output/playwright/compose-readiness-704aebc3/local-summary.json`. Private downloaded report, screenshots, traces, local reports, logs and resource records: `/private/tmp/inssa-compose-investigation/run-704aebc3/`. Authentication-bearing raw traces are not committed.

## Hosted comparison and remaining work

Hosted comparison uses private `/tmp/inssa-704a-qNQGud/checkout`, created from the confirmed deployed revision. Only the QA patch is applied there. The deployed `/workspace` files and service configuration remain unchanged. Host Node is 22.22.2 and Playwright 1.59.1. Before/after affected cases use identical recording/worker settings and fresh session preparation, followed by one supported full Safe Suite. The dashboard run listing showed no active run before starting the comparison.

The hosted baseline reproduced both failures: direct compose timed out in both repetitions (38.412s and 36.283s reported durations); Seattle passed once (33.772s) and failed its original Subject assertion once (38.387s). Result: **1 passed / 3 failed / 0 skipped / 0 retries**, 196.667s Playwright duration. The wrapper recorded 200.056s wall time, 508.9 CPU-seconds of visible cgroup usage and 1,494,335,488 bytes peak sampled visible memory. These counters include other processes visible to the container and cannot isolate browser CPU or prove throttling.

The console exposes cgroup-v1 usage counters, but `cpu.stat` and the process's per-container cgroup paths are unavailable. Root-mounted quota reads `-1`; that is not evidence that the App Platform allocation has no effective CPU limit. Do not infer throttling or recommend a paid resize from those values.

A 5.098-second `/proc` sample during the final hosted suite recorded 6.46 CPU-seconds in `chrome-headless`, 1.37 in `ffmpeg-linux`, and 0.44 in `node`, summed across processes present in both samples. Video encoding therefore has a directly observed CPU cost. This sample does not isolate tracing overhead, browser main-thread work, processes exiting between samples, or provider throttling; it does not establish that recording caused either original failure. Recording settings were retained throughout.

The first patched hosted trial failed all four cases in warning dismissal, before completing compose readiness (direct 34.672s / 33.881s; Seattle 34.398s / 30.335s). Its preserved trace shows the warning poll at 41431–44486ms and a click at 43000–43890ms failing the old 500ms click limit. The click log resolves the correct `Got it` button, then expires waiting for visibility, enabled state and stability. This is a demonstrated QA helper-budget defect, not evidence that the form selector is wrong. Its wrapper measured 185.916s, 487.29 visible CPU-seconds and 1,516,011,520 bytes peak visible memory. The subsequent full trial was deliberately interrupted when this common defect was identified; it is not counted as a passing or completed validation.

The correction gives warning dismissal only the time remaining in the same 30-second compose budget; it does not add another budget or change the other workspaces' default helper limits. A local fixture with delayed button actionability passes, while persistent-warning, readonly and missing-form regressions still fail as intended. The final hosted repetitions (`after-warning`) passed **4/4 with no retries or skips**. SHA-256 hashes of all six hosted execution files match the final local patch. The supported full suite (`full-after-warning`) passed **10/10 with zero retries, failures or skips**.

| Same hosted container, two repetitions | Baseline | Final patch |
| --- | --- | --- |
| Direct compose | 38.412s timeout / 36.283s timeout | 33.811s PASS / 33.046s PASS |
| Seattle | 33.772s PASS / 38.387s Subject failure | 34.910s PASS / 32.691s PASS |
| Playwright duration | 196.667s | 172.128s |
| Wrapper wall / visible cgroup CPU time | 200.056s / 508.90 CPU-s | 175.148s / 458.97 CPU-s |
| Peak sampled visible memory | 1,494,335,488 bytes | 1,510,916,096 bytes |

All four final cases report performance status **unstable**, and all four write audits report zero blocked unexpected writes. Timings include fixture/cleanup costs; failures retain additional artifacts. The reduced aggregate duration is not proof of faster application initialization or reduced CPU throttling.

Final full hosted suite started at `2026-10-17T10:02:53.922Z`; Playwright duration was 346.372s. Wrapper measurements: 349.411s wall, 961.60 visible CPU-seconds, 1,541,644,288 bytes peak sampled visible memory.

| Final hosted case | Result | Duration |
| --- | --- | ---: |
| Isolation 1 / 2 | PASS / PASS | 3.071s / 2.702s |
| Direct compose | PASS | 36.407s |
| Media capabilities, no upload | PASS | 34.571s |
| New York | PASS | 41.678s |
| Los Angeles | PASS | 34.313s |
| Chicago | PASS | 48.721s |
| Miami | PASS | 36.007s |
| Austin | PASS | 34.979s |
| Seattle | PASS | 36.307s |

All six cities actually executed. Every audit reported zero blocked unexpected writes. All eight live compose/media cases still reported **unstable** performance; the two synthetic isolation cases have no performance monitor. No publish, save-draft or upload action was executed. Backend-side product mutations remain labeled `NOT_INDEPENDENTLY_VERIFIED` by the existing audit; this work did not claim an independent backend side-effect audit.

The hosted commands were `node /tmp/inssa-704a-runner.cjs` for the preserved baseline/first trial, followed by `node /tmp/inssa-704a-resume.cjs` for the corrected trial. The latter sequentially invokes the exact filtered Playwright command documented above with `--repeat-each=2`, then `node /tmp/inssa-704a-qNQGud/checkout/scripts/inssa/run-safe-suite.js`. Both use fresh prepared sessions and normal recording settings. The hosted private directory retains per-run `summary.json`, `results.json`, `resources.json`, logs and normal Playwright artifacts. Sanitized measurements are also copied to `output/playwright/compose-readiness-704aebc3/hosted-summary.json` locally. The final execution-file hashes match the local working tree; no tracked source under deployed `/workspace` was changed.

Full offline fixture suite, root TypeScript, dashboard TypeScript and `git diff --check` pass on the final warning correction. The first local full run remains 9/10 because of the independent 24.151-second Miami asset delivery; it is not relabeled green by later results.

## Separate infrastructure/application follow-up

No resize or paid change is recommended from CPU correlation alone. Obtain provider-level CPU allocation/throttling measurements and browser-process CPU during the same one-worker workflow. The available usage counters are insufficient to distinguish quota throttling, normal compute consumption and instrumentation overhead. A controlled trace/video comparison could quantify recording cost, while retaining all write guards and functional assertions.

If the host has headroom, instrument application auth/profile completion, first usable compose controls and main-thread long tasks. Reproduce with fresh prepared sessions using the safe launcher, not an already-initialized normal Chrome tab. The original successful auth requests around 12 seconds followed by form snapshots at 27–32 seconds are the handoff evidence; the unmeasured interval must not be attributed to a particular subsystem without more evidence.

For the separate delivery failure, retain the Miami trace at `full-after/test-results/inssa-us-compose-location--06eff-renders-safely-for-Miami-FL-inssa-chrome/trace.zip` under the private local evidence directory. Repeat the same staging route through the safe launcher and inspect `/static/js/main.2c673d87.js` timing. Ownership may be network, delivery infrastructure or browser scheduling; there is no confirmed INSSA application-code fix in this patch.
