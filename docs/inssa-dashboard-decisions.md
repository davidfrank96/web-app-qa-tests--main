# INSSA Dashboard Decisions

Last updated: 2026-06-11

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

## Decision 4: Lifecycle Campaigns Remain Gated

Decision: Text, media, video, and reveal-later lifecycle campaigns remain visible but disabled in the dashboard.

Rationale:

- They create staging data.
- They require manual cleanup evidence.
- They should not be triggered casually from the dashboard without approval UX.

Implication:

- Lifecycle commands are orientation cards, not executable controls, in V1.

## Decision 5: SIEM Export Is Enabled, SIEM Send Is Disabled

Decision: The dashboard can generate SIEM metadata exports but cannot send them to Wazuh yet.

Rationale:

- Export is local and metadata-only.
- Send is external transmission and requires confirmation, endpoint preview, and dry-run guardrails.

Implication:

- `siem:export` is executable.
- `siem:send` is visible but disabled.

## Decision 6: One Active Run Globally

Decision: The runner supports one active run and no queue.

Rationale:

- Prevents conflicting Playwright/browser/report output writes.
- Avoids concurrent staging interactions.
- Keeps V1 operational behavior simple and predictable.

Implication:

- A second run request while one is active returns a conflict.
- Scheduling is out of scope for V1.

## Decision 7: Staging-Only Execution

Decision: Dashboard command execution requires `INSSA_URL=https://staging.inssa.us`.

Rationale:

- This repo black-box tests INSSA staging only.
- Production mutation/security lifecycle testing is not permitted.

Implication:

- Production hosts `inssa.us` and `www.inssa.us` are blocked.
- Unknown or empty environments are blocked.

## Decision 8: Server-Side Authorization Is Required

Decision: All protected API routes enforce authentication and role checks server-side.

Rationale:

- Client disabled states are not security boundaries.
- Users must not be able to bypass UI role restrictions with direct API calls.

Implication:

- `viewer` can read.
- `operator` can run safe commands.
- `admin` can run healthcheck.

## Decision 9: Artifact Serving Uses Metadata And Allowlists

Decision: Artifact file serving resolves only from stored artifact metadata and allowlisted roots/types.

Rationale:

- Prevents arbitrary filesystem access.
- Keeps sensitive raw evidence local.
- Allows reports/SIEM JSON to be opened safely.

Implication:

- Screenshots, videos, traces, and sensitive artifacts are indexed but not served in V1.

## Decision 10: Keep Existing Test/Campaign Logic Untouched

Decision: Dashboard work should not modify Playwright tests, campaign scripts, report generators, or SIEM normalization unless specifically scoped.

Rationale:

- The dashboard is an operational wrapper over a mature QA harness.
- Rewriting test behavior from the dashboard would blur responsibilities.

Implication:

- UI improvements should consume existing APIs and metadata.
- Runner changes require separate review.

