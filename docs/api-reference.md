# Operations API Reference

Last reviewed: 2026-08-02

All Operations APIs are same-origin Next.js routes. Except login/magic-link, every route requires a valid Supabase session and viewer-or-higher role. Mutation authorization is server-side.

## Authentication

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/password` | Email/password login. Body: `email`, `password`. |
| `POST` | `/api/auth/magic-link` | Request magic link. Body: `email`. |
| `GET` | `/auth/callback` | Exchange Supabase callback code and establish session. |
| `GET` | `/logout` | Sign out and redirect to login. |

## Campaigns And Runs

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/campaign-definitions` | Registry definitions. |
| `GET` | `/api/lifecycle-artifacts` | Validation-ready lifecycle artifact options. |
| `POST` | `/api/campaign-approvals` | Admin-only live-campaign approval-open audit or preflight. Does not enqueue work. |
| `GET` | `/api/runs` | Run history and metadata backend summary. Supports `limit`, `cursor`. |
| `POST` | `/api/runs` | Enqueue enabled command. Body: `campaignKey`; artifact validators accept `artifactSelection`; governed live campaigns require validated `liveApproval`. Optional `Idempotency-Key` header. |
| `GET` | `/api/runs/:id` | Run metadata. |
| `GET` | `/api/runs/:id/logs` | Incremental logs. Supports `after`, `limit`. |
| `GET` | `/api/runs/:id/artifacts` | Artifact metadata. Supports `limit`, `cursor`. |
| `GET` | `/api/runs/:id/evidence` | Evidence Bundles and Items. Supports `limit`, `cursor`. |
| `POST` | `/api/runs/:id/cleanup` | Admin-only manual cleanup confirmation for a terminal mutation run. |

`POST /api/runs` returns `202` when queued, `400` for invalid environment/input, `403` for role/registry denial, and `409` when active-work protection prevents enqueueing.

Live campaign preflight is authoritative on the server and is repeated at enqueue time. Target URLs are never accepted from the browser.

## Artifacts And Evidence

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/artifacts/:id` | Artifact metadata. |
| `GET` | `/api/artifacts/:id/file` | Compatibility report/SIEM file response. |
| `GET` | `/api/artifacts/:id/bundle/*` | Bundle-relative authenticated evidence response. |

File paths are resolved from metadata. Routes reject arbitrary paths, traversal, symlink escape, directory reads, and unsupported compatibility artifacts.

## Notifications

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/notifications` | Outbox list. Filters: `status`, `severity`, `campaign`, `environment`, `product`, `run`, `limit`, `cursor`. |
| `GET` | `/api/notifications/:id` | One outbox record. |

No notification mutation or send route exists.

## Monitoring And Scheduler

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/monitoring-definitions` | Definition list. Filters: `product`, `campaign`, `environment`, `triggerType`, `severity`, `enabled`, `limit`, `cursor`. |
| `GET` | `/api/monitoring-definitions/:id` | One definition. |
| `GET` | `/api/scheduler/status` | Read-only scheduler heartbeat/evaluation state. |

No monitor or scheduler control route exists.

## Compatibility

`GET /api/localman-results` is an authenticated legacy read endpoint for the Localman JSON dashboard feed. It is not a managed campaign API.

## Errors

- `401`: no authenticated session.
- `403`: authenticated role lacks permission or command is not enabled.
- `404`: run, artifact, definition, notification, or file is absent.
- `500`: persistence or server operation failed; the dashboard surfaces endpoint, status, and timestamp.

APIs must not return secrets. Run-log and textual evidence responses apply redaction at the response boundary.
