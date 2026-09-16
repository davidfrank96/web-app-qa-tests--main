# Evidence retention safety — policy v3

Policy v3 corrects Wave 4 with longer investigation windows, monthly execution and useful successful-run reports. There is one eligibility engine in `dashboard/lib/inssa-ops/retention.ts`.

| Evidence | Minimum retention |
| --- | --- |
| Clean passed | 30 days |
| Passed with warnings, retried or flaky | 60 days |
| Failed, failed startup, timed out, cancelled | 90 days |
| Security | 90 days |
| Unresolved cleanup | Indefinite |
| Resolved cleanup | Latest resolution + 30 days, or any stronger rule |
| Holds, unknown/incomplete state, review required | Never automatically deleted |

The latest run, bundle, item or Storage timestamp anchors the age. A missing trusted Authentication Monitoring result also requires review, because provider history must survive expiry. Existing review cases are preserved without reconstruction. SIEM metadata, unreferenced Storage objects, campaign runs, logs, audit events, cleanup ledger and monitoring definitions are outside deletion scope.

## Controlled operation

Run from `dashboard` with the existing durable Supabase configuration. Credentials stay on the server.

```sh
npm run retention:execute -- --compare
npm run retention:execute -- --enable-monthly
```

Deploy the v3 migration and app with automatic deletion **disabled**. Review the fresh legacy 21-day comparison and v3 30/60/90-day plan, pass CI and report-usability acceptance, then enable monthly. Enabling is configuration only and must never trigger deletion. Historical v2 tombstones retain their original policy version.

The scheduler and database both accept only `monthly:YYYY-MM` during the **first day of the month, 01:30–01:30:59 Europe/Dublin**. The scheduler process and enabled configuration must predate that occurrence. Starts during or after the minute, delayed loops, missed dates, and deployments never catch up. The next opportunity is the next normal month. The normal 03:00 Safe Suite and 12:00/18:00 Authentication Monitoring schedules are unaffected. An active campaign records a skipped monthly occurrence; it is not retried later that day.

Administrators can use **Dry Run / Refresh** in Operations. **Execute Eligible…** first displays the bounded batch and requires typing `DELETE ELIGIBLE EVIDENCE`, then selecting **Confirm deletion**. A signed five-minute token binds the admin, v3 policy, snapshot revision, exact candidate bundle IDs and one durable manual occurrence. POST requires admin and trusted origin. Changed safety state requires a fresh preview. Execution re-evaluates every bundle and can only shrink the confirmed set. The server CLI also supports an explicit `--execute manual:UNIQUE_ID` operator action; never run it as part of this corrective deployment.

Maintenance runs in the scheduler's background with caught failures and a separate abort signal. It acquires the existing global execution-job mutex as a running job, so the worker cannot claim it or start a competing campaign. The 120-second lease refreshes every 15 seconds. Before irreversible work, ownership must have more than 45 seconds remaining; Storage requests time out after 20 seconds. A crashed occurrence never executes again. Recovery closes it after the lease and a 60-second grace, accounts for absent objects, and leaves remaining objects for a new occurrence.

Each execution is capped at **100 bundles, 5,000 objects and 2,000,000,000 bytes**. Both the executor and database enforce the caps. A bundle that would cross a cap waits for the next monthly occurrence or an explicitly confirmed manual action; no bundle is intentionally split to fit.

## Deletion and history

Every bundle gets a fresh complete snapshot and evaluation immediately before reservation. The reservation checks the snapshot revision under the same transaction lock used by hold, cleanup and evidence safety-state writes. Those writes reject with a retryable conflict while deletion is in progress. This closes the gap between planning and the irreversible Storage request.

The durable intent contains exact object identities and a signature of bundle/item metadata. Only the private `inssa-evidence` bucket is used, with exact-key Storage API removals in batches of at most 100. There is no archive, bucket move or hidden Storage copy. Storage HEAD requests verify absence; the metadata transaction independently verifies that none of the exact keys remain in the Storage inventory. Production SQL never deletes `storage.objects` rows.

Only after verification does one transaction prune unreferenced item/artifact rows and preserve a compact bundle tombstone plus a retention audit. Rare item rows referenced by historical holds remain, with heavy metadata removed. The tombstone keeps run/bundle/campaign IDs, original object/byte counts, policy, plan, reason, deletion time and verification state. Authentication provider summaries move into that tombstone, with obsolete file references removed. Evidence history displays **Evidence expired under retention policy**. Expired runs cannot republish evidence; retained artifact references return HTTP 410.

Partial attempts keep their immutable intent and manifest under `RETENTION_PARTIAL_FAILURE`. The same evaluator accepts an absent key only when the durable intent proves it belongs to the unchanged bundle. It rechecks all current protections, rejects replacement objects, and retries only remaining keys. Unexpected absences without an intent remain review-required.

## Future routine evidence

Playwright retains the existing failure-only trace/video settings and mutation recording. A JSON reporter provides complete attempt results. After the process tree is quiescent, successful Safe Suite and Authentication Monitoring outputs can become a **INVESTIGATION_READY_SUCCESS** structured result JSON, manifest, self-contained investigation HTML report and provider JSON records. The report retains test identity, file/project, environment/campaign/run correlation, timings, warnings, recorded steps, lightweight console/error context and provider outcomes. Its styles are inline and it needs no external or relative asset. Steps not recorded by a producer are identified truthfully. All pre-publication replacement directories are removed after the swap; no duplicate is uploaded.

Reduction requires a complete report, no retries/flakiness/skips, no infrastructure stderr, and no unexpected warnings. The exact recurring hosted npm notice `npm warn config production Use --omit=dev instead.` (with npm's original backtick quoting) is a known configuration deprecation notice, retained in summary metadata; no other stderr notice is exempt. Mutation, cleanup and security campaigns cannot enter this path. The only allowed degraded provider outcomes are Google `blocked_external` and Apple `missing_configuration`, with username/password passed and matching completed Playwright checks. Failed, timed-out, retried, uncertain or unexpected-warning outcomes keep every original diagnostic byte. A small footprint record records the source size and selected reduction mode. Final bundle byte counts include the regenerated manifest.

Existing Wave 4 minimal HTML is presented read-only using its authentic embedded structured results and durable run correlation. It visibly discloses unavailable historical traces/screenshots/steps. Original Storage bytes, hashes and timestamps remain unchanged; no historical test is rerun or deleted evidence fabricated.

All `passed_with_warnings` runs receive 60 days, including known Google/Apple states; those known states alone need no heavy video/trace. New full Playwright result metadata durably records retry/flaky flags, so a retried process with status `passed` still receives 60 days. Invalid diagnostics require review.

## Accounting and health

Each durable occurrence records Storage before/after, reclaimed bytes, deleted objects/bundles, protected/review counts, partial failures and duration. Recovery also accounts for deletions completed before a lost acknowledgement. Admin Operations exposes current storage, last run, last/total reclaimed, next known eligibility and maintenance health. Health states are `HEALTHY`, `SKIPPED_ACTIVE_EXECUTION`, `PARTIAL_FAILURE`, `FAILED`, and `STALE`. An enabled schedule becomes stale ten minutes after a missed monthly occurrence that was enabled beforehand; an expired running lease is also stale. Health exposes the next legitimate monthly timestamp even while disabled. Public health remains unchanged and small.

## Regression coverage

- V1/V2 compatibility and V3 29/30/60/90-day boundaries; security, cleanup, holds, active/unknown state and comparison rejection.
- Fresh-plan hold race, SQL safety gate, lease ownership, exact-key validation and missing/replaced-object rejection.
- Delete → absence verification → atomic pruning, durable tombstones, partial retry and occurrence idempotency.
- Bundle/object/byte caps, Dublin summer/winter and repeated-hour dates, active QA exclusion and normal QA after maintenance.
- Investigation-ready success artifacts with a valid regenerated manifest; exact failed/retried diagnostic preservation; provider history after expiry.
- SQL RLS/RPC permissions, preserved run/audit/cleanup/monitoring records; real browser admin health and expired history without dead links.

The SQL harness uses a disposable localhost database and rolls back every migration and fixture. Fixture-only Storage row removal simulates an external API deletion; it is never part of production code. Release verification lives outside the repository in the retention safety v3 release report, so deployment identifiers and production measurements describe the actual released state.
