# Worker Operations

## Responsibility

The dedicated worker is the only component allowed to execute registry commands. HTTP requests and scheduler evaluations enqueue jobs; they do not spawn campaigns.

```text
Execution job -> claim -> lease -> heartbeat -> command -> indexing -> evidence -> completion
```

## Startup

The dashboard supervisor starts the worker with the dashboard. It can also be started independently:

```bash
npm run dashboard:worker
```

For a single claim/recovery pass:

```bash
npm --prefix dashboard run worker -- --once
```

Configuration:

- `INSSA_WORKER_POLL_MS`, default `1000`.
- `INSSA_WORKER_LEASE_MS`, default `30000`.
- `INSSA_QA_REPO_ROOT`, optional explicit repository root for separated deployments.

## Ownership And Recovery

- A claim records worker identity, lease expiry, heartbeat, and attempt.
- Heartbeats renew the lease while execution is active.
- Lease loss terminates the child command and prevents stale completion writes.
- Startup recovery requeues expired jobs with remaining attempts or marks them abandoned.
- Recovery and worker-start events are persisted to the Notification Outbox.
- Idempotency keys prevent the same logical request from creating a second run.

## Execution Safety

- Commands are resolved from the registry only.
- Child processes use `shell:false`.
- Standard INSSA commands require the staging environment guard.
- The production authentication monitor has a separate explicit host-confirmation guard.
- Output is redacted before log persistence.
- A command timeout terminates the child and records `timed_out`.

## Output And Completion

Every run receives `run-output/<runId>/`. The worker finalizes its manifest, indexes artifacts, builds Evidence Bundle metadata, attempts configured durable upload, records the final run state, and emits a deduplicated outbox event.

## Recovery Checklist

1. Stop the dashboard supervisor cleanly.
2. Run `npm run dashboard:doctor`.
3. Inspect execution job state in the configured backend.
4. Preserve `run-output/<runId>/` for incomplete uploads.
5. Restart with `npm run dashboard:start` or `npm run dashboard:dev`.
6. Confirm the worker-start and any recovery events in the Notification workspace.

Do not manually mark a running job complete or delete a lease record to force progress.
