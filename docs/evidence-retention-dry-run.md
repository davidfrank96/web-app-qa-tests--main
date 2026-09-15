# Evidence retention — DRY RUN ONLY

> Historical Wave 3 baseline. Current execution policy and controls: [Wave 4 evidence cost control](evidence-cost-control.md).

Policy version: `evidence-retention-v1`, effective 2026-09-14 UTC. The planner reads QA platform metadata and private `inssa-evidence` Storage inventory. It never invokes product APIs or writes evidence, logs, audit events, cleanup records, notifications or monitoring definitions. It has no deletion executor or schedule.

Run from the repository root with the existing dashboard service environment:

```sh
npm run --silent retention:plan -- --as-of 2026-09-14T22:00:00Z
```

Omit `--as-of` for the current time. Output is JSON on stdout. Environment loading is silent. Exit 1 indicates unavailable data or invalid arguments; exit 2 indicates an unknown policy/hold state or a changing snapshot. Individual ambiguous bundles are reported as `REVIEW_REQUIRED` with reasons. A successful command is a completed assessment, not authorization to delete.

Admins can open **Operations → Evidence retention → Dry Run / Refresh**. There is no automatic retention polling. The authenticated GET uses the existing admin guard and sends `Cache-Control: no-store`. Failed refreshes remove stale results. Non-admins cannot read the endpoint or see the section.

## Rules and dates

| Evidence | Rule |
| --- | --- |
| Passed / passed with warnings | 30 days |
| Failed / failed startup / timed out / cancelled | 90 days |
| Security class on bundle or any item, security campaign, secondary-account/security-sensitive cleanup | At least 90 days |
| Unresolved associated cleanup | Indefinite |
| Resolved associated cleanup | Latest resolution +30 days, or longer explicit `retentionUntil` / failure / security rule |
| Active hold | Indefinite for the whole bundle |
| SIEM metadata | Preserved; no finite expiry in this policy |
| Active/unknown run, unknown classification or relationship, incomplete upload, inconsistent manifest | `REVIEW_REQUIRED`; never eligible |
| Audit events, cleanup ledger, monitoring definitions, logs, notification outbox | Outside the retention target; never pruned |

The age anchor is the latest run creation/completion, bundle creation/index/upload, item creation/upload, or associated Storage object creation/update timestamp. A recent durable publication must not inherit an older expiry. Expiry is inclusive at exactly the configured age. Missing, invalid or future evidence dates require review. Unknown policy versions or unrecognized command snapshots fail closed. The current allowlisted command registry is used only to classify persisted snapshots; commands are never executed.

Cleanup relationships use originating run IDs and typed capsule/media IDs from the durable run cleanup manifest, including resumed objects from earlier runs. Missing associated ledger objects, missing manifests and missing resolution timestamps require review. Filename resemblance alone never establishes a safe cleanup relationship. Explicit holds can cover the entire inventory, one run, bundle, item, or cleanup object. Any item/object hold protects its whole bundle.

## Persistence and read consistency

`retention_policies` is application-read-only; future versions require a forward migration and compatible evaluator. `retention_holds` records immutable provenance and permits only an attributed release. Both tables enable RLS and revoke anon/authenticated access. Service role can select policies and create/release holds, but cannot delete either. Foreign keys restrict deletion of held subjects. Released holds cannot be edited or reactivated; create a new hold instead.

Hold fields are `id`, `scope`, `run_id`, `bundle_id`, `item_id`, `cleanup_ledger_id`, `reason`, `hold_type`, `created_by`, `created_at`, `released_at`, `released_by`, and `status`. Types: `manual`, `security_review`, `incident`, `cleanup`, `compliance`. Exactly the identifier matching the scope is populated; global scope has none. Creation and release use the existing service-role administrative SQL channel, with explicit operator identity/reason. No public hold mutation endpoint or additional UI action is exposed in Wave 3. A currently active hold protects even a historical asOf; a release after asOf also remains protective for that historical assessment. Historical plans must retain their original snapshot and policy to reproduce them after later data changes.

`retention_read_page` and `retention_read_manifest` are STABLE, security-invoker RPCs with empty search paths, service-only execution and a fixed resource/bucket allowlist. The HTTP client exposes only GETs to these two RPCs. JSON envelopes page 500 records at a time beyond PostgREST's 1,000-row cap. Counts, unique identities, page lengths, and before/after content fingerprints detect truncation or concurrent changes. Any detected change blocks eligibility for the entire snapshot. Reads do not materialize a plan in the database.

The plan ID hashes canonical sorted decisions, summary, policy, normalized asOf and snapshot revision. Repeated reads with the same snapshot/asOf/policy yield the same ID. A new upload or hold intentionally changes the result. Storage inventory checks object existence, unique references and declared sizes; this assessment does not download and rehash all historical object bytes. No plan is deletion-certified.

`eligible`, `protected`, and `review required` bundle counts are mutually exclusive. Failure/security/cleanup/hold breakdowns can overlap, including protective rules on review-required bundles. Eligible bytes estimate complete-bundle reclaimable storage. Protected and review-required bytes are reported separately, including declared local-only evidence; total Storage bytes come from bucket inventory. Unreferenced objects and orphan item counts are visible but are never deletion candidates.

## Historical comparison and release

The September baseline at `2026-09-14T11:34:00Z` projected 14 routine-success bundles, 643 objects and 129,631,709 bytes by age only. Its hold state was unknown. Compare actual candidate IDs and reasons against `docs/platform-stabilization-measurements-2026-09.json`; do not force a count of 14. Later runs, age boundaries, upload timestamps, holds and stronger integrity checks can change the result. The four historical unreferenced Storage objects remain preserved.

Release requires the retention tests, SQL/RLS/read-only pagination checks, actual admin UI checks, full platform/evidence/security suites, Safe Suite, TypeScript, production build, Runtime Doctor, audits, secret scan and clean diff. Both QA Enforcement and Playwright QA must pass on the PR before merging. Deploy only `kbean-qa-webapp`, then archive the production metadata plan and zero-deletion verification outside runtime data.
