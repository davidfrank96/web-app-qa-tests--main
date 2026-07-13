# Evidence Management Architecture

Last updated: 2026-07-13

This document defines the Evidence Management foundation for the QA Operations Platform.

The platform architecture remains:

```text
Playwright Tests
↓
Campaign Runners
↓
Evidence Bundles
↓
Reports
↓
SIEM Export
↓
Wazuh
↓
Dashboard
```

## Purpose

Evidence Management makes evidence the durable platform object.

Reports are derived views. Existing artifact records remain available as a backward-compatible projection.

The current implementation includes metadata, bundle-aware serving, and durable storage upload. It does not change test execution, campaign scripts, Playwright behavior, report generation, SIEM export, Wazuh integration, authentication, authorization, or UI behavior.

## Evidence Bundle

An Evidence Bundle is the logical evidence set produced by one run.

Examples:

- Safe suite Playwright evidence.
- Security campaign evidence.
- Security verification evidence.
- Artifact validation evidence.
- Lifecycle report rendering evidence.
- SIEM export evidence.
- Platform healthcheck evidence.

Current bundle fields include:

- `id`
- `runId`
- `campaignKey`
- `product`
- `environment`
- `bundleType`
- `title`
- `status`
- `rootPath`
- `storageBackend`
- `storagePrefix`
- `uploadStatus`
- `uploadedAt`
- `uploadError`
- `createdAt`
- `indexedAt`
- `itemCount`
- `totalBytes`
- `retentionClass`
- `sensitive`
- `sourceArtifactId`
- `checksumManifest`

Current bundle status:

- `indexed`

Current storage backend:

- `local-filesystem`
- `supabase-storage`

The local filesystem remains the runner scratch space. Supabase Storage is the durable evidence store when `INSSA_EVIDENCE_STORAGE_PROVIDER=supabase` is configured.

## Evidence Item

An Evidence Item is one file or evidence object inside an Evidence Bundle.

Examples:

- Playwright report HTML.
- Playwright report data file.
- Screenshot.
- Video.
- Trace ZIP.
- Error context Markdown.
- Security JSON.
- Lifecycle JSON.
- Rendered security report.
- Rendered lifecycle report.
- SIEM export JSON.

Current item fields include:

- `id`
- `bundleId`
- `runId`
- `campaignKey`
- `artifactId`
- `itemType`
- `fileName`
- `relativePath`
- `storageKey`
- `contentType`
- `sizeBytes`
- `sha256`
- `sensitive`
- `renderInline`
- `retentionClass`
- `storageBackend`
- `uploadStatus`
- `uploadedAt`
- `uploadError`
- `createdAt`
- `metadata`

Each Evidence Item references the compatibility artifact it was derived from through `artifactId`.

## Bundle Lifecycle

Current lifecycle:

```text
Run completes
↓
Existing artifact indexer scans known roots
↓
Compatibility Artifact records are persisted
↓
Evidence Bundle metadata is derived from those artifacts
↓
Evidence Item metadata is derived from those artifacts
↓
Successful runs upload Evidence Items to durable storage when configured
↓
Upload size and SHA-256 integrity are verified
↓
Evidence Bundle and Evidence Item metadata are updated
```

If no artifacts are produced, no bundle is created.

If evidence metadata persistence or durable upload fails, the run must not fail. The runner records a system log warning and preserves local filesystem evidence.

## Relationships

Canonical relationship:

```text
Campaign
↓
Run
↓
Evidence Bundle
↓
Evidence Items
↓
Reports
↓
SIEM Export
```

Phase 1 records:

- Run to Evidence Bundle through `runId`.
- Evidence Bundle to Evidence Items through `bundleId`.
- Evidence Item to compatibility Artifact through `artifactId`.
- Campaign to bundle/item through `campaignKey`.

Reports and SIEM exports are represented as Evidence Items when they are indexed as current artifacts.

## Backward Compatibility

Existing artifact behavior is preserved.

These APIs continue to behave as before:

- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/logs`
- `GET /api/runs/:id/artifacts`
- `GET /api/artifacts/:id`
- `GET /api/artifacts/:id/file`

Existing dashboard report links continue to use artifact IDs.

Existing artifact records remain the compatibility layer for:

- report archive
- run details
- artifact validation visibility
- report file serving

No bundle-serving API is introduced in Phase 1.

## Current Storage

Local JSON backend:

- `dashboard/.data/inssa-runs.json`
- stores runs, logs, audit events, artifacts, evidence bundles, and evidence items.

Supabase metadata backend:

- existing run/log/artifact behavior remains unchanged.
- evidence bundle/item persistence is modeled for future metadata tables.
- if a configured Supabase environment does not yet contain evidence tables, evidence persistence should be treated as a non-fatal metadata warning.

Durable storage:

- Provider abstraction supports `local-filesystem` and `supabase-storage`.
- Files are uploaded to a private Supabase Storage bucket when `INSSA_EVIDENCE_STORAGE_PROVIDER=supabase` is set.
- Bucket defaults to `inssa-evidence` and can be overridden with `INSSA_EVIDENCE_SUPABASE_BUCKET`.
- Upload uses the server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Objects are stored under `inssa/<environment>/<campaignKey>/<runId>/<bundleId>/<relativePath>`.
- Each upload is verified by downloading the object and comparing size and SHA-256.
- If Supabase Storage is unavailable, evidence remains available from the local filesystem and upload metadata is marked failed or local-only.

Current storage phase does not implement retention, archive, deletion, search, or object-storage migration for historical evidence.

## Retention Classes

Phase 1 records retention intent only.

Retention classes:

- `default`
- `short-lived`
- `security-evidence`
- `cleanup-evidence`
- `siem-metadata`

No retention engine, archive workflow, or deletion workflow is implemented in Phase 1.

## Future Phases

Phase 2: Bundle serving

- Add authenticated bundle-relative file serving.
- Serve Playwright report bundles as bundles, not single HTML files.
- Preserve existing artifact file routes.

Phase 3: Durable storage

- Implemented.
- Adds a storage provider abstraction.
- Uploads successful run evidence to private Supabase Storage when configured.
- Verifies size and SHA-256 before marking upload complete.
- Keeps local filesystem as runner scratch space and fallback.

Phase 4: Retention

- Enforce retention classes.
- Add archive/delete eligibility.
- Preserve cleanup/security evidence until closure.

Phase 5: Evidence Workspace

- Add Evidence Explorer.
- Add Bundle Details.
- Add Evidence Chain.
- Add Related Reports, Runs, Campaigns, and SIEM export views.

Phase 6: Production deployment

- Use Supabase metadata as primary.
- Use private object storage for binary evidence.
- Add backup and recovery procedures.

## Non-Goals For Phase 1

Phase 1 does not implement:

- Supabase Storage.
- Object storage.
- Retention enforcement.
- Bundle-relative serving.
- Evidence Workspace.
- Screenshot serving.
- Trace serving.
- Video serving.
- Archive workflows.
- Deletion workflows.
- UI changes.
- Playwright changes.
- Runner execution changes.
- Campaign script changes.
- Report generation changes.
- SIEM export changes.

## Non-Goals For Durable Storage

Durable storage does not implement:

- Retention engine.
- Archive workflow.
- Deletion workflow.
- Evidence Workspace.
- Search.
- Cleanup workflows.
- Storage analytics.
- Supabase Storage as the primary serving path.

Authenticated dashboard report serving remains local-bundle based for backward compatibility.
