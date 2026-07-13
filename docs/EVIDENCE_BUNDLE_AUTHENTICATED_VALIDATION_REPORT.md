# Evidence Bundle Authenticated Validation Report

Date: 2026-07-13

Sprint: Phase 2.6, Authenticated Evidence Validation

Verdict: BLOCKED

Reason: No valid authenticated dashboard Operator/Admin session was available. The dashboard correctly enforced authentication for evidence bundle routes, and the available password login attempt returned `401 Invalid email or password`.

## Scope

This phase was intended to prove that a dashboard-served Playwright report is visually and functionally identical to the local Playwright report in a real authenticated dashboard session.

No storage, retention, metadata redesign, runner changes, Playwright changes, report generation changes, or SIEM changes were made.

## Authenticated Session Validation

Target dashboard server:

```text
http://127.0.0.1:3101
```

Representative Playwright report artifact:

```text
398b0c29-606c-46b5-a0f2-59ae07bffec7
```

Results:

| Check | Result |
| --- | --- |
| Dashboard login page reachable | PASS |
| Supabase auth configured | PASS |
| Existing browser session authenticated | FAIL |
| API session authenticated | FAIL |
| Password login using available local env credentials | FAIL: `401 Invalid email or password` |
| Evidence bundle auth enforcement | PASS |
| Report permissions validated with viewer/operator/admin session | BLOCKED |
| Artifact permissions validated with viewer/operator/admin session | BLOCKED |

Screenshot evidence:

```text
outputs/evidence-phase-26-auth-required.png
```

## API And Network Findings

Unauthenticated API probes:

| Request | Status | Result |
| --- | ---: | --- |
| `GET /api/runs` | 401 | Authentication required |
| `GET /api/artifacts/:id/bundle/index.html` | 401 | Authentication required |
| `GET /api/artifacts/:id/bundle/data/<png>` | 401 | Authentication required |
| `GET /api/artifacts/:id/bundle/data/<md>` | 401 | Authentication required |
| `GET /api/artifacts/:id/file` | 401 | Authentication required |
| `GET /api/artifacts/:id/bundle/%2e%2e/package.json` | 404 | Traversal URL did not expose a file |
| `POST /api/auth/password` | 401 | Invalid email or password |

No evidence route returned `500`.

No unauthenticated evidence content was exposed.

## Real Campaign Execution

Required command:

```text
INSSA Safe Suite
```

Dashboard execution result: BLOCKED.

Reason: The dashboard requires an authenticated Operator/Admin session to start runs. Without a valid session, executing a fresh Safe Suite through the dashboard would require bypassing auth or modifying external Supabase users, both outside this sprint.

Local historical Playwright output exists, but Phase 2.6 requires a real authenticated dashboard run, so historical output was not accepted as a substitute for the acceptance criterion.

## Playwright Parity Matrix

| Evidence Area | Status | Notes |
| --- | --- | --- |
| Local Playwright report opens | NOT RUN | Would be local filesystem validation only |
| Dashboard Playwright report opens authenticated | BLOCKED | No dashboard session |
| HTML parity | BLOCKED | Requires authenticated report load |
| CSS parity | BLOCKED | Requires authenticated report load |
| JavaScript parity | BLOCKED | Requires authenticated report load |
| Images/screenshots parity | BLOCKED | Requires authenticated report load |
| Markdown/error context parity | BLOCKED | Requires authenticated report load |
| Trace viewer parity | N/A for current bundle | Current report has no trace ZIP |
| Videos parity | N/A for current bundle | Current report has no videos |
| Attachments parity | BLOCKED | Current bundle has data attachments but needs authenticated report load |
| Search | BLOCKED | Requires rendered dashboard report |
| Navigation/sidebar | BLOCKED | Requires rendered dashboard report |
| Expand/collapse | BLOCKED | Requires rendered dashboard report |
| Filtering | BLOCKED | Requires rendered dashboard report |
| Visual rendering | BLOCKED | Requires authenticated browser session |

## Evidence Bundle Validation Matrix

| Layer | Status | Evidence |
| --- | --- | --- |
| Evidence bundle route compiled | PASS | `npm run dashboard:build` includes `/api/artifacts/[id]/bundle/[[...relativePath]]` |
| Bundle route reachable | PASS | Unauthenticated requests returned route-level 401 |
| Bundle route auth enforced | PASS | No bundle content served without auth |
| PNG route reachable | PASS | Route-level 401 before content |
| Markdown route reachable | PASS | Route-level 401 before content |
| Legacy file route reachable | PASS | Route-level 401 before redirect/content |
| Authenticated asset MIME validation | BLOCKED | Requires valid session |
| Authenticated asset byte-for-byte validation | BLOCKED | Requires valid session |
| Browser rendered parity | BLOCKED | Requires valid session |

## Backward Compatibility

| Area | Result |
| --- | --- |
| `GET /api/artifacts/:id/file` | Preserved and auth-protected |
| `GET /api/artifacts/:id/bundle/*` | Present and auth-protected |
| `GET /api/runs/:id/artifacts` | Not modified in this sprint |
| Run history | Not modified in this sprint |
| Run detail | Not modified in this sprint |
| Report viewer | Not modified in this sprint |
| Runner | Not modified |
| Playwright tests | Not modified |
| Command registry | Not modified |
| SIEM export | Not modified |

## Files Modified

Only serving-layer hardening and validation documentation were changed:

```text
dashboard/lib/inssa-ops/evidence-serving.ts
docs/EVIDENCE_BUNDLE_AUTHENTICATED_VALIDATION_REPORT.md
```

The serving hardening requires Playwright bundle serving to originate from:

```text
playwright-report/index.html
```

This prevents a malformed artifact record with `artifactType="Playwright Report"` from becoming an unintended bundle root.

## Regression Report

No architecture changes were made.

No runner, campaign, Playwright, auth, RBAC, command registry, metadata model, report generation, SIEM, Wazuh, runtime doctor, or runtime clean changes were made.

Dashboard build passed after the serving hardening change.

## Remaining Blockers Before Durable Storage

1. Create or provide a valid dashboard Operator/Admin Supabase account.
2. Log into the dashboard through the UI.
3. Execute `INSSA Safe Suite` through the dashboard.
4. Confirm the new run creates evidence bundle metadata.
5. Open the dashboard-served Playwright report.
6. Open the local Playwright report.
7. Compare browser behavior and network requests under an authenticated session.
8. Repeat for Security Campaign, Security Verification, and Artifact Validation when valid auth is available.

## Exit Criteria Status

| Criterion | Status |
| --- | --- |
| Dashboard-served Playwright report visually identical to local report | BLOCKED |
| No missing dashboard-served assets | BLOCKED |
| No broken screenshots | BLOCKED |
| No broken relative asset requests | BLOCKED |
| Evidence Bundle subsystem production-ready | NOT YET |

Phase 2.6 is not complete. The subsystem should not move to durable evidence storage until authenticated visual parity is proven.
