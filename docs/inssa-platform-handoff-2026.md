# QA Operations Platform Handoff 2026

Last reviewed: 2026-07-21

## What This Repository Is

A reusable Playwright QA and Security Operations Platform. INSSA is the operational product; Localman and KBean have repository tests but are not registered as managed dashboard campaigns.

## What Is Complete

- Auth/RBAC-protected dashboard and APIs.
- Fixed command registry and product-aware Campaign Library.
- Durable jobs, leases, worker, recovery, and run isolation.
- Artifact compatibility, Evidence Bundles, bundle serving, and Evidence Workspace.
- Local/Supabase metadata and local/private Storage evidence providers.
- Notification Outbox without delivery.
- Monitoring definitions, schedule trigger, and authentication monitoring.
- Reports, SIEM export, authenticated ingestion, and Wazuh documentation.
- Runtime, persistence, dependency, redaction, and path-security hardening.

## What Remains Gated

- dashboard lifecycle mutation
- cross-user and reveal-later security execution
- SIEM send from dashboard
- external notification dispatch
- evidence retention/archive/deletion
- direct durable-object serving
- local/Supabase history migration
- Localman/KBean managed campaigns

## Production Release Blockers

1. Historical share-token values must be invalidated/expired and removed from Git history through an approved coordinated rewrite.
2. Target Supabase migrations, RLS, advisors, and private bucket must be validated.
3. Target Wazuh ingestion credential and live event flow must be validated.
4. The deployment checklist must be completed with environment evidence.

## Never Change Casually

- registry-only execution and `shell:false`
- durable worker ownership and one-active-run policy
- environment safeguards
- run-scoped output identity
- artifact compatibility and Evidence Bundle contracts
- canonical evidence path checks
- service-role-only persistence
- server-side RBAC
- scheduler producer-only behavior
- Notification Outbox no-delivery boundary
- metadata-only SIEM policy

## First Maintainer Actions

1. Read [README](../README.md), [Documentation Index](README.md), and [Architecture Constitution](qa-platform-architecture-constitution.md).
2. Review [Current State](inssa-platform-current-state.md) and [Known Limitations](known-limitations.md).
3. Run `npm run dashboard:doctor`.
4. Run `npm --prefix dashboard run test:execution-foundation`.
5. Start with `npm run dashboard:dev`.
6. Validate authentication and roles.
7. Execute only the Safe Suite first.
8. Do not enable lifecycle mutation or external delivery without approved design and cleanup controls.

## Documentation Ownership

Update README, current state, command matrix, subsystem guide, release notes, and changelog in the same change that alters an implemented contract. Historical validation reports should be preserved and labeled, not silently rewritten as current truth.
