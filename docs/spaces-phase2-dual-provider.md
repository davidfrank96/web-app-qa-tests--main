# Phase 2: dual evidence providers

Scope: implementation and verification only. Branch `storage/spaces-dual-provider`. No live deployment, live SQL migration, write-provider cutover, historical migration, retention execution, Supabase object deletion, new resource, or live environment-variable change.

## Architecture and compatibility

The existing evidence pipeline remains authoritative: `evidence.ts` builds run-owned manifests; `evidence-storage.ts` uploads and SHA-256 verifies all objects before `run-store.ts` publishes the complete manifest via `publish_inssa_evidence`. `evidence-integrity.ts` guards both first publication and replacement. Failed/partial uploads never advertise uploaded items; immutable keys allow verified retries.

`storage-provider-model.ts` defines `local | supabase | spaces`, with the existing persisted `local-filesystem | supabase-storage` identifiers retained. Both durable adapters implement put, streamed get, head, exists, exact-key delete, short-lived signed access, and bounded prefix listing. New writes record the bucket on bundle and items. Legacy NULL bucket means the original `inssa-evidence` bucket, independently of the current write setting. Unknown backends and incomplete Spaces locations fail closed. An uploaded object's recorded location wins over the active write selector, including an idempotent publication retry. There is no dual write or provider fallback.

The canonical server-only configuration is `INSSA_EVIDENCE_STORAGE_PROVIDER`, `INSSA_EVIDENCE_SUPABASE_BUCKET`, `DO_SPACES_REGION`, `DO_SPACES_ENDPOINT`, `DO_SPACES_BUCKET`, `DO_SPACES_ACCESS_KEY_ID`, and `DO_SPACES_SECRET_ACCESS_KEY`. Spaces credentials alone never activate Spaces. Existing unconfigured local development remains local. Live and canonical local configuration remain explicitly `supabase`.

Spaces uses pinned AWS SDK packages, SigV4, private ACL, conditional immutable puts, SHA-256 object metadata, and bounded requests/retries. Only the configured regional DigitalOcean endpoint and bucket are accepted. Supabase keeps private-bucket checks and immutable uploads. HTTP 400 absence requires confirmation of Supabase's specific object-not-found error; credential and bucket errors cannot certify absence.

## Retrieval, authorization, and memory

The existing artifact file and bundle APIs retain the authenticated viewer boundary, expired-evidence response, path restrictions, MIME mapping, redaction, and relative report paths. `findUploadedEvidenceItem` and durable download resolve the recorded backend. HTML/JSON use the existing verified-buffer transformation path. Durable binary responses spool to a private temporary file, verify the complete size and SHA-256, then stream the requested full or single-range response. Files are removed on completion/cancellation/error. This bounds binary RAM use, but a range request still reads the complete source object before serving bytes and consumes temporary disk up to that object's size. Phase 3 must assess disk capacity/concurrency and representative large-video seek latency.

The approved Authentication Monitoring change is limited to its result-file reader's durable-provider predicate. Monitor methods, interpretation, schedules, credentials, alerts, and mutation controls are unchanged. Existing metadata projections and tombstone summaries remain authoritative.

## Retention engine

Policy remains evidence-retention-v3: routine 30 days, warning/retry 60 days, failure/security 90 days, existing holds and cleanup windows. Local evidence remains review-required rather than deletable.

Inventory, reference counting, pending intents and retries use provider + bucket + full key. Supabase inventory remains the SQL `storage.objects` inventory. Spaces inventory is loaded only when Spaces bundles exist; it is bounded at 5,000 objects and fails closed on overflow/incomplete pagination. A failed inventory cannot produce a certified deletion plan. Orphans are counted but never deleted automatically.

The unchanged eligibility engine still gates terminal runs, holds, unresolved cleanup, diagnostics, immutable manifests and policy. Shared execution ownership, transaction locks, safety gates and budgets remain. Spaces reservation binds ETag, hash, size, bucket and key to evidence metadata. Before each delete the executor rechecks ownership, HEAD identity and the full SHA-256. Each delete request is bounded to 20 seconds. Settlement requires fresh, service-role-only absence attestations for the exact intent. PostgreSQL cannot independently query S3; this trust boundary is explicit. Supabase retains its independent SQL inventory verification.

Partial deletion preserves metadata and intent; only independently verified missing objects are counted. Retry re-evaluates protections and deletes remaining exact keys. Stale Spaces owner recovery conservatively counts zero because Supabase inventory cannot prove Spaces absence; the durable expected-object intent survives. This can undercount bytes removed by a crashed owner, but never claims unverified deletion. Tombstones preserve provider/bucket, original counts, policy and summaries. Legacy RPCs reject Spaces bundles, preventing older workers from applying Supabase absence logic to them.

Legacy occurrence `storage_bytes_before/after` fields continue to describe Supabase inventory. Provider-aware totals are available through the explicit read-only diagnostics script. No new polling schedule or recurring full inventory scan is introduced.

## Local commands

Run from `dashboard/`:

- `node --import tsx scripts/test-spaces-adapter.ts --isolated-canary`: the explicit five-object real Spaces fixture; only deletes exact keys under its fresh UUID prefix.
- `node --import tsx scripts/verify-historical-evidence.ts --read-only`: five representative historical Supabase reads, verified against existing hashes.
- `node --import tsx scripts/evidence-storage-diagnostics.ts --read-only`: bounded manual provider counts/bytes and active configuration; migration metrics are explicitly unavailable until a migration ledger exists.

CI includes the shared provider contract, failure, relative-asset, range, authorization, partial-publication, retention dispatch/retry tests and both providers' atomic SQL publication tests. The real Spaces canary is deliberately not part of CI.

## Verified live probes (2026-09-29)

Real Spaces prefix: `phase2-adapter-test/6312406d-be00-4385-8905-a6ceec0eb322/`. Five objects (129-byte HTML, 43-byte JS, 17-byte CSS, 15-byte JSON, 68-byte PNG) passed PUT, HEAD size/MIME/hash, streamed SHA-256 read, signed read, anonymous 403, immutable overwrite rejection and nested path preservation. All exact fixtures were deleted; prefix and entire bucket returned zero objects. CDN/public configuration was not changed.

Historical read-only checks passed: report item `3230fafe-5de6-409f-8b88-c83970d5570f`, JSON `def7d44a-4878-4179-92fc-bc69e4a283dd`, screenshot `bbef7f4a-7f42-4a65-972f-6e2cb4c29e94`, video `5b774649-34b5-4a8a-a6ac-2ba44c6e962c`, nested trace `474750f2-29e6-4060-9839-5db7f92a2bcc`. All matched stored size and SHA-256. This is representative sampling, not a re-download of all 4,461 objects.

Supabase inventory remained **4,461 objects / 949,533,725 bytes**, with 170 bundles, 42 expired tombstones and 4,990 evidence items. No historical objects or metadata were changed by these probes.

## Local validation

- Root and dashboard TypeScript: PASS.
- Platform dashboard suite: 196/196 PASS, including new provider/failure, retention and approved monitoring-reader cases; authentication policy/configuration tests also PASS.
- Ingestion/SIEM security: 5/5 PASS.
- Local PostgreSQL: evidence, retention v1/v2/v3 + Spaces, atomic publication for both providers, quota and alert regression fixtures PASS. All retention/migration fixtures roll back; no live migration ran.
- Production build and Runtime Doctor: PASS.
- Root and dashboard full dependency audits: zero vulnerabilities.
- Secret scan and `git diff --check`: PASS. Actual Spaces credentials are absent from browser build output; `.env.local` remains ignored and mode 0600.
- Safe/CI discovery: 15 tests; authentication-monitor discovery only. No evidence-producing live campaign was launched.
- Manual diagnostics: consistent snapshot, Supabase 4,461 objects / 949,533,725 bytes, Spaces 0 objects / 0 bytes, active writes Supabase.
- GitHub workflow conclusions are recorded on the PR for its final head SHA; local checks alone do not certify CI.

## Phase 3 ordering and rollback (requires separate authorization)

1. Review this PR and migration before merging. Main may auto-deploy, so **do not merge in Phase 2**.
2. Apply `20260929153618_spaces_dual_provider.sql` before deploying code that serializes `storage_bucket`. It is additive, extends constraints, preserves NULL legacy buckets, and performs no historical rewrite or object deletion.
3. Deploy the dual-provider code while keeping writes on Supabase. Verify old reports, private retrieval and retention dry-run first. Add Spaces secrets only when separately authorized.
4. Run an explicitly scoped new-evidence Spaces canary, verify every relative asset and fresh authenticated retrieval, then review before wider activation. No historical migration is implicit in a write-provider change.
5. Roll back new writes by setting the write selector to Supabase. Keep dual-provider readers and the additive schema whenever any Spaces metadata exists. Never roll back to a Supabase-only binary after Spaces evidence has been published. If deployment fails before any Spaces writes, the prior binary can run with the additive schema left in place. Do not reverse-migrate or delete either provider's bytes as part of rollback.

## Future historical migration design — not implemented or executed

Use a separate durable migration ledger keyed by bundle/item and source identity, recording source/destination provider, bucket, key, SHA-256, size, status, attempts and sanitized errors. Support bounded batches, stable cursor, dry-run, verification-only, resume, failed-item retry and already-migrated detection. Acquire compatible publication/retention ownership; re-read holds and source manifest before each commit.

For each item: read the recorded Supabase source, stream/hash against existing metadata, conditionally upload the same logical key to Spaces, then independently read/hash and size-check the destination. A conflict is reusable only after full verification. Record verified progress so a crash never duplicates metadata or loses the source. Only after every bundle item verifies should a dedicated compare-and-swap migration RPC atomically switch provider/bucket for the complete bundle and items, conditional on unchanged source identity, checksum manifest, holds and retention state. Ordinary publication intentionally forbids changing an uploaded provider; do not weaken that guarantee for migration.

After the switch, re-read through the authenticated QA proxy, including nested assets and ranges. Only then mark the old source copy eligible for a separately approved deletion process. Keep source copies through a review window, with a verified rollback location recorded. Object deletion, source expiry, concurrent new evidence and partial failure all require truthful ledger states; never infer success from an empty list or a failed read.
