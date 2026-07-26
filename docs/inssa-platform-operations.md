# QA Operations Platform Operations

Last reviewed: 2026-07-21

## Daily Startup

```bash
npm run dashboard:doctor
npm run dashboard:dev
```

For a production build:

```bash
npm run dashboard:clean
npm run dashboard:build
npm run dashboard:start
```

The supervisor owns Next.js, the worker, and scheduler. Use one mode at a time.

## Daily Review

1. Confirm Environment, Runner, Backend, Operator, Role, and Last Run in the header.
2. Review Overview for active or failed runs and API failures.
3. Review Authentication Monitoring for provider status.
4. Review Monitoring for scheduler heartbeat and queued jobs.
5. Review Notifications for failed, dead-letter, lease-expired, or recovery events.
6. Review Runs for final status, logs, artifacts, and evidence.
7. Review Evidence Workspace for integrity/upload failures.
8. Review SIEM/Wazuh according to the SIEM operations guide.

## Safe Execution

Use Testing for the Safe Suite. Use Security for Security Campaign/Verification. Use Artifact Validation only after confirming the selected lifecycle artifact path, type, and timestamp.

CLI equivalents:

```bash
npm run test:inssa:safe
npm run test:inssa:campaign:security
npm run test:inssa:campaign:security:verify
npm run test:inssa:discovery
npm run test:inssa:public-share
npm run test:inssa:cleanup-audit
```

Live lifecycle and advanced security commands remain dashboard-disabled. Run them from CLI only with approved mutation/cleanup gates.

## Execution Review

The expected state sequence is:

```text
queued -> starting -> running -> indexing_artifacts -> terminal
```

Terminal statuses are `passed`, `passed_with_warnings`, `failed`, `failed_startup`, `cancelled`, and `timed_out`.

For a stuck job:

1. Do not edit metadata manually.
2. Confirm worker process and heartbeat.
3. Inspect the run and execution-job logs.
4. Restart the supervisor cleanly if the worker died.
5. Allow lease recovery to requeue or abandon the job.
6. Confirm recovery events in the Notification Outbox.

## Evidence Review

- Confirm bundle item count, total bytes, and checksum metadata.
- Confirm upload state matches configured storage provider.
- Open Playwright through the bundle-aware report action.
- Preserve local run output when durable upload failed.
- Do not delete or overwrite durable object keys.

Retention, archive, and deletion are manual deployment responsibilities in v1.0.

## Persistence Operations

Local is the safe default. Before enabling Supabase:

```bash
cd dashboard
npx supabase@latest db push --dry-run
npx supabase@latest db push
npm run persistence:provision
npm run persistence:verify
cd ..
npm run dashboard:doctor
```

Changing providers does not migrate data. Do not alternate providers expecting a shared history.

## Monitoring

The scheduler is producer-only. One-shot validation:

```bash
npm run dashboard:scheduler -- --once
```

The Monitoring workspace has no controls. Edit definitions only through an approved persistence migration or controlled administrative process.

Production authentication monitoring remains disabled unless its exact confirmation variables and credentials are configured.

## Notification Outbox

The outbox is read-only. Pending records are expected because no dispatcher exists. Investigate failed/dead-letter only if records were advanced by future approved tooling; Platform Core v1.0 does not deliver them.

## Reports And SIEM

```bash
npm run report:security
npm run report:lifecycle
npm run siem:export
npm run siem:send -- --dry-run
```

Live SIEM send requires HTTPS and a bearer credential. Dashboard send remains disabled. Never send binary evidence or credential-bearing metadata.

## Health And Recovery

```bash
npm run dashboard:doctor
npm run platform:healthcheck
npm --prefix dashboard run test:execution-foundation
```

Recovery order:

1. Stop the supervisor.
2. Preserve `.data`, run output, and logs.
3. Run Runtime Doctor.
4. Use `dashboard:clean` only for `.next` runtime artifacts.
5. Verify persistence and environment configuration.
6. Rebuild/start.
7. Confirm worker and scheduler heartbeats.
8. Run the Safe Suite before higher-risk commands.

See [Worker Operations](worker-operations.md), [Dashboard Runtime](dashboard-runtime.md), [Supabase Deployment](supabase-deployment.md), and [SIEM Operations](inssa-siem-operations.md).

## Release

Follow [Deployment Checklist](deployment-checklist.md) and [Platform Release Guide](platform-release-guide.md). Current production status is blocked until the historical token remediation in the security certification is complete.
