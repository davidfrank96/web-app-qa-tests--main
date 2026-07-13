# Evidence System Certification

Last updated: 2026-07-13

This document records certification status for the INSSA QA Operations Platform Evidence Management System.

## Certification Summary

| Layer | Status | Evidence |
| --- | --- | --- |
| Evidence metadata | Certified | Runs create Evidence Bundle and Evidence Item metadata after artifact indexing. |
| Bundle serving | Certified | Authenticated Playwright report bundle serving returns report HTML and relative assets through `/api/artifacts/:id/bundle/*`. |
| Authenticated evidence validation | Certified | Operator-authenticated Safe Suite run produced a Playwright report that served through the dashboard bundle route. |
| Durable storage | Certified | Successful run evidence uploaded to private Supabase Storage, verified by size and SHA-256, and metadata updated. |

## Durable Storage Certification

Certification run:

| Field | Value |
| --- | --- |
| Run ID | `f4372bf0-17f6-4096-8d66-a6060c2d07b6` |
| Command | `test:inssa:safe` |
| Final status | `passed_with_warnings` |
| Exit code | `0` |
| Evidence bundle ID | `77905584-8112-4a5c-9913-88906ca85774` |
| Storage backend | `supabase-storage` |
| Upload status | `uploaded` |
| Uploaded items | `2` |
| Storage bucket | `inssa-evidence` |
| Bundle route | `GET /api/artifacts/bb0eaa8f-a96c-448a-b6c0-02fbdec4a19d/bundle/index.html` |
| Bundle route result | `200 text/html` |

Run log evidence:

```text
Evidence durable storage uploaded: Uploaded 2 evidence items to Supabase Storage bucket inssa-evidence.
```

## Certified Behavior

Durable storage adds storage behavior only:

- It does not change Playwright execution.
- It does not change campaign scripts.
- It does not change report generation.
- It does not change SIEM export.
- It does not change authentication or RBAC.
- It does not change dashboard APIs.
- It does not change local bundle serving.

Upload behavior:

```text
Runner
↓
Artifact indexing
↓
Evidence Bundle metadata
↓
Storage provider
↓
Supabase Storage upload
↓
Size and SHA-256 verification
↓
Evidence metadata update
```

Fallback behavior:

- If `INSSA_EVIDENCE_STORAGE_PROVIDER` is not `supabase`, evidence remains local-only.
- If Supabase Storage is unavailable, the run preserves local filesystem evidence.
- Storage failures are recorded as warnings and do not invalidate existing dashboard report serving.

## Required Configuration

Durable Supabase Storage requires:

```text
INSSA_EVIDENCE_STORAGE_PROVIDER=supabase
INSSA_EVIDENCE_SUPABASE_BUCKET=inssa-evidence
SUPABASE_URL=<configured in dashboard environment>
SUPABASE_SERVICE_ROLE_KEY=<configured in dashboard environment>
```

`INSSA_EVIDENCE_SUPABASE_BUCKET` is optional. If omitted, the provider uses `inssa-evidence`.

## Not Certified In This Phase

The following remain future phases:

- Retention engine.
- Archive workflow.
- Deletion workflow.
- Evidence Workspace.
- Search.
- Cleanup workflows.
- Storage analytics.
- Serving dashboard evidence directly from Supabase Storage.
