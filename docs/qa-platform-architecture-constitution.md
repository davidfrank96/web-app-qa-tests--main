# QA Platform Architecture Constitution

Last updated: 2026-06-11

This document is the governing architecture source of truth for the QA Platform. It exists to prevent architecture drift and to guide future development by humans and Codex agents.

Any future change that conflicts with this document must be treated as an architectural change and requires explicit approval before implementation.

## 1. Platform Mission

The QA Platform is a reusable QA and Security Operations Platform for hosted web applications.

Supported products:

- INSSA
- Localman
- KBean products
- future products added through the same architecture

Current focus:

- INSSA staging

The platform exists to:

- execute QA campaigns
- execute security campaigns
- execute lifecycle validation
- execute artifact-driven validation
- generate durable evidence
- generate human-readable reports
- export metadata to SIEM
- support operational review

The platform does not exist primarily to:

- generate reports
- generate dashboards
- send SIEM data
- act as a generic shell runner
- replace Playwright
- replace product source-code test suites
- become a SIEM system

Reports, dashboards, and SIEM exports are outputs. Testing and validation are the core purpose.

This distinction is mandatory. Future work must preserve a testing-first architecture.

## 2. Core Architecture

Canonical flow:

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

### Playwright Tests

Playwright tests are the browser automation and validation layer.

Responsibilities:

- exercise hosted products as black-box users
- validate user flows
- validate security/access-control behavior
- capture screenshots, traces, videos, and test output
- fail when product behavior violates expected lifecycle/security behavior

Playwright tests are not the dashboard. They must remain runnable from CLI and campaign runners.

### Campaign Runners

Campaign runners orchestrate one or more Playwright tests and post-processing steps.

Responsibilities:

- run a focused validation campaign
- preserve one logical campaign boundary
- pass artifacts to downstream validation
- classify campaign outcomes
- generate summaries
- stop on true lifecycle/security failures
- continue on explicitly classified warnings

Campaign runners are the operational unit of execution. The dashboard may trigger them, but must not replace them.

### Artifacts

Artifacts are durable evidence produced by tests and campaign runners.

Examples:

- lifecycle creation JSON
- security finding JSON
- campaign summaries
- Playwright reports
- cleanup evidence
- SIEM exports

Artifacts are the source of truth. Reports and dashboards are derived views.

### Reports

Reports convert artifacts and findings into human-readable form.

Responsibilities:

- summarize findings
- link evidence
- explain risk
- support engineering/security review

Reports must not become the canonical data source. If a report conflicts with a JSON artifact or campaign summary, the artifact wins.

### SIEM Export

SIEM export converts campaign/artifact metadata into normalized security and operations events.

Responsibilities:

- produce metadata-only events
- avoid screenshots/videos/traces
- avoid unredacted tokens/secrets
- support Wazuh ingestion and alerting

SIEM export is an output layer, not the core product.

### Wazuh

Wazuh receives normalized metadata events and provides:

- decoder/rule evaluation
- alerting
- operational dashboards
- historical review

Wazuh does not own QA campaign execution or source-of-truth artifacts.

### Dashboard

The dashboard is a thin operations layer on top of the architecture.

Responsibilities:

- display campaign definitions
- execute approved commands
- show run history
- show logs
- show artifact metadata
- open allowlisted reports
- display diagnostics

The dashboard must never replace the underlying campaign architecture.

## 3. Product Model

The platform has five primary product concepts. They must remain separate.

### Campaigns Execute Tests

Campaigns run Playwright and/or campaign scripts. They produce fresh evidence.

Examples:

- safe regression campaign
- security campaign
- lifecycle campaign
- security verification campaign

### Artifact Validation Consumes Existing Evidence

Artifact Validation runs read-only checks against a selected artifact from a previous lifecycle run.

Artifact Validation must not silently create new product data.

Examples:

- authenticated discovery
- public share validation
- cleanup capability audit

### Reports Review Evidence

Reports render or display existing evidence.

Report actions must not be described as test execution.

Examples:

- re-render latest security report
- re-render latest lifecycle report
- open Playwright report

### SIEM Exports Metadata

SIEM actions transform existing evidence into normalized metadata events.

SIEM actions must not become the primary validation workflow.

### Operations Manages Platform Health

Operations checks the platform itself.

Examples:

- healthcheck
- metadata backend status
- API failure visibility
- run/log/artifact counts

Operations is not product QA coverage.

## 4. Current INSSA Scope

The current product focus is INSSA staging:

```text
https://staging.inssa.us
```

Production INSSA testing is blocked for live mutation/security lifecycle workflows:

```text
https://inssa.us
https://www.inssa.us
```

Current INSSA dashboard scope:

- Safe Tests
- Security Campaigns
- Security Verification
- Artifact Validation
- Reports
- SIEM Export
- Operations

Current dashboard alignment:

| Section | Purpose | Current State |
| --- | --- | --- |
| Overview | Operational summary | Exposed |
| Safe Tests | Non-mutating baseline | Exposed and executable |
| Security | Read-only security campaign and verification | Exposed and executable |
| Lifecycle | Live lifecycle orientation | Visible but disabled |
| Artifact Validation | Existing-artifact validation | Exposed and executable with artifact selection |
| Reports | Evidence review | Exposed |
| SIEM | Metadata export | Export exposed; send disabled |
| Operations | Platform health and diagnostics | Exposed |

Current executable dashboard commands:

- `test:inssa:safe`
- `test:inssa:campaign:security`
- `test:inssa:campaign:security:verify`
- `test:inssa:discovery`
- `test:inssa:public-share`
- `test:inssa:cleanup-audit`
- `report:security`
- `report:lifecycle`
- `siem:export`
- `platform:healthcheck`

Current visible but disabled dashboard commands:

- text lifecycle
- media lifecycle
- video lifecycle
- reveal-later lifecycle
- cross-user campaign
- reveal-later security
- SIEM send

## 5. Lifecycle Philosophy

Lifecycle campaigns validate real product lifecycle behavior.

INSSA lifecycle campaign families:

- Text Lifecycle
- Media Lifecycle
- Video Lifecycle
- Reveal-Later Lifecycle

These commands create staging data.

They require:

- staging-only execution
- explicit approval workflow
- manual cleanup responsibility
- one controlled lifecycle per run
- no production execution
- no uncontrolled retry around irreversible final actions
- durable cleanup evidence

Lifecycle commands must not be casually exposed.

Before a lifecycle command is exposed in the dashboard, the platform must provide:

- clear mutation warning
- environment confirmation
- exact command preview
- cleanup responsibility acknowledgement
- run exclusivity
- artifact path after creation
- post-run cleanup target summary

The platform must not expose a broad live-staging mega-runner as a primary dashboard workflow. Focused lifecycle campaigns are the correct unit.

## 6. Security Philosophy

Security campaigns validate product security behavior through black-box testing.

Security campaign families:

- Security Campaign
- Security Verification
- Cross User
- Reveal-Later Security

### Security Campaign

Purpose:

- OWASP-aligned black-box validation
- access-control checks
- authentication/session checks
- token behavior checks
- media access checks
- security header checks
- safe input probes when explicitly enabled

This campaign should generate findings and reports from observed behavior.

### Security Verification

Purpose:

- verify known findings
- distinguish confirmed vs suspected findings
- consume existing lifecycle/security artifacts
- avoid creating new staging data by default

### Cross User

Purpose:

- validate user isolation
- validate expected sharing
- validate unauthorized visibility

Because cross-user workflows can create or depend on live staging data, dashboard execution requires explicit approval workflow before enablement.

### Reveal-Later Security

Purpose:

- validate pre-reveal protection
- validate post-reveal behavior
- classify reveal-bypass risks

Reveal-later flows can depend on scheduled time and may require lifecycle artifact creation/resume semantics. Dashboard execution must remain disabled until those semantics are explicit.

### Risk Classifications

Common security classifications:

- expected
- informational
- warning
- high-risk
- critical

Common lifecycle/security finding classifications:

- token-required
- token-optional
- public-by-id
- public-by-design
- unauthorized-visible
- expected-share-access
- reveal-protected
- reveal-bypass-risk
- media-publicly-accessible
- media-token-protected
- share-link-only-visibility
- delayed-indexing

Hard failure examples:

- confirmed authentication bypass
- confirmed unauthorized visibility where isolation is expected
- confirmed sensitive data exposure
- public-share validation failure when public-share access is required
- missing lifecycle success evidence for validation that depends on lifecycle success

Warning examples:

- known product visibility behavior that remains retrievable through an approved route
- share-link-only visibility
- delayed indexing
- video retrieval inconsistency when public-share validation has passed and authenticated indexing exists

## 7. Artifact Philosophy

Artifacts are the source of truth.

The platform should preserve:

- lifecycle artifacts
- campaign summaries
- security findings
- cleanup evidence
- SIEM export payloads
- report references

Reports are derived views. Dashboards are operational views. Neither should replace artifacts.

Artifact principles:

- Preserve original JSON artifacts.
- Preserve stable run IDs.
- Preserve exact subject/message/capsule IDs when available.
- Preserve cleanup instructions.
- Do not depend on Playwright transient `test-results/` alone for lifecycle persistence.
- Do not store secrets in artifacts.
- Do not expose sensitive artifacts casually.
- Do not send screenshots/videos/traces to SIEM.

Dashboard artifact rules:

- index metadata only
- do not move files
- do not rewrite files
- serve only allowlisted report/SIEM files
- block path traversal
- block unknown roots
- block sensitive evidence by default

If future storage is added, it must preserve artifact identity and traceability.

## 8. SIEM Philosophy

SIEM is an output layer.

The platform must not become SIEM-centric.

Correct flow:

```text
Campaign
↓
Artifacts
↓
Reports
↓
SIEM Export
↓
Wazuh
```

Incorrect flow:

```text
Wazuh
↓
Dashboard
↓
Testing decisions
```

SIEM should receive normalized evidence after campaigns run. SIEM dashboards and alerts help operations review findings, but they do not determine what the QA platform is.

SIEM constraints:

- metadata only
- no screenshots
- no videos
- no traces
- no unredacted tokens
- no raw credentials
- clear classification and severity mapping
- explicit send confirmation before dashboard send is enabled

Dashboard SIEM send must remain disabled until:

- endpoint preview exists
- dry-run preview exists
- payload summary exists
- operator confirmation exists
- failure reporting exists

## 9. Dashboard Rules

The dashboard may:

- execute approved commands
- display campaign definitions
- display run history
- display logs
- display artifact metadata
- display reports
- display diagnostics
- generate SIEM exports

The dashboard must not:

- replace campaign logic
- replace Playwright
- replace artifact generation
- replace report generation
- execute arbitrary commands
- bypass environment guards
- bypass RBAC
- expose live mutation commands casually
- silently create staging data
- treat reports as source-of-truth data
- expose sensitive raw artifacts without explicit policy

The dashboard is an operator console, not the QA engine.

## 10. Protected Architecture

The following require explicit approval before changing:

- runner architecture
- command registry model
- artifact indexing model
- report serving model
- auth/RBAC model
- staging-only safeguards
- one-active-run model
- lifecycle artifact selection model
- SIEM metadata-only policy
- production host blocking
- sensitive artifact serving restrictions
- campaign/report/artifact/SIEM separation

### Runner Architecture

Protected properties:

- whitelist-only execution
- `shell:false`
- timeout enforcement
- stdout/stderr capture
- log redaction
- one active run globally

### Command Registry Model

Protected properties:

- explicit command keys
- explicit npm scripts
- risk classification
- mutation flag
- phase enablement flag
- artifact requirement flag

### Artifact Indexing Model

Protected properties:

- metadata-only indexing
- known output roots
- deterministic classification
- sensitive flag
- sha256 capture

### Report Serving Model

Protected properties:

- artifact-id based file resolution
- allowlisted roots
- allowlisted artifact types
- sensitive artifact block
- path traversal block

### Auth/RBAC Model

Protected properties:

- authenticated UI/API
- server-side role checks
- viewer/operator/admin semantics
- role violation audit events

### Staging-Only Safeguards

Protected properties:

- `INSSA_URL=https://staging.inssa.us`
- production host block
- no user-supplied target URLs for command execution

### One-Active-Run Model

Protected properties:

- no concurrent dashboard runs
- no run queue in V1
- no parallel live mutation execution

## 11. Development Principles

Before implementing any feature:

1. Determine where it belongs:
   - Campaigns
   - Lifecycle
   - Security
   - Artifact Validation
   - Reports
   - SIEM
   - Operations
2. Verify it aligns with the platform mission.
3. Prefer extending existing architecture over creating new systems.
4. Avoid dashboard-first design.
5. Preserve testing-first architecture.
6. Preserve source-of-truth artifacts.
7. Keep reports derived.
8. Keep SIEM as output.
9. Keep live mutation commands gated.
10. Keep production blocked.

Implementation guidance:

- If a feature executes tests, it belongs in Campaigns, Lifecycle, Security, or Artifact Validation.
- If a feature only displays evidence, it belongs in Reports or Operations.
- If a feature emits Wazuh payloads, it belongs in SIEM.
- If a feature manages platform health, it belongs in Operations.
- If a feature creates staging data, it requires explicit approval workflow before dashboard exposure.
- If a feature needs new shell execution, it must be added to the command registry and reviewed.

Anti-patterns:

- adding a dashboard button that shells out to arbitrary commands
- making report generation look like test execution
- using Wazuh as the source of truth for findings
- deriving lifecycle state from HTML reports instead of artifacts
- enabling live mutation commands without cleanup acknowledgement
- weakening staging-only guards for convenience
- hiding product findings by downgrading assertions without classification

## 12. Current Roadmap

### Phase A: Read-Only V1

Status: current.

Scope:

- safe suite
- security campaign
- security verification
- artifact validation
- report archive
- SIEM export
- platform healthcheck
- run history
- logs
- artifact metadata
- diagnostics

### Phase B: Controlled Lifecycle Execution

Status: future.

Scope:

- approval workflow
- cleanup acknowledgement
- one lifecycle campaign at a time
- exact staging environment confirmation
- cleanup target display
- start with text lifecycle only

### Phase C: Cross-User And Reveal-Later Execution

Status: future.

Scope:

- secondary user validation
- reveal-later artifact resume/creation clarity
- pre/post reveal checks
- stronger cleanup evidence
- no broad mutation runner

### Phase D: SIEM Send Workflow

Status: future.

Scope:

- endpoint preview
- dry-run
- payload summary
- explicit send confirmation
- send result capture
- failure diagnostics

### Phase E: Deployment And Operations Maturity

Status: future.

Scope:

- hosted deployment runbook
- Supabase metadata migrations
- artifact retention policy
- object storage if needed
- scheduled safe/read-only runs
- notification integration
- multi-product support

## Change Evaluation Checklist

Before approving a change, ask:

- Does this preserve testing as the core purpose?
- Does this preserve campaign/report/artifact/SIEM separation?
- Does this preserve artifacts as source of truth?
- Does this preserve staging-only protections?
- Does this preserve RBAC and server-side enforcement?
- Does this introduce new mutation risk?
- Does this expose a command that is not in the registry?
- Does this make dashboard behavior diverge from CLI behavior?
- Does this create or send evidence without operator visibility?
- Does this require updates to the command matrix, V1 definition, or current-state docs?

If the answer to any risk question is yes, stop and get explicit approval before implementing.

