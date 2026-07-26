# QA Operations Platform Roadmap

Last reviewed: 2026-07-21

## Completed: Platform Core v1.0

- Authenticated operations UI and server-side RBAC.
- Campaign Library and fixed command registry.
- Durable job ownership and dedicated worker.
- Immutable per-run output and manifests.
- Artifact compatibility APIs and Evidence Bundles.
- Authenticated Playwright bundle serving.
- Local and Supabase durable evidence providers.
- Evidence Workspace and report archive.
- Notification Outbox without delivery.
- Monitoring definitions and schedule trigger.
- Authentication Monitoring campaign.
- Metadata-only SIEM export and authenticated ingestion.
- Runtime, persistence, and security hardening.
- Dark/light themes and responsive workspaces.

## Release Closure

Before production certification:

1. Invalidate or confirm expiry of historical share tokens and complete approved Git-history remediation.
2. Apply and verify all migrations on the target Supabase project.
3. Provision and verify the private evidence bucket.
4. Deploy a unique Wazuh ingestion credential and validate live ingestion.
5. Complete the deployment checklist and capture environment-specific evidence.

## Phase B: Controlled Lifecycle Execution

Not implemented. Requires an approved workflow for staging mutation, explicit operator approval, cleanup ownership, and durable cleanup evidence before enabling text/media/video/reveal-later commands.

## Phase C: Advanced Security Execution

Not implemented in dashboard execution. Cross-user and reveal-later security remain visible but disabled until Phase B controls exist.

## Phase D: External Delivery

Not implemented. Includes Notification Outbox dispatcher implementations and a dashboard SIEM-send approval flow. Delivery must remain decoupled from the worker.

## Phase E: Operations Maturity

Not implemented. Includes retention/archive/deletion policies, direct durable evidence retrieval if approved, backend migration tooling, managed deployment automation, and broader Localman/KBean campaign registration.

No future phase may bypass the command registry, worker, evidence, persistence, scheduler, or outbox contracts.
