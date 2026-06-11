# INSSA QA Operations Platform V1 Definition

Last updated: 2026-06-11

V1 is the first complete usable version of the INSSA QA Operations Dashboard. It is intentionally read-only/safe-first and does not expose live mutation campaigns.

## V1 Goals

- Allow authenticated users to view the dashboard.
- Allow operators/admins to run safe/read-only commands.
- Track run history.
- Capture logs.
- Index artifacts.
- Open generated reports.
- Generate SIEM metadata exports.
- Validate existing lifecycle artifacts without creating new capsules.
- Surface diagnostics when APIs or metadata backends fail.

## V1 Sections

| Section | V1 Capability |
| --- | --- |
| Overview | Run counts and latest activity. |
| Safe Tests | Execute INSSA Safe Suite. |
| Security | Execute Security Campaign and Security Verification. |
| Lifecycle | Show live lifecycle commands as disabled future actions. |
| Artifact Validation | Execute authenticated discovery, public-share validation, and cleanup audit using selected artifacts. |
| Reports | Review Playwright, Security, Lifecycle, and SIEM report artifacts. |
| SIEM | Generate metadata-only export. |
| Operations | Run admin healthcheck and inspect metadata/API diagnostics. |
| Run History | View and filter runs. |
| Run Details | View status, logs, artifact metadata, and report links. |

## V1 In Scope

- Supabase Auth.
- Server-side RBAC.
- Command registry.
- Safe/read-only command execution.
- One active run.
- Local JSON metadata backend.
- Optional Supabase metadata backend detection/counts.
- Incremental run logs.
- Artifact indexing.
- Report file serving for allowlisted report files.
- Lifecycle artifact selection for validation commands.
- Metadata backend diagnostics.
- API failure visibility.

## V1 Out Of Scope

- Scheduling.
- Deployment automation.
- Live lifecycle command execution from dashboard.
- Text/media/video/reveal-later mutation campaigns from dashboard.
- Cross-user campaign execution from dashboard.
- Reveal-later security execution from dashboard if it can create/resume mutation flows.
- SIEM send from dashboard.
- Artifact downloads for screenshots/videos/traces.
- Automatic cleanup.
- Multi-product dashboard support.
- Findings workflow or triage management.
- Notification integrations.
- Object-storage artifact migration.
- Supabase migrations as the only supported metadata store.

## V1 Command Set

Executable:

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

Visible but disabled:

- `test:inssa:campaign:text`
- `test:inssa:campaign:media`
- `test:inssa:campaign:video`
- `test:inssa:campaign:reveal-later`
- `test:inssa:campaign:cross-user`
- `test:inssa:campaign:reveal-later-security`
- `siem:send`

Hidden:

- broad live staging runner
- raw live create commands
- draft mutation commands
- campaign-with-SIEM wrapper commands
- arbitrary npm commands

## V1 Acceptance Criteria

V1 is complete when:

- Anonymous users cannot access dashboard UI or APIs.
- Viewer can read runs/logs/artifacts/reports but cannot start runs.
- Operator can start safe/read-only commands except admin healthcheck.
- Admin can run healthcheck.
- `test:inssa:safe` completes through the dashboard.
- Security campaign and security verification are visible and executable.
- Artifact Validation requires artifact selection.
- Report archive is categorized and internally scrollable.
- SIEM export works and SIEM send remains disabled.
- Run History and Run Detail show diagnostics instead of silent empty states.

