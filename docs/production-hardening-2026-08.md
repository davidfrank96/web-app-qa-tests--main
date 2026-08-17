# Production Hardening Review - August 2026

## Scope And Baseline

Target: QA Operations Platform at Git revision `1dc02c6e2875bccad072c99eae55fa41105523f2`, hosted by the authorized DigitalOcean app `kbean-qa-webapp` (`25bef95b-e762-4675-b850-65794c62aa10`). The review covered dashboard, Supabase Auth/persistence, worker, scheduler, evidence serving, campaign controls, Wazuh integration, dependencies, browser traffic, and operational runtime.

Baseline facts:

- Node `22.23.2`, npm `10.9.8`, Next.js `15.5.22`, Playwright `1.59.1`.
- Root and dashboard TypeScript passed.
- Platform tests passed 50/50 and security tests passed 5/5 when local loopback was permitted.
- Safe Suite passed 10/10 against staging in 1.3 minutes.
- Root and dashboard production dependency audits reported zero vulnerabilities.
- Production `/login` returned `200`; anonymous `/api/runs` returned `401`.
- Production did not set the application security-header baseline and exposed `X-Powered-By: Next.js`.
- An authenticated page generated approximately 86 browser API calls per three-second refresh cycle in the worst observed workspace path.

## Threat Model

External actors can reach the login, auth callback, health endpoint, and hosted Next.js routes. Authenticated viewers can read operational metadata and private evidence. Operators can enqueue only enabled non-mutation commands. Admins can additionally run the healthcheck and enter the governed staging-mutation approval flow. The Next.js server, worker, scheduler, Supabase service role, private Storage bucket, and Wazuh ingestion credential form the trusted control plane.

Primary protected assets are authenticated sessions, roles, QA credentials, run/evidence confidentiality, immutable evidence integrity, execution-job ownership, staging product safety, and SIEM event integrity.

## Attack-Surface Matrix

| Scenario | Baseline | Hardening result |
| --- | --- | --- |
| Credential stuffing / password spraying | EXPOSED | MITIGATED by durable global, IP, account, and combined throttles. |
| Magic-link delivery abuse | EXPOSED | MITIGATED by durable throttles and non-enumerating responses. |
| Magic-link self-registration | EXPOSED | MITIGATED with `shouldCreateUser:false` and deny-by-default admission. |
| Email enumeration | PARTIALLY MITIGATED | MITIGATED with generic magic-link responses and generic password failures. |
| Session fixation | MITIGATED by Supabase PKCE/cookie handling | Preserved. |
| Expiring access token / refresh continuity | EXPOSED operationally | MITIGATED by Supabase SSR middleware cookie refresh. |
| Invalid refresh token | PARTIALLY MITIGATED | MITIGATED by server `401`, stopped polling, and login redirect. |
| Logout replay / CSRF | PARTIALLY MITIGATED | MITIGATED by POST-only logout and trusted Origin. |
| CSRF against JSON mutations | PARTIALLY MITIGATED by browser CORS/SameSite | Defense in depth added with one Origin guard. |
| Viewer-to-operator/admin escalation | MITIGATED | Preserved server-side RBAC; unassigned identities now denied. |
| IDOR/BOLA by run/artifact ID | MITIGATED for platform-wide viewer model | UUID validation and existing authenticated object lookup preserved. |
| Arbitrary command execution | MITIGATED | Existing registry, `shell:false`, fixed scripts, staging guard, and role checks preserved. |
| Mass assignment | PARTIALLY MITIGATED | Mutation bodies now reject unknown top-level fields. |
| Malformed / oversized JSON | EXPOSED | MITIGATED with streaming size caps and JSON-object validation. |
| Stored/reflected XSS in dashboard data | MITIGATED by React escaping and report generators | Preserved; no unsafe dashboard HTML sink found. |
| Active HTML evidence | PARTIALLY MITIGATED | Authenticated, same-origin serving retained for Playwright compatibility; isolation remains a P2 design item. |
| SQL injection | NOT APPLICABLE to reviewed request paths | PostgREST parameters are encoded; no raw user SQL path found. |
| SSRF | MITIGATED | Clients cannot supply execution targets; Wazuh URL policy remains server-controlled. |
| Path traversal / symlink escape | MITIGATED | Existing lexical and canonical `realpath` containment retained and tested. |
| Open redirect / Host poisoning | EXPOSED in magic-link/callback construction | MITIGATED by `INSSA_OPS_PUBLIC_ORIGIN`. |
| Duplicate execution / replay | MITIGATED | Durable idempotency, one-active-run, leases, and occurrence keys retained. |
| Resource exhaustion through polling | EXPOSED | MITIGATED by workspace-aware polling, hidden-tab pause, and completed-run backoff. |
| Evidence range memory pressure | PARTIALLY MITIGATED | Auth required; full-buffer range behavior remains P2. |
| Secrets in logs/evidence | PARTIALLY MITIGATED | Existing central redaction retained; tracked-file secret gate added. |
| Service-role exposure | MITIGATED | Server-only variable and no client reference confirmed. |
| Anonymous SIEM ingestion | MITIGATED | Existing fail-closed bearer authentication retained. |

## Confirmed Findings

### P0 - Unauthorized Viewer Admission

The magic-link route permitted Supabase user creation, while role resolution returned `viewer` for every authenticated identity without an assigned role. A public caller could therefore create an Auth identity and gain private run/evidence read access. The fix disables OTP user creation and makes role resolution return no platform identity unless `app_metadata.inssa_ops_role` or an explicit server-side email allowlist admits the user.

### P1 - Missing Session Refresh Boundary

The server client attempted cookie writes from Server Components and discarded failures, while no middleware refreshed Supabase access tokens. Once an access token expired, protected polling returned repeated `401` responses even though a refresh token could still continue the session. The fix adds Next.js Node-runtime middleware using the supported `@supabase/ssr` `getAll`/`setAll` cookie contract and `getClaims()`. The client now centralizes protected fetches, stops polling on the first `401`, and redirects to `/login?reason=session_expired`.

Access-token expiry remains separate from application idle/absolute lifetime. No new permanent-session, idle-timeout, or absolute-lifetime policy was introduced. A future policy should be configurable and approved independently; recommended starting points are 30 minutes idle and 12 hours absolute for operations users, subject to actual operator workflow review.

### P1 - No Durable Login Throttling

Password and magic-link endpoints had no server-side durable limiter. The fix adds a Supabase-backed atomic throttle with a locked local JSON fallback for development. Scope identifiers are HMAC-hashed and never persist email or IP text.

| Endpoint | Scope | Window | Allowed attempts | Block |
| --- | --- | --- | --- | --- |
| Password | global | 5 minutes | 300 | 15 minutes |
| Password | IP | 15 minutes | 30 | 15 minutes |
| Password | account | 15 minutes | 10 | 15 minutes |
| Password | IP + account | 15 minutes | 5 | 15 minutes |
| Magic link | global | 1 hour | 100 | 1 hour |
| Magic link | IP | 1 hour | 10 | 1 hour |
| Magic link | account | 1 hour | 3 | 1 hour |
| Magic link | IP + account | 1 hour | 3 | 1 hour |

The first denied attempt returns `429` and `Retry-After`. Successful password login clears the account and combined scopes, but not global/IP abuse history.

### P1 - Unbounded Mutation Input And Inconsistent Origin Checks

Mutation routes relied on `request.json()` and TypeScript shapes, accepted unknown fields, and had no shared Origin guard. Auth redirects trusted request-derived origins and logout used GET. The fix provides one bounded JSON/object validator, strict mutation field lists, normalized email, maximum string lengths, UUID validation, idempotency-key validation, POST logout, trusted Origin enforcement, and canonical callback construction.

### P1 - Missing Browser Header Baseline

The hosted application lacked application security headers. All routes now set HSTS, `nosniff`, same-origin framing protections, opener isolation, a restrictive referrer policy, Permissions Policy, and CSP report-only. CSP is not enforced yet because authenticated Playwright evidence must first be checked for violations without breaking its scripts, styles, workers, media, and frames.

### P1 - Excessive Client Polling

The previous three-second global interval refreshed run history and cleanup state, refreshed selected run detail, and rebuilt report/evidence archives for up to 40 runs even when the related workspace was inactive. The worst measured path was approximately 86 browser requests and 214 PostgREST operations per tick, or 1,720 browser requests and 4,280 PostgREST operations per minute per open tab.

The client now:

- pauses polling while the tab is hidden;
- polls every three seconds only while a run is active and every 15 seconds otherwise;
- refreshes run detail only in Execution or Runs;
- refreshes cleanup only in Overview or Lifecycle;
- loads notification and monitoring state only in their workspaces;
- loads the 40-run report/evidence archive only in Reports and when recent run state changes;
- stops all protected polling after `401`.

## API Authorization Matrix

| Surface | Anonymous | Viewer | Operator | Admin |
| --- | --- | --- | --- | --- |
| Login, magic link, auth callback | Public with validation/rate limits | Same | Same | Same |
| Health | Sanitized liveness only | Same | Same | Same |
| Run, log, artifact, evidence, notification, monitor reads | `401` | Read | Read | Read |
| Safe/read-only run enqueue | `401` | `403` | Allowed | Allowed |
| Platform healthcheck enqueue | `401` | `403` | `403` | Allowed |
| Governed staging mutation enqueue | `401` | `403` | `403` | Approval and preflight required |
| Campaign approval preflight | `401` | `403` | `403` | Allowed |
| Cleanup confirmation | `401` | `403` | `403` | Allowed for eligible terminal run |
| Evidence file/bundle read | `401` | Read | Read | Read |

Runs and evidence are intentionally platform-wide, not per-user records. Changing a valid identifier does not cross an ownership boundary under the approved viewer model. Multi-product or tenant isolation would require a separate authorization design before exposure.

## Input Validation Architecture

`request-security.ts` owns bounded streaming JSON reads, JSON object enforcement, strict field checks, normalized email, maximum strings, UUIDs, canonical origin resolution, and mutation Origin checks. Mutation routes use 1 KiB to 32 KiB limits according to payload shape. File/evidence routes do not pass through JSON limits and retain bundle streaming behavior.

## Existing Controls Confirmed Good

- Fixed command registry and `shell:false` process launch.
- Exact staging target and production monitoring gates.
- Server-side RBAC and admin-only live mutation approval/preflight.
- Durable execution jobs, leases, heartbeats, idempotency, and one-active-run control.
- Immutable run-owned output and evidence paths.
- Canonical path and symlink containment.
- Private Supabase evidence bucket and checksum metadata.
- Central log/SIEM redaction and sensitive artifact classification.
- Authenticated Wazuh ingestion with body limits and timing-safe credential comparison.
- Audit-clean pinned production dependency graph.

## Top Five Measured Costs

1. Report archive N+1: 80 artifact/evidence requests for 40 runs.
2. Three-second polling regardless of active work, workspace, or tab visibility.
3. Run detail fan-out: four requests per selected run refresh.
4. PostgREST store methods that load broad result sets before in-memory pagination.
5. One-second idle worker job polling against Supabase.

Only items 1-3 were reduced in this sprint because they were directly measured in browser traffic and could be changed without altering certified worker/store architecture.

## P2/P3 Recommendations

- Add aggregated report-archive/read-model endpoints to replace the remaining 80-request Reports load.
- Implement database-native cursor pagination for runs, logs, artifacts, and evidence instead of broad reads plus slicing.
- Stream byte ranges without reading the entire evidence object into memory first.
- Isolate active HTML evidence onto a dedicated origin or sandbox contract after Playwright compatibility research.
- Revalidate local evidence checksums on read when operational cost is acceptable.
- Restrict child-process environment inheritance to a reviewed allowlist.
- Replace one-second idle worker polling with bounded backoff or a queue signal without weakening leases.
- Add application idle/absolute session policy only after product approval.
- Resolve historical Git secret-scan findings through token disposition and an explicitly approved history strategy.

## Regression Coverage

Mandatory platform tests now cover deny-by-default role admission, role allowlists, password throttling, magic-link throttling, malformed/oversized JSON, UUIDs, mutation Origin rejection, canonical redirect origin, SSR cookie refresh propagation, security headers, sanitized health, redaction, viewer/operator mutation denial, process ownership, symlink escape, evidence integrity, scheduler idempotency, and SIEM fail-closed behavior.

Local post-change results:

- Root TypeScript: PASS.
- Dashboard TypeScript: PASS.
- Platform tests: PASS, 61/61.
- Ingestion/SIEM security tests: PASS, 5/5.
- Production dependency audits: PASS, zero vulnerabilities.
- Production dashboard build and Runtime Doctor: PASS.
- Local production integration: health `200`, login `200`, anonymous runs `401`, malformed JSON `400`, untrusted Origin `403`.
- Tracked current-tree secret scan: PASS after excluding only documented templates; full Git history still reports removed historical artifacts and is not represented as clean.

## Release State

The branch is not eligible for production deployment until the new migration is applied through the reviewed release sequence, required GitHub checks pass, the PR is merged, and the authorized DigitalOcean app receives both required server-only security values. Post-deployment acceptance must verify authenticated roles, access-token refresh, logout, rate limiting, Safe Suite, worker/scheduler state, evidence, themes, headers, and logs without running mutation campaigns.

Current hardening verdict: **BLOCKED PENDING CI, MIGRATION, DEPLOYMENT, AND AUTHENTICATED ACCEPTANCE**.
