# Evidence Storage Guide

## Storage Roles

- Local filesystem: runner scratch space and report-serving compatibility.
- Supabase Postgres: evidence metadata only.
- Supabase Storage: durable evidence bytes.

Binary evidence is never stored in Postgres.

## Bucket

The default bucket is `inssa-evidence`. `npm run persistence:provision` creates the configured bucket idempotently through the Storage API and verifies it is private. This avoids direct writes to Supabase's managed Storage schema.

No anon or authenticated object policy is installed. Upload and verification use the server-only service role.

## Object Identity

```text
inssa/<environment>/<campaignKey>/<runId>/<bundleId>/<relativePath>
```

The run and bundle IDs prevent mutable `latest` paths from becoming historical evidence references. Uploads do not overwrite objects. On retry, an existing key is accepted only after exact size and SHA-256 verification.

## Upload Lifecycle

```text
Run output
-> Evidence Item metadata
-> private object upload
-> object download
-> size verification
-> SHA-256 verification
-> upload metadata marked uploaded
```

The bundle is marked uploaded only after every item verifies. Configuration errors fail closed. Transient Storage failures preserve local evidence, mark upload metadata failed, and emit the existing warning/outbox behavior.

## Retrieval

Current dashboard bundle serving remains filesystem-backed for compatibility. Durable Storage is the persistence copy, not a public CDN and not a browser-direct URL source. Signed URLs and direct Storage serving are outside this release.

## Verification

For a safe test run confirm:

- Bundle `storageBackend` is `supabase-storage`.
- Bundle and items have `uploadStatus=uploaded`.
- `storagePrefix` includes environment, campaign, run, and bundle identity.
- `checksumManifest` matches evidence item SHA-256 values.
- Bucket remains private.
- Dashboard report serving still works through authenticated artifact/bundle routes.

## Recovery

If upload fails, keep `run-output/<runId>/` until evidence is re-uploaded and verified. Do not overwrite or delete an existing durable object to make a retry pass. Retention, archive, and deletion engines are outside this release.
