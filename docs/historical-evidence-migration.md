# Historical evidence migration: copy, verify, preserve

The operator CLI moves complete, healthy historical bundles from Supabase Storage to private DigitalOcean Spaces. New evidence remains on Spaces. Supabase remains the metadata and authentication provider, and both historical readers remain enabled.

This release has **no source deletion operation**. Preserved Supabase objects are rollback material. Phase 5B and source deletion require separate authorization.

## Release order

1. Keep the PR draft until local checks, SQL and rollback review, QA Enforcement, and Playwright QA pass.
2. Apply `20260929221111_historical_evidence_migration.sql`. It only adds infrastructure; it does not rewrite historical evidence or change retention settings.
3. Verify the existing deployed application remains healthy and can retrieve both providers.
4. Merge and deploy only `kbean-qa-webapp`.
5. Run the hosted dry run, select one tiny healthy historical bundle, pause after copying, then certify its atomic cutover. A second canary is optional. Stop after Phase 5A.

## Operator commands

Run from the deployed repository with its existing server environment. Credentials must never be passed on the command line. Each command defaults to at most 600 seconds, sequential object processing, and a 25 MiB byte bound.

```sh
npm --prefix dashboard run evidence:migrate:spaces -- --dry-run --limit 5 --max-bytes 26214400
npm --prefix dashboard run evidence:migrate:spaces -- --bundle BUNDLE_UUID --status
npm --prefix dashboard run evidence:migrate:spaces -- --bundle BUNDLE_UUID --execute --copy-only --max-bytes 2097152 --confirm COPY_VERIFY_PRESERVE_SOURCE
npm --prefix dashboard run evidence:migrate:spaces -- --bundle BUNDLE_UUID --verify-only --max-bytes 2097152
npm --prefix dashboard run evidence:migrate:spaces -- --bundle BUNDLE_UUID --execute --resume --max-bytes 2097152 --confirm COPY_VERIFY_PRESERVE_SOURCE
```

Dry run reports metadata eligibility, not a false claim of object integrity. Execution hashes the complete source before its first put. Before cutover, independently verify that hosted retrieval still uses Supabase while the ledger is `DESTINATION_VERIFIED`. After cutover, verify hosted report/nested asset/binary access, refresh, and fresh login; reverify preserved sources and compare inventories.

For future separately authorized batches, `--execute --limit N --after UUID --max-bytes N --time-limit SECONDS --confirm COPY_VERIFY_PRESERVE_SOURCE` processes a stable UUID page sequentially. It skips protected or already-planned bundles, stops at the cumulative byte/time bound or first error, and prints the current bundle and last completed cursor. Resume an interrupted bundle explicitly with `--bundle ... --resume`; then continue the page after that bundle. An empty invocation is a read-only dry run. Batch capability is not permission to run Phase 5B.

## Durable state and integrity

One ledger row per bundle stores the exact source bundle/items/run snapshot, PostgreSQL SHA-256 signature, expected destination snapshot, counts/bytes, proof, timestamps, attempts, owner/120-second lease, sanitized errors, and transition history. Destination keys exactly reuse source logical keys, preserving nested assets and MIME types. There is no random key generation and no local-file fallback.

Each source GET is streamed with a strict expected-size bound, SHA-256 validation, and HEAD-before/after consistency. The complete source is verified before any copy. Each conditional Spaces put uses `If-None-Match: *`; existing objects are independently read and must match the exact expected key, size, MIME, digest, and recorded metadata digest. Extra prefix keys block migration. Source and destination are fully re-read before the proof is accepted. Object buffers and bundle size are capped at 25 MiB; concurrency is one, with abortable requests and body reads.

Supabase reads request identity encoding so CDN compression does not obscure the original byte length. Its adapter cross-checks HEAD size/ETag against the authenticated object-info API and uses the stored MIME type. This is necessary because [Supabase serves HTML as plain text for security](https://supabase.com/docs/guides/storage/quickstart); a delivery header is not the original object MIME. Conflicting metadata still fails closed.

`PLANNED → COPYING → DESTINATION_VERIFIED → METADATA_SWITCHED → SOURCE_PRESERVED` is the successful path. Explicit blocked/failure states preserve the ledger and all copies. A crash at any checkpoint resumes by checking durable state and re-verifying object contents. A lost CAS response cannot reverse the committed switch or produce duplicate logical evidence. Operator retries require `--resume`.

Only service-role callers can access the ledger or migration RPCs. PostgreSQL verifies complete proof identity/freshness against the immutable snapshot; the trusted server process verifies actual object bytes. No browser user or anonymous role can submit migration proofs. The ledger contains object identities and hashes, never credentials or signed URLs.

## Transaction and retention boundaries

The dedicated migration RPC uses the existing retention safety advisory lock, then the bundle and ledger rows. It rechecks the exact snapshot, healthy terminal run, holds, cleanup dependencies, retention intents, v3 policy, manifest, item count, total bytes, and destination proof before one atomic update. Only provider/bucket fields change because keys/prefixes are identical. IDs, artifacts, timestamps, hashes, manifests, and retention classes do not change.

Ordinary `publish_inssa_evidence` is unchanged and still rejects provider changes on uploaded evidence. Row guards block evidence mutation while migration is unfinished, prevent ordinary provider rewrites afterward, and reject retention reservations during migration or a live migration lease. Hold/run/cleanup changes and CAS share the existing statement-level mutex. CAS deliberately does not take a run row lock: ordinary publication takes that row before the mutex, so reversing that order would deadlock.

After `SOURCE_PRESERVED` and lease release, the current Spaces bundle can follow normal retention policy. Preserved Supabase keys remain attributed to the ledger as `MIGRATION_SOURCE_PRESERVED`, including after a later destination tombstone. Partial or rolled-back Spaces copies are attributed as migration destinations. Neither set is an orphan. The retention manifest revision includes ledger changes. No retention policy, schedule, destructive execution, or global disable is introduced.

## Rollback

```sh
npm --prefix dashboard run evidence:migrate:spaces -- --bundle BUNDLE_UUID --execute --resume --rollback --confirm ROLLBACK_METADATA_PRESERVE_BOTH
```

Rollback is explicit and metadata-only. It rechecks the original complete Supabase objects and current Spaces objects, proof freshness, current destination snapshot, and protection state before restoring the exact source provider/bucket values (including historical null bucket fields). Both copies remain. A changed source, missing destination, hold, retention intent, or changed metadata blocks rollback. Live back-and-forth switching is unnecessary; rollback is tested in isolated fixtures.

## Validation

Migration tests cover partial multi-object resume, nested PNG/video keys and MIME, hash/size/MIME conflicts, missing source/destination, source changes, extra prefix keys, independent destination GETs, bounded streams, wrong provider/bucket, copy-only, repeated execution, lost responses at every checkpoint, preservation attribution, verify-only, and rollback refusal/restoration.

The disposable PostgreSQL suite verifies private grants/RLS, stable identities, proof mismatch, expired owners, hold/run changes before CAS, exact atomic switch/rollback, and unchanged ordinary publication. A separate real-connection suite tests simultaneous claims, a committed hold racing CAS, retention reservation exclusion, and the publication/CAS lock order. Existing provider range/streaming, publication, retention, security, auth, platform, TypeScript, build, doctor, dependency, and secret checks remain required.
