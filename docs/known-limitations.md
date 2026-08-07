# Platform Core v1.0 Known Limitations

Last reviewed: 2026-08-02

## Release Blockers

- Historical share-token values remain in commit `3506a72a018f`; production release is blocked pending invalidation/expiry confirmation and approved history remediation.
- Target managed Supabase migration/RLS/advisor verification has not been certified by this repository-only sprint.
- Target live Wazuh credential deployment and end-to-end ingestion must be validated in the deployment environment.

## Execution

- One active run globally; parallel campaign execution is not supported.
- Governed lifecycle, cross-user, and reveal-later security commands are admin-only and staging-only; they still require explicit manual cleanup confirmation.
- Cleanup confirmation records operator completion but does not independently delete or verify product data.
- Raw mutation primitives remain hidden and retain manual cleanup responsibility when invoked directly by developers.
- Cancellation is represented in the model but no general dashboard cancellation workflow is provided.

## Evidence And Storage

- No automated retention, archive, restore, or deletion engine.
- Durable Supabase evidence is not served directly; authenticated dashboard serving uses local filesystem evidence.
- Existing local history is not automatically migrated to Supabase.
- Historical runs without Bundle metadata are not automatically backfilled.
- A configured upload failure preserves local evidence and marks a warning; retry operations are manual.

## Monitoring And Notifications

- Only schedule triggers execute; manual/API/deployment/webhook values are descriptive.
- Monitoring definitions are read-only in the dashboard.
- Run policy values do not override the global one-active-run rule.
- Notification Outbox has no external dispatcher, delivery retries, or active dead-letter processor.
- Production authentication monitors are seeded disabled and require provider-specific test accounts.

## Products

- INSSA is the only product with managed dashboard campaign definitions.
- Localman and KBean remain CLI Playwright projects.
- Campaign/product metadata still contains some INSSA-specific naming in compatibility types and paths.

## SIEM

- Dashboard SIEM send is disabled.
- CLI send requires external endpoint credentials and operator action.
- Wazuh dashboards and saved objects are external deployment state, not recreated automatically from the local dashboard.

## Operations

- Local and Supabase stores may contain different histories.
- No supported automatic export/import exists between metadata backends.
- Runtime Doctor validates configuration and build state but is not a service monitor.
- Generated lifecycle/security evidence may contain product share links and must remain access-controlled and ignored by Git.
