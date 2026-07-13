# Dashboard Authentication Completion Report

Date: 2026-07-13

Sprint: Dashboard Authentication Completion

Verdict: PASS WITH WARNINGS

## Executive Summary

The existing Supabase-backed dashboard authentication flow was validated end-to-end with dedicated validation users for all three roles:

- Viewer
- Operator
- Admin

The Operator role successfully executed the INSSA Safe Suite through the dashboard. The resulting run produced logs, artifacts, a Playwright report, and evidence bundle metadata. Authenticated Evidence Bundle serving was validated byte-for-byte against the local Playwright report bundle, including trace viewer assets.

One small serving compatibility fix was required: the Playwright report compatibility route now uses a same-origin relative redirect so cookies are preserved when accessing the dashboard through `127.0.0.1`.

## Environment Configuration

Configured env file:

```text
dashboard/.env.local
```

Supabase configuration:

| Variable | Status |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | present |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | present |
| `SUPABASE_URL` | present |
| `SUPABASE_ANON_KEY` | present |
| `SUPABASE_SERVICE_ROLE_KEY` | present |

Configured project ref:

```text
qdrhzdulhlkjhckosdrv
```

No secret values are included in this report.

## User Audit

Initial Supabase Auth audit found:

| Role | Initial Status |
| --- | --- |
| Viewer | present through fallback behavior |
| Operator | missing |
| Admin | present |

Dedicated validation users were created or updated in Supabase Auth for this sprint. Passwords were generated and stored only in:

```text
/private/tmp/inssa-dashboard-auth-validation.json
```

That file is outside the repository.

Validation users:

| Role | Email | Role Source | Login |
| --- | --- | --- | --- |
| Viewer | `inssa-ops-validation-viewer-20260713@example.test` | fallback viewer | PASS |
| Operator | `inssa-ops-validation-operator-20260713@example.test` | `app_metadata.inssa_ops_role` | PASS |
| Admin | `inssa-ops-validation-admin-20260713@example.test` | `app_metadata.inssa_ops_role` | PASS |

## Role Validation

| Check | Result |
| --- | --- |
| Viewer can authenticate | PASS |
| Viewer can read runs | PASS |
| Viewer cannot start Safe Suite | PASS, `403` |
| Operator can authenticate | PASS |
| Operator can read runs | PASS |
| Operator can start Safe Suite | PASS, `202` |
| Admin can authenticate | PASS |
| Admin can read runs | PASS |
| Admin can start Platform Health Check | PASS, `202` |
| Fallback viewer behavior | PASS |
| `app_metadata.inssa_ops_role` behavior | PASS |

Environment allowlist behavior was verified by code path review. The current runtime validation users use fallback and `app_metadata` role sources.

## Dashboard Workspace Validation

All roles loaded the dashboard after authentication with no bad responses after a clean runtime restart.

Validated sections:

| Section | Viewer | Operator | Admin |
| --- | --- | --- | --- |
| Overview | PASS | PASS | PASS |
| Testing | PASS | PASS | PASS |
| Security | PASS | PASS | PASS |
| Lifecycle | PASS | PASS | PASS |
| Artifact Validation | PASS | PASS | PASS |
| Reports | PASS | PASS | PASS |
| SIEM | PASS | PASS | PASS |
| Operations | PASS | PASS | PASS |
| Runs | PASS | PASS | PASS |

Screenshots:

```text
outputs/auth-validation/viewer-dashboard.png
outputs/auth-validation/operator-dashboard.png
outputs/auth-validation/admin-dashboard.png
```

## Command Validation

### INSSA Safe Suite

Started by: Operator

Run ID:

```text
d13b3d16-0f7c-4b44-9ae8-35f05a78c110
```

Result:

| Field | Value |
| --- | --- |
| Status | `passed_with_warnings` |
| Exit code | `0` |
| Duration | `80628 ms` |
| Logs | `129` |
| Artifacts | `26` |
| Evidence bundles | `1` |
| Evidence items | `26` |
| Playwright report artifact | `d72ae251-0400-403a-a09e-f6f79da641f1` |

### Platform Health Check

Started by: Admin

Run ID:

```text
ddfce6ae-e4c4-4a0e-99f7-dcc022b09bc9
```

Result:

| Field | Value |
| --- | --- |
| Status | `passed_with_warnings` |
| Exit code | `0` |
| Duration | `1791 ms` |

### Lifecycle Report Render

Started by: Operator

Run ID:

```text
517b7a10-4954-4d58-bcd5-e12abd98a64d
```

Result:

| Field | Value |
| --- | --- |
| Status | `passed` |
| Exit code | `0` |
| Duration | `597 ms` |

## Evidence Bundle Parity

Authenticated byte-for-byte validation compared every file under the current local `playwright-report/` bundle with the dashboard-served bundle route.

Representative route:

```text
/api/artifacts/d72ae251-0400-403a-a09e-f6f79da641f1/bundle/*
```

Result:

| Asset Class | Count | Status |
| --- | ---: | --- |
| HTML | 4 | PASS |
| CSS | 5 | PASS |
| JavaScript | 5 | PASS |
| PNG screenshot/image | 1 | PASS |
| Markdown error context | 1 | PASS |
| WebM video | 1 | PASS |
| Trace ZIP | 1 | PASS |
| SVG icon | 1 | PASS |
| Web manifest | 1 | PASS |
| Font | 1 | PASS |
| Total files | 21 | PASS |

All dashboard-served files returned `200`, had expected content types, matched local file sizes, and matched local SHA-256 hashes.

## Browser Evidence Validation

Authenticated browser validation loaded the dashboard-served Playwright report and local Playwright report.

Results:

| Check | Result |
| --- | --- |
| Dashboard report title | PASS |
| Local report title | PASS |
| Title parity | PASS |
| Body text sample parity | PASS |
| Report contains INSSA evidence | PASS |
| Search input interaction | PASS |
| Dashboard report network 4xx/5xx | PASS, none |
| Dashboard report console errors | PASS, none |
| Trace viewer opens | PASS |
| Trace ZIP loads | PASS |
| Trace viewer network 4xx/5xx | PASS, none |
| Trace viewer console errors | PASS, none |

Screenshots:

```text
outputs/auth-validation/dashboard-playwright-report.png
outputs/auth-validation/local-playwright-report.png
outputs/auth-validation/dashboard-trace-viewer.png
```

## Report Route Validation

Authenticated report routes:

| Artifact Type | Result |
| --- | --- |
| Playwright Report | PASS, `200 text/html; charset=utf-8` through bundle redirect |
| Security Report | PASS, `200 text/html` |
| Lifecycle Report | PASS, `200 text/html` |
| SIEM Export | PASS, `200 application/json` |

## Fix Applied

File:

```text
dashboard/app/api/artifacts/[id]/file/route.ts
```

Issue:

The Playwright report compatibility route redirected to an absolute URL that could switch `127.0.0.1` to `localhost`, causing authenticated cookies to be dropped in some local validation paths.

Fix:

Use a relative `Location` header:

```text
Location: /api/artifacts/:id/bundle/index.html
```

Impact:

Same-origin cookies are preserved. No architecture changes were made.

## Runtime Note

During validation, running `npm run dashboard:build` while `next dev` was active caused the known Next runtime chunk corruption:

```text
Cannot find module './543.js'
```

Resolution used:

```bash
npm run dashboard:clean
npm --prefix dashboard run dev -- -p 3101
```

After clean restart, dashboard UI validation passed for all roles.

## Regression Report

No changes were made to:

- Runner
- Playwright tests
- Campaign scripts
- Authentication design
- Authorization design
- RBAC model
- Command registry
- Evidence metadata model
- Evidence bundle model
- Report generation
- SIEM export
- Wazuh integration
- Runtime doctor
- Runtime clean

## Remaining Blockers

No authentication blockers remain for local dashboard validation.

Before moving to durable storage, decide whether to keep or remove the temporary validation users:

```text
inssa-ops-validation-viewer-20260713@example.test
inssa-ops-validation-operator-20260713@example.test
inssa-ops-validation-admin-20260713@example.test
```

## Exit Criteria

| Criterion | Status |
| --- | --- |
| Viewer login succeeds | PASS |
| Operator login succeeds | PASS |
| Admin login succeeds | PASS |
| Safe Suite executes through dashboard | PASS |
| Playwright report renders through Evidence Bundle | PASS |
| Trace viewer renders through Evidence Bundle | PASS |
| No unexplained auth failures remain | PASS |

The project is clear to proceed to Phase 3, Durable Evidence Storage, after the team decides whether the temporary validation users should remain.
