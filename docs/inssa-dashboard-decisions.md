# INSSA Dashboard Decisions

Last updated: 2026-08-02

This document records architectural decisions already made for the INSSA QA Operations Dashboard.

## Decision 1: Campaigns Execute Tests

Decision: Dashboard campaign actions run whitelisted npm/Playwright commands.

Rationale:

- Keeps execution behavior aligned with existing CLI workflows.
- Avoids duplicating Playwright logic in the dashboard.
- Makes dashboard runs auditable through the same command names used locally.

Implication:

- The dashboard must not call Playwright APIs directly from client code.
- New executable actions must be added through the server-side command registry.

## Decision 2: Reports Review Evidence

Decision: Reports are separated from campaigns. Report actions re-render or open evidence; they do not imply test execution.

Rationale:

- Prevents users from confusing `report:security` with `test:inssa:campaign:security`.
- Preserves historical evidence review.
- Keeps report rendering low-risk and read-only.

Implication:

- Report Archive is a review surface.
- Campaign Catalog/Security/Safe Tests are execution surfaces.

## Decision 3: Artifact Validation Consumes Existing Lifecycle Artifacts

Decision: Discovery, public-share, and cleanup audit commands require a lifecycle artifact selection.

Rationale:

- These tests are read-only only if they consume prior lifecycle evidence.
- They must not silently create new capsules.

Implication:

- The dashboard must show the selected artifact path, type, and timestamp before execution.
- Execution must fail if no validation-ready artifact exists.

## Decision 4: Lifecycle Campaigns Use Governed Admin Enablement

Decision: Text, media, video, reveal-later, cross-user, and reveal-later security wrappers are executable only by admins through a staging-only approval and preflight workflow.

Rationale:

- They create staging data.
- They require manual cleanup evidence.
- They must not be triggered casually, retried around irreversible final actions, or exposed through raw mutation primitives.

Implication:

- Viewer/operator users see `Admin approval required` and receive server-side `403` responses.
- Admins must use `Review and Run`, satisfy campaign prerequisites, accept cleanup ownership, and type `RUN STAGING MUTATION`.
- Reveal-later execution requires explicit create-new or resume-approved-artifact selection.

## Decision 5: SIEM Export Is Enabled, SIEM Send Is Disabled

Decision: The dashboard can generate SIEM metadata exports but cannot send them to Wazuh yet.

Rationale:

- Export is local and metadata-only.
- Send is external transmission and requires confirmation, endpoint preview, and dry-run guardrails.

Implication:

- `siem:export` is executable.
- `siem:send` is visible but disabled.

## Decision 6: Durable Queue With One Active Run Globally

Decision: Requests create durable execution jobs, but the platform permits only one queued, claimed, or running job globally.

Rationale:

- Prevents conflicting Playwright/browser/report output writes.
- Avoids concurrent staging interactions.
- Keeps execution deterministic while allowing request-independent worker ownership and recovery.

Implication:

- A second ad-hoc run request while one is active returns a conflict.
- The scheduler may create only a durable occurrence/job through the same one-active-run boundary.
- The worker, not the HTTP request or scheduler, owns execution.

## Decision 7: Staging-Only Execution

Decision: Standard dashboard command execution requires `INSSA_URL=https://staging.inssa.us`.

Rationale:

- This repo black-box tests INSSA staging only.
- Production mutation/security lifecycle testing is not permitted.

Implication:

- Production hosts are blocked for standard commands. The dedicated production authentication monitor is a narrowly guarded read-only exception requiring explicit host confirmation.
- Unknown or empty environments are blocked.

## Decision 8: Server-Side Authorization Is Required

Decision: All protected API routes enforce authentication and role checks server-side.

Rationale:

- Client disabled states are not security boundaries.
- Users must not be able to bypass UI role restrictions with direct API calls.

Implication:

- `viewer` can read.
- `operator` can run safe/read-only commands but cannot run live mutation or healthcheck.
- `admin` can run healthcheck and may enter the governed live mutation approval workflow.

## Decision 9: Evidence Serving Uses Metadata, Canonical Paths, And Bundle Roots

Decision: Artifact and Evidence Bundle serving resolves only from stored metadata and validates canonical repository, root, and target paths.

Rationale:

- Prevents arbitrary filesystem access.
- Blocks traversal, symlink escape, and arbitrary filesystem access.
- Allows complete authenticated Playwright bundles to load relative assets.
- Keeps Supabase Storage private and server-only.

Implication:

- Compatibility report routes retain their existing restrictions.
- Bundle assets are served only inside the authenticated bundle boundary.
- Textual responses are redacted; binary evidence remains access-controlled and sensitive.

## Decision 10: Evidence Bundles Are Primary

Decision: Evidence Bundles and Evidence Items are the durable run evidence model; Artifact remains a backward-compatibility model.

Rationale:

- Playwright reports are multi-file bundles.
- Run-scoped identity preserves historical fidelity.
- Reports remain derived views.

Implication:

- New completed runs create bundle/item metadata after indexing.
- Durable Storage upload verifies immutable objects by size and SHA-256.
- Retention and deletion are separate future systems.

## Decision 11: Keep Existing Test/Campaign Logic Untouched

Decision: Dashboard work should not modify Playwright tests, campaign scripts, report generators, or SIEM normalization unless specifically scoped.

Rationale:

- The dashboard is an operational wrapper over a mature QA harness.
- Rewriting test behavior from the dashboard would blur responsibilities.

Implication:

- UI improvements should consume existing APIs and metadata.
- Runner changes require separate review.

## Decision 12: Scheduler Enqueues Only

Decision: The scheduler evaluates due monitoring definitions and creates durable jobs. It never executes npm, Playwright, or campaign logic.

## Decision 13: Notification Outbox Does Not Deliver

Decision: Execution records notification events durably. The worker does not call email, SMS, Slack, Teams, webhook, or push providers.
