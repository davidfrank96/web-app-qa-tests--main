# QA Operations Platform Core v1.0 Definition

Last reviewed: 2026-07-21

## Complete Scope

Platform Core v1.0 provides:

- authenticated dashboard and server-side viewer/operator/admin RBAC
- registry-only command execution
- durable execution jobs and a dedicated worker
- one active run globally
- run history, incremental logs, artifacts, manifests, and evidence metadata
- authenticated Evidence Bundle serving and Evidence Workspace
- local metadata/evidence support
- Supabase metadata and private Storage support
- security/lifecycle report review
- metadata-only SIEM export and authenticated ingestion service
- durable Notification Outbox with no provider delivery
- Monitoring Framework and schedule trigger
- staging/production-guarded Authentication Monitoring
- Runtime Doctor, persistence provisioning, healthcheck, and security controls

## Dashboard-Enabled Product Workflows

- INSSA Safe Suite
- Security Campaign
- Security Verification
- Authenticated Discovery
- Public Share Validation
- Cleanup Capability Audit
- security and lifecycle report rendering
- SIEM export
- platform healthcheck
- authentication monitoring

## Explicitly Outside v1.0

- enabling lifecycle mutation from the dashboard
- cross-user and reveal-later security dashboard execution
- arbitrary command execution
- multiple concurrent workers/runs
- external notification dispatch
- dashboard SIEM send
- evidence retention/archive/deletion engine
- direct browser access to Supabase Storage
- automatic local-to-Supabase history migration
- Localman/KBean managed campaign execution
- general-purpose analytics or governance workflows

## Certification Meaning

`1.0.0` identifies the implemented Platform Core contract. It does not by itself certify a target production deployment. Production certification additionally requires the repository security blocker and environment-specific Supabase/Wazuh checks in the release guide to pass.
