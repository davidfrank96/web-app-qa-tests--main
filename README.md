# QA Platform

Reusable Playwright QA and Security Operations Platform for hosted web applications.

Current product focus:

```text
INSSA staging: https://staging.inssa.us
```

Supported product families:

- INSSA: current operational focus.
- Localman: supported by the repo, future dashboard expansion.
- KBean products: supported by the repo, future dashboard expansion.
- Future products: must follow the same campaign/artifact/report/SIEM architecture.

This repo is not the INSSA application source repo. It has no INSSA backend, database, cloud, or production access.

## Platform Mission

The platform exists to:

- execute QA campaigns
- execute security campaigns
- execute lifecycle validation
- execute artifact-driven validation
- generate durable evidence
- generate reports from evidence
- export metadata to SIEM
- support operational review

The platform does not exist primarily to generate reports, generate dashboards, or send SIEM data. Those are outputs. Testing and validation are the core purpose.

## Core Architecture

```text
Playwright Tests
↓
Campaign Runners
↓
Artifacts
↓
Reports
↓
SIEM Export
↓
Wazuh
```

| Layer | Responsibility |
| --- | --- |
| Playwright Tests | Exercise hosted products as black-box users and validate behavior. |
| Campaign Runners | Orchestrate focused QA/security/lifecycle workflows. |
| Artifacts | Preserve source-of-truth evidence. |
| Reports | Render human-readable views from artifacts/findings. |
| SIEM Export | Normalize metadata-only events for security operations. |
| Wazuh | Ingest metadata, apply rules, show dashboards, and route alerts. |

The dashboard is a thin operations layer over this architecture. It must not replace Playwright, campaign runners, artifact generation, report generation, or SIEM normalization.

## Product Model

| Concept | Meaning | Must Not Be Confused With |
| --- | --- | --- |
| Campaigns | Execute tests and produce fresh evidence. | Reports. |
| Artifact Validation | Consumes existing lifecycle evidence. | Live capsule creation. |
| Reports | Review generated evidence. | Test execution. |
| SIEM | Exports metadata to Wazuh. | Source-of-truth storage. |
| Operations | Manages platform health and diagnostics. | Product QA coverage. |

These concepts must remain separate. See [QA Platform Architecture Constitution](docs/qa-platform-architecture-constitution.md).

## Current Dashboard Structure

The local Operations Dashboard lives in `dashboard/`.

Sections:

- Overview
- Safe Tests
- Security
- Lifecycle
- Artifact Validation
- Reports
- SIEM
- Operations
- Run History
- Run Details

Current dashboard source-of-truth docs:

- [INSSA Platform Current State](docs/inssa-platform-current-state.md)
- [INSSA Dashboard Architecture](docs/inssa-dashboard-architecture.md)
- [INSSA V1 Definition](docs/inssa-v1-definition.md)
- [INSSA Command Matrix](docs/inssa-command-matrix.md)
- [INSSA Dashboard Decisions](docs/inssa-dashboard-decisions.md)
- [INSSA Dashboard Roadmap](docs/inssa-dashboard-roadmap.md)
- [INSSA Platform Handoff 2026](docs/inssa-platform-handoff-2026.md)

## Current V1 Scope

Implemented in the dashboard:

- Supabase Auth-protected UI and APIs.
- Server-side RBAC with `viewer`, `operator`, and `admin`.
- Whitelisted command registry.
- One active run globally.
- Run history.
- Live logs.
- Artifact metadata indexing.
- Report archive.
- Authenticated report serving for allowlisted report roots.
- Safe INSSA suite execution.
- Security campaign execution.
- Security verification execution.
- Artifact Validation commands with lifecycle artifact selection.
- Security and lifecycle report re-rendering.
- SIEM metadata export.
- Platform healthcheck.
- Metadata backend diagnostics.
- API failure visibility.

Currently gated or disabled:

- live text lifecycle execution from dashboard
- live media lifecycle execution from dashboard
- live video lifecycle execution from dashboard
- reveal-later lifecycle execution from dashboard
- cross-user campaign execution from dashboard
- reveal-later security execution from dashboard
- SIEM send from dashboard
- broad live-staging mega-runner
- arbitrary command execution
- screenshot/video/trace serving
- scheduling
- automatic cleanup

## Safety Rules

- INSSA dashboard command execution requires `INSSA_URL=https://staging.inssa.us`.
- Production hosts `inssa.us` and `www.inssa.us` are blocked.
- Live lifecycle campaigns create staging data and require manual cleanup.
- Dashboard execution is whitelist-only.
- Runner uses `shell:false`.
- Only one dashboard run may be active.
- Artifact Validation must consume selected lifecycle evidence.
- Reports are derived views, not source-of-truth evidence.
- SIEM payloads are metadata-only.

## Quick Start

Install dependencies and browsers:

```bash
npm install
npm run install:browsers
```

Run safe INSSA tests from CLI:

```bash
npm run test:inssa:safe
```

Run dashboard locally:

```bash
npm run dashboard:dev
```

Build dashboard:

```bash
npm run dashboard:build
```

Run platform healthcheck:

```bash
npm run platform:healthcheck
```

## Environment

Never commit real credentials.

Important variables:

| Variable | Purpose |
| --- | --- |
| `INSSA_URL=https://staging.inssa.us` | Required dashboard/campaign target for INSSA. |
| `INSSA_TEST_EMAIL` | Primary INSSA QA account. |
| `INSSA_TEST_PASSWORD` | Primary INSSA QA password. |
| `INSSA_SECONDARY_TEST_EMAIL` | Secondary QA account for cross-user validation. |
| `INSSA_SECONDARY_TEST_PASSWORD` | Secondary QA password. |
| `INSSA_ENABLE_LIVE_CAPSULE_TESTS=1` | Enables live capsule tests from CLI/campaigns. |
| `INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1` | Acknowledges manual cleanup responsibility. |
| `INSSA_ENABLE_MEDIA_CAPSULE_TESTS=1` | Enables media live capsule tests. |
| `INSSA_ENABLE_VIDEO_CAPSULE_TESTS=1` | Enables video live capsule tests. |
| `INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS=1` | Enables reveal-later live capsule tests. |
| `INSSA_ENABLE_MUTATION_TESTS=1` | Enables draft mutation tests. |
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard browser Supabase URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard browser Supabase key. |
| `SUPABASE_URL` | Server-side Supabase URL fallback. |
| `SUPABASE_ANON_KEY` | Server-side anon key fallback. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional service-role key for metadata operations. |
| `INSSA_OPS_ADMIN_EMAILS` | Comma-separated admin role fallback. |
| `INSSA_OPS_OPERATOR_EMAILS` | Comma-separated operator role fallback. |
| `INSSA_OPS_VIEWER_EMAILS` | Comma-separated viewer role fallback. |
| `SIEM_WAZUH_URL` | Wazuh ingestion endpoint for CLI send. |

## Command Matrix

| Command | Purpose | Mutates Staging | Risk | Outputs | Dashboard Exposure |
| --- | --- | --- | --- | --- | --- |
| `npm run test` | Run Playwright default suite. | Mixed | mixed | Playwright output | Hidden |
| `npm run test:localman` | Run Localman Playwright project. | Product-specific | mixed | Playwright output | Hidden |
| `npm run test:kbean` | Run KBean Playwright project. | Product-specific | mixed | Playwright output | Hidden |
| `npm run test:inssa` | Run all INSSA tests under project config. | Possible | mixed | Playwright output | Hidden |
| `npm run test:inssa:safe` | Run non-mutating INSSA safe suite. | No | safe | Playwright report, test results | Executable |
| `npm run test:inssa:live-staging` | Broad sequential live staging runner. | Yes | broad live mutation | Lifecycle artifacts/reports | Hidden; do not expose as primary workflow |
| `npm run test:inssa:live-text` | Raw text live capsule create spec. | Yes | live mutation | Lifecycle artifact/screenshot | Hidden |
| `npm run test:inssa:live-media` | Raw media live capsule create spec. | Yes | live mutation | Lifecycle artifact/screenshot | Hidden |
| `npm run test:inssa:live-video` | Raw video live capsule create spec. | Yes | live mutation | Lifecycle artifact/screenshot | Hidden |
| `npm run test:inssa:reveal-later` | Raw reveal-later live capsule create spec. | Yes | live mutation | Lifecycle artifact/screenshot | Hidden |
| `npm run test:inssa:discovery` | Authenticated discovery using existing artifact. | No | read-only | Playwright report, validation evidence | Executable with artifact |
| `npm run test:inssa:public-share` | Public/tokenized/tokenless share validation using artifact. | No | read-only | Playwright report, validation evidence | Executable with artifact |
| `npm run test:inssa:cleanup-audit` | Cleanup capability audit using artifact; no destructive action. | No | read-only | Cleanup evidence | Executable with artifact |
| `npm run test:inssa:draft-mutations` | Draft mutation tests. | Yes | mutation | Playwright report | Hidden |
| `npm run test:inssa:campaign:text` | Text lifecycle campaign. | Yes | live mutation | Lifecycle campaign summary/report | Visible disabled |
| `npm run test:inssa:campaign:media` | Media lifecycle campaign. | Yes | live mutation | Lifecycle campaign summary/report | Visible disabled |
| `npm run test:inssa:campaign:video` | Video lifecycle campaign. | Yes | live mutation | Lifecycle campaign summary/report | Visible disabled |
| `npm run test:inssa:campaign:reveal-later` | Reveal-later lifecycle campaign. | Yes | live mutation | Lifecycle campaign summary/report | Visible disabled |
| `npm run test:inssa:campaign:security` | OWASP-aligned security campaign. | No by default | read-only | Security findings, reports | Executable |
| `npm run test:inssa:campaign:security:verify` | Verify known findings from existing evidence. | No | read-only | Verification findings/report | Executable |
| `npm run test:inssa:campaign:cross-user` | Cross-user access-control campaign. | Yes | live mutation | Cross-user security evidence | Visible disabled |
| `npm run test:inssa:campaign:reveal-later-security` | Reveal-later access-control validation. | Possible | conditional mutation | Reveal-later security evidence | Visible disabled |
| `npm run test:inssa:campaign:security:siem` | Security campaign plus SIEM wrapper. | No by default | external transmission | Campaign outputs and SIEM export/send | Hidden |
| `npm run test:inssa:campaign:cross-user:siem` | Cross-user campaign plus SIEM wrapper. | Yes | live mutation/external transmission | Campaign outputs and SIEM export/send | Hidden |
| `npm run test:inssa:campaign:reveal-later:siem` | Reveal-later security plus SIEM wrapper. | Possible | conditional mutation/external transmission | Campaign outputs and SIEM export/send | Hidden |
| `npm run platform:healthcheck` | Validate local platform wiring. | No | read-only | Healthcheck logs/artifact metadata | Admin executable |
| `npm run report:show` | Open Playwright report. | No | read-only | Browser report viewer | CLI only |
| `npm run report:open` | Open Playwright report. | No | read-only | Browser report viewer | CLI only |
| `npm run report:security` | Re-render security HTML report from existing findings. | No | read-only | `reports/security/` HTML | Executable report tool |
| `npm run report:lifecycle` | Re-render lifecycle HTML report from existing evidence. | No | read-only | `reports/lifecycle/` HTML | Executable report tool |
| `npm run siem:export` | Generate metadata-only SIEM export. | No | read-only | `reports/siem/latest-siem-export.json` | Executable |
| `npm run siem:send` | Send SIEM export to Wazuh endpoint. | No | external transmission | Wazuh events | Visible disabled |
| `npm run dashboard:dev` | Run dashboard in dev mode. | No | operations | Local dashboard server | CLI only |
| `npm run dashboard:build` | Build dashboard. | No | operations | `.next` build output | CLI only |
| `npm run dashboard:start` | Start built dashboard. | No | operations | Local dashboard server | CLI only |

## Artifact Validation Framework

Artifact Validation is a first-class platform capability.

Purpose:

- validate lifecycle visibility and cleanup behavior without creating new capsules
- consume existing lifecycle artifacts
- support repeatable verification from evidence

Artifact Validation commands:

| Workflow | Command | What It Checks |
| --- | --- | --- |
| Authenticated Discovery | `npm run test:inssa:discovery` | Direct authenticated retrieval, feed/search/profile/messages visibility. |
| Public Share Validation | `npm run test:inssa:public-share` | Tokenized, tokenless, logged-out, and authenticated public-share routes. |
| Cleanup Capability Audit | `npm run test:inssa:cleanup-audit` | Whether owner cleanup controls exist; no delete/archive/unpublish action. |

Selection model:

- explicit lifecycle artifact path, or
- latest validation-ready lifecycle artifact.

Validation-ready artifact requirements:

- `observedCreateSuccess=true`
- and at least one retrieval/share identifier such as final share link, capsule ID, or share token.

Dashboard behavior:

- shows artifact path
- shows artifact type
- shows artifact timestamp
- blocks execution if no usable artifact exists

Artifact Validation must not create capsules.

## Artifacts And Reports

Source-of-truth artifact roots:

- `lifecycle-artifacts/`
- `lifecycle-campaigns/`
- `security-campaigns/`
- `test-results/`
- `playwright-report/`
- `reports/security/`
- `reports/lifecycle/`
- `reports/siem/`

Report roots:

- `reports/security/`
- `reports/lifecycle/`
- `reports/siem/`
- `playwright-report/`

The dashboard serves only allowlisted report files through artifact metadata. Screenshots, videos, traces, lifecycle JSON, and sensitive evidence are not served in V1.

## SIEM And Wazuh

SIEM flow:

```text
Campaign artifacts
-> npm run siem:export
-> reports/siem/latest-siem-export.json
-> npm run siem:send
-> Wazuh ingestion API
-> /var/ossec/logs/inssa-qa.log
-> Wazuh decoder/rules
-> dashboards/alerts
```

Dashboard status:

- SIEM export is executable.
- SIEM send is disabled until endpoint preview, dry-run, and explicit confirmation exist.

References:

- [SIEM Architecture](docs/inssa-siem-architecture.md)
- [Wazuh Ingestion](docs/wazuh-inssa-ingestion.md)
- [Wazuh Decoder](docs/wazuh-inssa-decoder.md)
- [Wazuh Rules](docs/wazuh-inssa-rules.md)

## Future Phases

| Phase | Scope | Status |
| --- | --- | --- |
| Phase A | Read-only V1: safe tests, security, artifact validation, reports, SIEM export, operations. | Current |
| Phase B | Controlled lifecycle execution with approval and cleanup workflow. | Future |
| Phase C | Cross-user and reveal-later dashboard execution. | Future |
| Phase D | SIEM send workflow with preview/dry-run/confirmation. | Future |
| Phase E | Deployment maturity, scheduling, retention, object storage, multi-product support. | Future |

## Key Documentation

| Document | Purpose |
| --- | --- |
| [Architecture Constitution](docs/qa-platform-architecture-constitution.md) | Governing architecture principles. |
| [Current State](docs/inssa-platform-current-state.md) | Current implemented platform state. |
| [Dashboard Architecture](docs/inssa-dashboard-architecture.md) | Dashboard/API/runner/artifact architecture. |
| [Command Matrix](docs/inssa-command-matrix.md) | Command exposure, risk, outputs, and phase. |
| [V1 Definition](docs/inssa-v1-definition.md) | Approved V1 scope and non-goals. |
| [Dashboard Decisions](docs/inssa-dashboard-decisions.md) | Architectural decisions already made. |
| [Dashboard Roadmap](docs/inssa-dashboard-roadmap.md) | Phase A/B/C roadmap. |
| [Platform Handoff 2026](docs/inssa-platform-handoff-2026.md) | Future engineer handoff. |
| [Documentation Audit](docs/inssa-documentation-audit.md) | Freshness classification for existing docs. |
| [Security Findings](docs/inssa-security-findings.md) | Security finding records. |
| [Risk Matrix](docs/inssa-risk-matrix.md) | Risk and priority matrix. |
| [Live Staging Lifecycle](docs/inssa-live-staging-lifecycle.md) | Lifecycle runner behavior. |
| [Security Campaign](docs/inssa-security-campaign.md) | OWASP campaign architecture. |
| [Product Behavior Audit](docs/inssa-product-behavior-audit.md) | Black-box staging behavior map. |

## Troubleshooting

| Problem | First Check |
| --- | --- |
| Dashboard cannot start | `npm run dashboard:build`, then check `.env.local`. |
| Login unavailable | Confirm Supabase public URL/key env values. |
| User role wrong | Check Supabase `app_metadata.inssa_ops_role` and `INSSA_OPS_*_EMAILS`. |
| Run rejected | Confirm command is in registry and `INSSA_URL=https://staging.inssa.us`. |
| Artifact Validation blocked | Confirm `lifecycle-artifacts/` contains a validation-ready artifact. |
| Report will not open | Confirm artifact type/root is allowlisted and not sensitive. |
| SIEM export empty | Confirm campaign outputs exist under `security-campaigns/` or `lifecycle-campaigns/`. |
| Live test skipped | Confirm live flags in `.env.inssa.live-staging`. |

## Release Rule

Before changing architecture, read [QA Platform Architecture Constitution](docs/qa-platform-architecture-constitution.md). If a change affects the runner, command registry, staging-only safeguards, artifact indexing, report serving, auth/RBAC, or one-active-run model, get explicit approval first.
