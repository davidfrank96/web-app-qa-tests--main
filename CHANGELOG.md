# Changelog

All notable QA Operations Platform changes are documented here.

## 1.0.0 - 2026-07-21

### Added

- Supabase-authenticated Operations Dashboard with viewer/operator/admin RBAC.
- Product-aware Campaign Library and fixed dashboard command registry.
- Durable execution jobs, idempotency, leases, heartbeats, abandoned-job recovery, and dedicated worker.
- Immutable per-run output directories and evidence manifests.
- Incremental local/Supabase log persistence and paginated run data APIs.
- Artifact metadata compatibility layer and Evidence Bundle/Evidence Item metadata.
- Authenticated Playwright bundle-relative serving with canonical path protection.
- Local and private Supabase durable evidence storage providers with integrity verification.
- Evidence Workspace, report archive, previews, related evidence, and chain of custody.
- Durable Notification Outbox and read-only Notification workspace.
- Product-aware Monitoring Framework and read-only Monitoring workspace.
- Producer-only scheduler with occurrence idempotency, recovery, status API, and dashboard status.
- INSSA Authentication Monitoring for password, Google OAuth, and Apple Sign-In.
- Metadata-only SIEM export, authenticated Wazuh ingestion, decoder/rules/dashboard/runbooks.
- Runtime Doctor, runtime clean/supervisor scripts, persistence provisioning, and healthcheck.
- Dark/light semantic theme system.
- Security output redaction, dependency hardening, and evidence symlink/traversal defenses.

### Changed

- Dashboard requests now enqueue durable jobs instead of owning campaign subprocesses.
- Historical dashboard output now resolves through run-scoped paths.
- Reports workspace now operates as an Evidence Workspace.
- Wazuh sender and ingestion now fail closed without credentials.
- Next.js, React, PostCSS, and Sharp dependencies were pinned to audit-clean versions.
- Documentation was consolidated around README, Documentation Index, Architecture Constitution, Current State, and subsystem guides.

### Preserved

- Existing Playwright tests, campaign scripts, report generators, SIEM normalization, and artifact compatibility APIs.
- Staging-only standard INSSA safeguards and manual cleanup obligations.
- One-active-run behavior.

### Known Limitations

- Production release blocked by historical share-token exposure pending approved remediation.
- No retention/archive/deletion engine.
- No external Notification Outbox delivery.
- No dashboard lifecycle mutation, advanced security mutation, or SIEM send.
- No automatic local/Supabase history migration.
- Localman/KBean managed campaign execution remains future work.
