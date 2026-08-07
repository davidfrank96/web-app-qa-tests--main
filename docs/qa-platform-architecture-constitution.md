# QA Platform Architecture Constitution

Last ratified: 2026-08-02
Applies to Platform Core version `1.0.0`

This is the governing architectural source of truth. A change that conflicts with it requires explicit architecture approval before implementation.

## 1. Mission

The platform is a reusable QA and Security Operations Platform for INSSA, Localman, KBean products, and future hosted products. INSSA is the current operational focus.

Its purpose is to:

- execute QA, security, lifecycle, artifact-driven, and monitoring campaigns
- preserve source evidence and chain of custody
- render human-readable reports
- export metadata to SIEM
- support safe operational review

Testing and validation are the product. Reports, dashboards, storage, notifications, and SIEM are supporting layers.

The platform is not a product backend, generic shell runner, report generator without tests, SIEM replacement, notification service, cleanup robot, governance platform, or production mutation framework.

## 2. Canonical Architecture

```text
Playwright tests
      |
Campaign runners
      |
Command registry
      |
Durable execution job
      |
Dedicated worker
      |
Immutable run output
      |
Artifacts -> Evidence Bundle -> Evidence Items
      |
Reports and SIEM export
```

The dashboard and scheduler are clients of this architecture. Neither may replace or bypass it.

## 3. Product Model

- Campaigns execute tests and create fresh run evidence.
- Lifecycle campaigns create product data and carry cleanup obligations.
- Artifact Validation consumes existing lifecycle evidence without creating capsules.
- Evidence Bundles are the durable evidence aggregate.
- Artifacts are a compatibility model for established APIs.
- Reports are derived views.
- SIEM exports metadata and never becomes source evidence.
- Operations manages runtime and persistence health.
- Monitoring definitions describe observation policy.
- The scheduler enqueues due jobs only.
- The Notification Outbox records delivery intent only.

These concepts must remain distinct in code, API behavior, and UI language.

## 4. Execution Constitution

1. Dashboard requests enqueue; they do not own campaign execution.
2. The worker is the sole campaign executor.
3. Commands must be selected from the fixed registry.
4. Arbitrary shell input, user-supplied command arguments, and user-supplied targets are prohibited.
5. Child commands use `shell:false` where possible.
6. Durable jobs own idempotency, claim, lease, heartbeat, attempt, and recovery state.
7. One active run globally remains the default v1.0 policy.
8. Every run writes to an immutable run-scoped directory.
9. Historical views resolve through run identity, never a mutable `latest` alias.
10. Logs persist incrementally and redact sensitive output.

## 5. Environment Constitution

Standard INSSA execution is staging-only at `staging.inssa.us`. Live lifecycle commands require explicit mutation and cleanup gates.

Production authentication monitoring is a narrowly approved read-only exception. It requires its dedicated command, enable flag, and exact host confirmation. That exception must not become a generic production-target override.

## 6. Lifecycle Constitution

Text, media, video, and reveal-later lifecycle campaigns create staging data. Dashboard execution is permitted only through the approved governed workflow, which provides:

- explicit approval
- clear operator identity
- one-run semantics around final product actions
- cleanup target and owner
- durable cleanup evidence
- no production target

Visibility in the Campaign Library does not imply execution approval.

The governed workflow is admin-only, fixes the target to `staging.inssa.us`, requires explicit acknowledgements and confirmation, repeats preflight server-side, creates a durable one-attempt job, and records a cleanup manifest. Raw mutation primitives remain hidden. Reveal-later campaigns must explicitly choose create or resume; resume must validate approved staging artifact ownership, schedule, and lifecycle state.

## 7. Security Constitution

The platform supports OWASP validation, known-finding verification, artifact-driven access checks, cross-user validation, reveal-later access checks, and authentication monitoring.

Security controls must fail closed. A reporting concern must not silently downgrade a validated security failure. Classification adjustments require evidence and must preserve stronger failure conditions.

## 8. Evidence Constitution

1. Evidence is primary; reports are derived.
2. New completed runs create Evidence Bundle and Evidence Item metadata.
3. Artifact APIs remain backward compatible until an explicit migration is approved.
4. Bundle-relative paths are untrusted and require canonical validation.
5. Authentication does not make a path safe.
6. Evidence bytes do not belong in Postgres.
7. Durable object keys include product, environment, campaign, run, bundle, and relative path identity.
8. Existing durable objects must not be overwritten to make retries pass.
9. Upload completion requires size and SHA-256 verification.
10. Retention, archive, and deletion require separate approved policy and implementation.

## 9. Persistence Constitution

- Local and Supabase stores implement the same logical contracts.
- Supabase platform tables are server-only, RLS-enabled, and not directly exposed to browser roles.
- The service-role key is server-only.
- Migrations are ordered, forward-only after shared deployment, and replay-safe.
- Provider switching does not imply data migration.
- Unknown future local schema versions fail closed.
- Local writes use locking and atomic replacement; logs remain incremental.

## 10. Monitoring Constitution

- A Monitoring Definition references an existing campaign key.
- Trigger, run, evidence, notification, retry, environment, and timeout policies are metadata.
- The scheduler evaluates schedule triggers and claims a unique occurrence.
- The scheduler never invokes npm or Playwright.
- The worker executes scheduler-created jobs through the same registry path as operator runs.
- Duplicate occurrences must be prevented durably.

## 11. Notification Constitution

- Execution may emit zero or more deduplicated outbox records.
- The worker must never call an external notification provider.
- Dispatcher interfaces may be defined separately.
- Provider implementation, retries, and dead-letter transitions require an approved delivery phase.
- A dashboard outbox view remains read-only until then.

## 12. Dashboard Constitution

The dashboard may:

- present campaign definitions
- enqueue approved commands
- display run, evidence, report, monitor, notification, scheduler, and diagnostic data
- apply client-side presentation and themes

The dashboard must not:

- duplicate Playwright/campaign logic
- become a generic command runner
- bypass server authorization
- mutate evidence to improve presentation
- treat reports as source data
- expose service credentials or direct private Storage access
- send external notifications from the worker or UI

## 13. Authentication And Authorization Constitution

- Supabase Auth establishes identity.
- API authorization is server-side.
- Roles are viewer, operator, and admin.
- `app_metadata.inssa_ops_role` is primary; allowlists are fallback; default is viewer.
- Client checks are presentation only.
- Unauthorized and role-violation attempts are audited.

## 14. SIEM Constitution

Correct flow:

```text
Campaign -> Evidence -> Reports -> SIEM Export -> Authenticated Ingestion -> Wazuh
```

Only metadata, findings, classifications, statuses, and references may be sent. Screenshots, videos, traces, signed URLs, credentials, tokens, and session material are prohibited. Ingestion and sender authentication fail closed.

## 15. Protected Architecture

Explicit approval is required before changing:

- registry-only execution
- durable job/worker ownership
- one-active-run model
- idempotency, leases, heartbeats, or recovery
- staging and production-monitor safeguards
- run-scoped output identity
- artifact compatibility APIs
- Evidence Bundle/Item model
- canonical evidence path validation
- local/Supabase persistence contracts
- service-role-only persistence boundary
- auth/RBAC role model
- scheduler producer-only boundary
- Notification Outbox no-delivery boundary
- metadata-only SIEM policy

## 16. Development Evaluation

Before implementing work:

1. Classify it as Campaign, Lifecycle, Security, Artifact Validation, Evidence, Reports, SIEM, Monitoring, Notifications, or Operations.
2. Identify the existing subsystem contract it extends.
3. Confirm it does not create a second execution, evidence, persistence, scheduling, or delivery path.
4. Define risk, environment, cleanup, evidence, and role behavior.
5. Preserve backward compatibility or obtain explicit migration approval.
6. Add focused validation without weakening product assertions.
7. Update the authoritative documentation and changelog.

## 17. Approved Roadmap

- Platform Core v1.0: implemented.
- Release closure: security-history remediation and target-environment certification.
- Phase B: controlled lifecycle execution.
- Phase C: cross-user and reveal-later execution.
- Phase D: external notification and SIEM-send approval workflows.
- Phase E: retention/archive/deletion, migration tooling, and broader product rollout.

Future work must consume the certified core rather than replace it.
