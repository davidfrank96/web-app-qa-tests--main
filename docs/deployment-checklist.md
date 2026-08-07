# Platform Core v1.0 Deployment Checklist

Every required item must have captured evidence for the target environment.

## Repository

- [ ] `Playwright QA / test` passes.
- [ ] `QA Enforcement / Playwright QA Gate` passes with every mandatory prerequisite successful.
- [ ] Authentication-monitor discovery passes without provider credentials.
- [ ] Required checks use only the approved staging-safe scope in [CI/CD Pipeline](./ci-cd.md).
- [ ] Git history share-token remediation is complete and affected tokens are invalid/expired.
- [ ] No real environment, credential, key, user-data, or generated evidence file is tracked.
- [ ] Root and dashboard versions are `1.0.0`.
- [ ] Root and dashboard `npm audit` return zero unresolved vulnerabilities.
- [ ] Root and dashboard TypeScript checks pass.
- [ ] Documentation link and command validation pass.

## Host And Runtime

- [ ] Supported Node version and Playwright browsers are installed.
- [ ] Repository and dashboard lockfiles install cleanly.
- [ ] `npm run dashboard:doctor` passes.
- [ ] `npm run dashboard:clean` and `npm run dashboard:build` pass.
- [ ] `npm run dashboard:start` starts Next.js, worker, and scheduler.
- [ ] `/login` returns `200`; anonymous protected API access returns `401`.
- [ ] Clean shutdown leaves no dashboard/worker/scheduler process.

## Supabase

- [ ] All eight migrations are applied in canonical order, including `20260802_admin_live_campaigns.sql` and `20260802_deferred_cleanup_ledger.sql`.
- [ ] Migration history and linked schema diff are clean.
- [ ] All 12 platform tables exist with RLS enabled.
- [ ] Anonymous/authenticated roles have no direct platform table access.
- [ ] Service-role execution RPCs and grants are correct.
- [ ] Supabase security/performance advisors have no unresolved blocker.
- [ ] Private evidence bucket is provisioned and verified.
- [ ] Browser and server environment variables are separated correctly.

## Authentication And RBAC

- [ ] Viewer, operator, and admin users can authenticate.
- [ ] Viewer cannot enqueue runs.
- [ ] Operator can run enabled safe/read-only commands but not healthcheck.
- [ ] Admin can run healthcheck.
- [ ] Viewer/operator receive `403` for governed live mutation commands.
- [ ] Admin approval and server preflight are required before any live mutation job is created.
- [ ] Unauthorized and role-violation audit events persist.

## Worker And Scheduler

- [ ] Safe run is enqueued and executed after the HTTP request completes.
- [ ] Lease heartbeat persists while running.
- [ ] Idempotency key does not create duplicate runs.
- [ ] Expired-job recovery behavior is validated.
- [ ] Scheduler heartbeat is current.
- [ ] Repeated scheduler evaluation does not duplicate one occurrence.

## Evidence And Storage

- [ ] Run output and manifest are run-scoped.
- [ ] Artifacts and Evidence Bundle/Items persist.
- [ ] Durable upload verifies size and SHA-256.
- [ ] Existing durable objects cannot be overwritten.
- [ ] Playwright HTML and relative assets load through authenticated bundle route.
- [ ] Anonymous evidence access is denied.
- [ ] Traversal and symlink escape tests pass.
- [ ] Upload-failure fallback preserves local evidence and outbox warning.

## Monitoring And Notifications

- [ ] Monitoring definitions load from the configured backend.
- [ ] Staging authentication monitor executes with approved accounts.
- [ ] Production definitions remain disabled unless separately approved.
- [ ] Outbox records run, failure, recovery, and upload events without external delivery.

## SIEM And Wazuh

- [ ] SIEM export contains metadata only.
- [ ] Sender refuses missing credential and non-TLS remote endpoint.
- [ ] Ingestion service refuses startup without its credential.
- [ ] Invalid/anonymous ingestion returns `401`.
- [ ] Authenticated test event returns `202` and reaches `inssa-qa.log`.
- [ ] Wazuh decoder, rules, alert ID, and dashboard visibility are verified.
- [ ] Nginx, ingestion, and Wazuh services survive approved restart/reload tests.

## Product Safety

- [ ] Standard INSSA environment is `https://staging.inssa.us`.
- [ ] Lifecycle mutation is admin-only, staging-only, approval-gated, and limited to governed wrappers.
- [ ] Production/arbitrary/localhost mutation targets fail before job creation.
- [ ] Mutation runs use one attempt and produce a run-owned cleanup manifest.
- [ ] Production authentication monitoring guard is validated separately.
- [ ] Cleanup targets and ownership are recorded for any approved mutation test.

## Release Decision

- [ ] All mandatory gates pass.
- [ ] Warnings have owners and dates.
- [ ] Rollback procedure and backup locations are verified.
- [ ] Release approver records PASS or PASS WITH WARNINGS.

Any unchecked security, persistence, evidence-integrity, authentication, or production-target item blocks deployment.
