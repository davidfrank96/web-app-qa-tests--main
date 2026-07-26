# Evidence Management Architecture

Last reviewed: 2026-07-21

## Purpose

Evidence Management preserves the complete output of a campaign as a run-owned aggregate. It supports INSSA today and uses product/environment/campaign identity suitable for Localman, KBean, and future products.

```text
Campaign -> Run -> Evidence Bundle -> Evidence Items -> Reports -> SIEM Export
```

## Models

### Evidence Bundle

One aggregate for one run. It records run/campaign/product/environment identity, bundle type, root path, item count, total bytes, sensitivity, retention class, checksum manifest, local/durable storage state, and upload outcome.

### Evidence Item

One file relative to the Bundle root. It records artifact compatibility identity, type, content type, relative path, size, SHA-256, sensitivity, inline-render policy, retention class, storage key/backend, and upload outcome.

### Artifact Compatibility

Artifact remains the response model for established run/artifact APIs. New evidence metadata is additive. Compatibility APIs and the report archive continue to work without requiring clients to understand Bundle metadata.

## Creation Lifecycle

```text
Worker completes command
-> finalize run-output/<runId>/evidence-manifest.json
-> deterministic artifact indexing
-> replace run artifact metadata
-> build Evidence Bundle and Items
-> replace run evidence metadata
-> upload through configured provider
-> verify size and SHA-256
-> update upload metadata
```

Evidence creation does not change Playwright, campaign scripts, or report generation.

## Run Isolation

Every dashboard-run command receives output variables for a unique `run-output/<runId>/` root. The manifest captures run identity, campaign key, timestamps, and file hashes. Historical dashboard evidence resolves through run-scoped paths, never `latest` aliases.

Shared legacy output roots remain inputs for CLI compatibility and deterministic copying into run output; they are not historical identity.

## Bundle Serving

Playwright is an Evidence Bundle, not one HTML file. Authenticated routes serve bundle-relative HTML, CSS, JavaScript, JSON, images, fonts, attachments, videos, and trace files with appropriate content types.

Security rules:

- resolve the bundle from artifact metadata
- reject arbitrary client filesystem paths
- decode and normalize the relative path
- canonicalize repository root, bundle root, and target with `realpath`
- enforce containment after canonicalization
- reject symlink escape and directories
- redact supported textual output
- require viewer-or-higher authentication

The compatibility endpoint `GET /api/artifacts/:id/file` remains supported.

## Storage

### Local Filesystem

Local run output is runner scratch space, development evidence, and current bundle-serving source.

### Supabase Postgres

Stores metadata only. It does not store report or media bytes.

### Supabase Storage

Stores durable evidence bytes in a private bucket using immutable keys:

```text
<product>/<environment>/<campaignKey>/<runId>/<bundleId>/<relativePath>
```

Uploads use no overwrite. Existing objects are accepted on retry only when downloaded content matches expected size and SHA-256.

If a configured upload fails, local evidence remains available and metadata records failure. There is no silent provider switch.

## Evidence Workspace

The Reports workspace is the Evidence Workspace. It supports bundle search/sort/filter, bundle and item metadata, previews for supported content, Playwright bundle viewing, related artifacts/reports/runs, storage state, integrity state, and the evidence chain.

It does not execute campaigns or mutate evidence.

## Retention

Metadata includes a retention class, but Platform Core v1.0 does not implement retention execution, archive, restore, or deletion. Operators must preserve incomplete uploads and follow deployment storage policy manually.

## Multi-Product Rules

Bundle identity includes product and environment. Product additions must reuse the Bundle/Item/storage/serving contracts. They must not create product-specific evidence tables or public storage buckets.

## Backward Compatibility

These existing APIs remain valid:

- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/artifacts`
- `GET /api/artifacts/:id`
- `GET /api/artifacts/:id/file`

Evidence APIs add:

- `GET /api/runs/:id/evidence`
- `GET /api/artifacts/:id/bundle/*`

## Remaining Approved Work

- retention/archive/deletion engine
- optional direct durable-object serving behind the same auth/RBAC boundary
- historical bundle metadata backfill
- backend migration tooling
- broader multi-product campaigns
