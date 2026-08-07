# QA Operations Platform

Version `1.0.0` of a reusable Playwright QA and Security Operations Platform for hosted web applications.

INSSA is the current operational product. Localman and KBean test projects are present in the repository, but their campaign coverage is not yet integrated into the managed operations workflow.

## Mission

The platform exists to execute approved QA, security, lifecycle, artifact-validation, and monitoring campaigns; preserve evidence; render reports; export metadata to SIEM; and support operational review.

Testing and validation are the core product. Reports, dashboards, notifications, storage, and SIEM are supporting layers. The dashboard must not replace Playwright or campaign logic.

## Architecture

```text
Authenticated operator or scheduler
              |
              v
      Whitelisted command registry
              |
              v
       Durable execution job
              |
              v
      Dedicated worker + lease
              |
              v
 Existing npm / Playwright campaign
              |
              v
 Immutable run output + manifest
              |
              v
 Artifacts -> Evidence Bundle -> Reports
              |
              v
     Durable Storage / SIEM Export
```

| Layer | Implemented responsibility |
| --- | --- |
| Playwright | Black-box product validation. |
| Campaign runners | Existing CLI orchestration for lifecycle and security workflows. |
| Command registry | The only dashboard-executable command allowlist. Arbitrary shell input is prohibited. |
| Durable jobs | Persistent job ownership, idempotency, leases, heartbeats, and abandoned-job recovery. |
| Worker | Executes one approved run at a time independently of the HTTP request. |
| Run output | Per-run immutable output under `run-output/<runId>/` with a manifest. |
| Evidence | Bundle and item metadata, authenticated bundle-relative serving, and optional durable Storage upload. |
| Reports | Derived human-readable evidence views. Reports are not the source of truth. |
| Notification Outbox | Durable read-only event journal. No external dispatcher is implemented. |
| Monitoring | Managed definitions and a producer-only schedule trigger. |
| SIEM | Metadata-only export and authenticated Wazuh ingestion. Dashboard send remains disabled. |
| Dashboard | Authenticated operations and evidence review over existing APIs and infrastructure. |

The governing rules are in [QA Platform Architecture Constitution](docs/qa-platform-architecture-constitution.md).

## Product Model

- Campaigns execute tests.
- Artifact Validation consumes existing lifecycle evidence.
- Reports review derived evidence.
- Evidence Bundles are the durable evidence object.
- SIEM exports metadata; it is not evidence storage.
- Operations manages platform health.
- Monitoring definitions describe recurring observation; the scheduler only enqueues jobs.
- The Notification Outbox records delivery intent; it does not contact providers.

## Implemented Subsystems

- Supabase email/password and magic-link authentication.
- Server-enforced `viewer`, `operator`, and `admin` RBAC.
- Product-aware Campaign Library presentation backed by the existing command registry.
- Durable execution jobs, worker leases, heartbeats, recovery, and idempotency.
- One active run globally.
- Incremental logs with output redaction.
- Paginated run, log, artifact, evidence, notification, and monitoring APIs where implemented.
- Per-run immutable output manifests.
- Artifact metadata and compatibility APIs.
- Evidence Bundle and Evidence Item metadata.
- Authenticated Playwright bundle serving, including bundle-relative assets.
- Local filesystem and private Supabase Storage providers.
- Evidence Workspace with bundle/item inspection and previews.
- Security/lifecycle report rendering and report archive.
- Durable Notification Outbox with no external delivery.
- Monitoring definitions and scheduler occurrence ledger.
- Authentication Monitoring for email/password, Google OAuth, and Apple Sign-In.
- Metadata-only SIEM export and authenticated Wazuh ingestion service.
- Runtime Doctor, clean build protection, platform healthcheck, and persistence provisioning.
- Dark and light UI themes.

## Dashboard Workspaces

| Workspace | Purpose | Execution |
| --- | --- | --- |
| Overview | Runner, backend, recent activity, and platform summary. | None |
| Campaign Library | Product-aware campaign definitions and readiness. | Existing enabled commands only |
| Testing | Dedicated INSSA Safe Suite action. | Operator/admin |
| Security | Security Campaign, Security Verification, Cross-User, and Reveal-Later Security. | Read-only actions operator/admin; live actions admin only |
| Lifecycle | Text, media, video, and reveal-later governed campaign execution. | Admin only; staging approval and cleanup required |
| Execution | Active run timeline, logs, outputs, and completion. | Observational |
| Artifact Validation | Discovery, public-share, and cleanup audits using selected evidence. | Operator/admin with artifact selection |
| Reports | Evidence explorer, item preview, integrity, storage, reports, and related evidence. | None |
| SIEM | Metadata-only export. | Export enabled; send disabled |
| Authentication Monitoring | Independent provider status and historical runs. | Approved monitoring commands |
| Monitoring | Definitions and scheduler status. | Read-only |
| Notifications | Durable outbox events. | Read-only; no send action |
| Operations | Metadata diagnostics and admin healthcheck. | Healthcheck admin-only |
| Runs | Run history, detail, logs, artifacts, and report links. | None |

## Roles

| Role | Capabilities |
| --- | --- |
| Viewer | View dashboard, runs, logs, artifacts, evidence, reports, monitors, notifications, and diagnostics. |
| Operator | Viewer permissions plus enabled safe/read-only commands, excluding platform healthcheck. |
| Admin | Operator permissions plus platform healthcheck and governed live staging campaigns after approval/preflight. |

Role resolution uses `app_metadata.inssa_ops_role`, then optional email allowlists, then defaults to `viewer`. API authorization is server-side.

## Current Command Exposure

Executable from the dashboard:

- `test:inssa:safe`
- `test:inssa:campaign:security`
- `test:inssa:campaign:security:verify`
- `test:inssa:campaign:text` for admins after live approval
- `test:inssa:campaign:media` for admins after live approval
- `test:inssa:campaign:video` for admins after live approval
- `test:inssa:campaign:reveal-later` for admins in explicit create/resume mode
- `test:inssa:campaign:cross-user` for admins after secondary-account preflight
- `test:inssa:campaign:reveal-later-security` for admins in explicit create/resume mode
- `test:inssa:discovery`
- `test:inssa:public-share`
- `test:inssa:cleanup-audit`
- `report:security`
- `report:lifecycle`
- `siem:export`
- `platform:healthcheck` for admins
- staging and production authentication-monitor commands, subject to their environment safeguards

Visible but disabled:

- SIEM send

Hidden from dashboard execution:

- broad project suites
- raw mutation specs
- campaign-plus-SIEM wrappers
- arbitrary npm commands

See [Command Matrix](docs/inssa-command-matrix.md) for the complete CLI and dashboard inventory.

## Quick Start

Prerequisites:

- Node.js `22` LTS
- repository and dashboard dependencies
- Playwright browsers
- `dashboard/.env.local` configured from `dashboard/.env.example`
- INSSA staging credentials only for commands that require them

```bash
npm install
npm --prefix dashboard install
npm run install:browsers
npm run dashboard:doctor
npm run dashboard:dev
```

Production-style local startup:

```bash
npm run dashboard:clean
npm run dashboard:build
npm run dashboard:start
```

The dashboard supervisor starts the dashboard, worker, and scheduler. Do not mix `dev` and `start` processes against one `.next` directory.

## Safe CLI Validation

```bash
npm run test:inssa:safe
npm run test:inssa:campaign:security
npm run test:inssa:campaign:security:verify
npm run siem:export
npm run platform:healthcheck
npm run dashboard:doctor
npm --prefix dashboard run test:execution-foundation
```

Live lifecycle commands require the explicit gates documented in [.env.inssa.live-staging.example](.env.inssa.live-staging.example) and create manual cleanup obligations.

## CI/CD

Branch protection requires:

- `Playwright QA / test`
- `QA Enforcement / Playwright QA Gate`

The Playwright check runs only the approved non-destructive INSSA safe suite against staging. The enforcement gate validates repository integrity, root and dashboard TypeScript, the certified dashboard build and Runtime Doctor, platform subsystem regressions, ingestion/SIEM security, and production dependency audits. Authentication monitoring remains credential-free during discovery and runs only through its dedicated campaign command.

See [CI/CD Pipeline](docs/ci-cd.md) for the exact job graph, fork behavior, secret requirements, prohibited workflows, failure artifacts, and local reproduction commands.

## Persistence And Evidence

Development defaults:

```text
INSSA_OPS_METADATA_STORE=local
INSSA_EVIDENCE_STORAGE_PROVIDER=local
```

Durable deployments use Supabase Postgres for metadata and a private Supabase Storage bucket for evidence bytes. Apply all seven ordered migrations and provision the bucket before selecting Supabase providers:

```bash
cd dashboard
npx supabase@latest link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase@latest db push --dry-run
npx supabase@latest db push
npm run persistence:provision
npm run persistence:verify
```

Current bundle serving remains authenticated and filesystem-backed. Supabase Storage is the durable copy, not a public CDN. Retention, archive, deletion, and direct Storage serving are not implemented.

## Monitoring And Notifications

The scheduler evaluates enabled schedule definitions and creates durable jobs. It never invokes Playwright or npm directly. The worker remains the only executor.

The Notification Outbox records queued, started, completed, failed, recovery, and evidence-upload events. Email, SMS, Slack, Teams, webhook, and push dispatchers are not implemented.

Authentication Monitoring is the first continuous campaign. Monitor credentials use the canonical `AUTH_MONITOR_*` namespace and are loaded from the same dashboard environment as the worker and scheduler. Production monitoring remains disabled by default and requires `AUTH_MONITOR_ALLOW_PRODUCTION=1` plus exact host confirmation.

## SIEM And Wazuh

```text
Campaign evidence
  -> npm run siem:export
  -> reports/siem/latest-siem-export.json
  -> npm run siem:send
  -> authenticated ingestion API
  -> /var/ossec/logs/inssa-qa.log
  -> Wazuh decoder/rules/index/dashboard
```

The sender requires HTTPS for non-loopback targets and a bearer credential. The ingestion service refuses startup without a credential of at least 32 characters. Screenshots, videos, traces, signed URLs, tokens, and credentials are rejected from SIEM payloads.

## Security Boundaries

- Dashboard command execution is allowlist-only and uses `shell:false`.
- Standard INSSA commands are staging-only.
- Production authentication monitoring has a separate explicit confirmation gate.
- Supabase service-role credentials are server-only.
- Evidence paths use canonical `realpath` validation and reject symlink escape.
- Text logs and served textual evidence are redacted.
- Wazuh ingestion is authenticated and fails closed.
- No real environment file, user file, or generated evidence belongs in Git.

## Environment

Use these templates:

- [.env.example](.env.example): repository-wide reference.
- [.env.inssa.live-staging.example](.env.inssa.live-staging.example): live INSSA lifecycle gates.
- [dashboard/.env.example](dashboard/.env.example): Next.js, persistence, worker, scheduler, roles, and SIEM.
- [performance/k6/.env.example](performance/k6/.env.example): k6 authentication load testing.

The authoritative variable descriptions are in [Environment Setup](docs/environment-setup.md). Never commit `.env`, `.env.local`, credentials, test-user files, or generated evidence.

## Release Status

Platform Core version: `1.0.0`.

Runtime, local persistence, evidence, worker, scheduler, monitoring, dependency, and code-level security regression checks pass. Production release remains blocked until the historical share tokens documented in [Platform Security Certification](docs/platform-security-certification.md) are invalidated or confirmed expired and removed from Git history. A production deployment must also complete linked Supabase and live Wazuh validation.

See [Platform Core v1.0 Release Notes](docs/platform-core-v1.0-release-notes.md), [Known Limitations](docs/known-limitations.md), and [Deployment Checklist](docs/deployment-checklist.md).

## Documentation

Start with [Documentation Index](docs/README.md). It separates authoritative guides, subsystem references, operational Wazuh documentation, product findings, and historical validation records.

Key references:

- [Architecture Constitution](docs/qa-platform-architecture-constitution.md)
- [Architecture Summary](docs/architecture-summary.md)
- [Subsystem Summary](docs/subsystem-summary.md)
- [Current State](docs/inssa-platform-current-state.md)
- [Execution Foundation](docs/qa-execution-foundation.md)
- [Evidence Management](docs/EVIDENCE_MANAGEMENT_ARCHITECTURE.md)
- [Persistence Architecture](docs/platform-persistence-architecture.md)
- [Campaign Management](docs/campaign-management.md)
- [Platform Operations](docs/inssa-platform-operations.md)
- [Security Guide](docs/platform-security-guide.md)
- [Deployment Guide](docs/platform-deployment-guide.md)
- [Release Guide](docs/platform-release-guide.md)
- [CI/CD Pipeline](docs/ci-cd.md)
- [Changelog](CHANGELOG.md)

## Architectural Change Control

Explicit approval is required before changing the command registry model, durable job/worker architecture, one-active-run policy, staging safeguards, auth/RBAC model, artifact/evidence compatibility model, evidence path security, persistence provider contract, report serving model, scheduler producer-only boundary, or Notification Outbox boundary.
