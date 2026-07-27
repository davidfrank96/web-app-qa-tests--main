# Dashboard Runtime Operations

This document defines the stable runtime workflow for the QA Operations Platform dashboard, worker, and scheduler supervisor.

The dashboard is a Next.js app under `dashboard/`. Runtime failures have previously been traced to stale or mixed `.next` artifacts, including missing `BUILD_ID`, malformed `build-manifest.json`, missing app route bundles, and production startup against development artifacts.

## Supported Runtime

The certified runtime is Node.js 22 LTS. Use the repository `.nvmrc` before installing dependencies or invoking the dashboard wrappers. Runtime Doctor treats every other Node major version as unsupported so local, CI, worker, scheduler, and Supabase persistence behavior use one runtime path.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dashboard:doctor` | Validate the dashboard runtime, environment, Supabase config, runner prerequisites, and Playwright installation. |
| `npm run dashboard:clean` | Remove `dashboard/.next` so the next build or dev startup starts from a clean runtime state. |
| `npm run dashboard:dev` | Start Next.js development mode plus the worker and scheduler after preflight. |
| `npm run dashboard:build` | Build production dashboard artifacts. |
| `npm run dashboard:start` | Start production Next.js plus the worker and scheduler after strict preflight. |

The same local commands are available inside `dashboard/`:

```bash
npm run doctor
npm run clean
npm run dev
npm run build
npm run start
```

All four lifecycle commands share an exclusive process lock under ignored dashboard runtime data. `dev`, `build`, and `start` cannot overlap, and `clean` refuses to remove `.next` while one of those modes is active. Stale ownership left by an unclean process exit is recovered automatically after the owning process is confirmed dead.

## Correct Startup

Development:

```bash
npm run dashboard:dev
```

Production-style local run:

```bash
npm run dashboard:clean
npm run dashboard:build
npm run dashboard:start
```

## Correct Shutdown

Stop the supervisor with `Ctrl+C`; it forwards shutdown to Next.js, the worker, and scheduler.

If a stale process remains on port `3000`, identify and stop it before restarting:

```bash
lsof -a -iTCP:3000 -sTCP:LISTEN -nP
kill <pid>
```

Do not run multiple dashboard servers against the same port.

## Correct Rebuild

Use a clean rebuild whenever manifest or route corruption is suspected:

```bash
npm run dashboard:clean
npm run dashboard:build
npm run dashboard:doctor
npm run dashboard:start
```

## Runtime Doctor Checks

`dashboard:doctor` validates:

- Node.js version
- Dashboard package integrity
- Installed Next.js version
- `.next` integrity
- `BUILD_ID`
- `build-manifest.json`
- `routes-manifest.json`
- `server/pages-manifest.json`
- `server/app-paths-manifest.json`
- Required compiled API route bundles
- `INSSA_URL` environment safety
- Supabase configuration presence
- Runner command prerequisites
- Playwright CLI availability

Results are reported as:

| Status | Meaning |
| --- | --- |
| `PASS` | Runtime prerequisites are valid. |
| `WARN` | Dashboard can usually start, but a configuration or artifact may limit functionality. |
| `FAIL` | Startup or command execution is unsafe or likely broken. Follow the action message. |

## Startup Validation

`npm run dashboard:start` runs a strict production preflight before `next start`.

It fails early if:

- `dashboard/.next` is missing
- `BUILD_ID` is missing
- required manifests are missing or unreadable
- `build-manifest.json` has no `pages` map
- `/_app` or `/_error` is missing from the build manifest
- `server/pages-manifest.json` is missing `/_app`, `/_error`, or `/_document`
- required app-router route bundles are missing

This prevents the recurring runtime class where Next.js crashes while resolving `/_app` or `_document` from corrupted manifests.

`npm run dashboard:dev` acquires exclusive runtime ownership and removes stale `.next` artifacts before its preflight. Development therefore never reuses production output. `npm run dashboard:build` performs the same clean initialization, holds ownership through compilation and post-build validation, and rejects an active dev or production server.

Direct `next dev`, `next build`, and `next start` commands bypass these protections and are unsupported. Use the repository commands above.

## Common Runtime Failures

### `Cannot read properties of undefined (reading '/_app')`

Cause:

`build-manifest.json` is malformed or does not contain the expected `pages` map while Next.js is trying to render a pages-router compatibility error path.

Recovery:

```bash
npm run dashboard:clean
npm run dashboard:build
npm run dashboard:start
```

### `Could not find files for /_error in .next/build-manifest.json`

Cause:

The production runtime is reading incomplete or development-shaped build artifacts.

Recovery:

```bash
npm run dashboard:clean
npm run dashboard:build
```

### `GET /sw.js 500`

Cause:

The repo does not define a service worker. A `/sw.js` request is normally stale browser state or an external client request. It should resolve as `404`. If it returns `500`, the underlying error path is likely failing because the Next.js runtime artifacts are corrupt.

Recovery:

```bash
npm run dashboard:clean
npm run dashboard:build
npm run dashboard:start
```

Then clear browser site data or unregister any stale service worker for the affected localhost origin if requests continue.

### Missing dynamic API route bundles

Cause:

The build did not produce route bundles under `dashboard/.next/server/app/api/...`.

Recovery:

```bash
npm run dashboard:clean
npm run dashboard:build
npm run dashboard:doctor
```

## Environment Notes

Dashboard command execution requires:

```bash
INSSA_URL=https://staging.inssa.us
```

Authentication requires Supabase browser configuration:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Metadata persistence can use:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The doctor reports missing browser Auth values as warnings because runtime files can still be inspected, but authenticated operation will not work. Enabled Supabase metadata or evidence providers require server URL/service-role configuration and fail validation when incomplete.

## Stable Validation Cycle

Use this sequence after dashboard runtime changes:

```bash
npm run dashboard:clean
npm run dashboard:dev
# stop dev server
npm run dashboard:build
npm run dashboard:start
# stop production server
npm run dashboard:doctor
```

Attempting `dashboard:clean` or `dashboard:build` before stopping the active server must fail with an ownership message. This is intentional collision protection.

Expected result:

- Dev startup preflight does not fail.
- Production build completes.
- Production startup preflight passes.
- `dashboard:doctor` reports `PASS` or only environment-related `WARN` entries.
