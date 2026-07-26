# INSSA Authentication k6 Tests

This package contains production-safe k6 scripts for the verified INSSA staging authentication sequence.

The scripts execute the real browser-observed flow:

1. Firebase `accounts:signInWithPassword`
2. Firebase `accounts:lookup`
3. KBean `/Account/SocialLoginJWT`
4. KBean `/Account/SocialAuthenticate`
5. KBean `/api/public/GetUserProfileByEmail`

No secrets are committed. Real keys and users must be supplied through ignored local files or shell environment variables.

## Safety Rules

- Default target is staging: `https://staging.inssa.us`.
- Production is blocked unless both `ALLOW_PRODUCTION_LOAD_TEST=true` and `PRODUCTION_CONFIRMATION=I_UNDERSTAND_THIS_GENERATES_PRODUCTION_TRAFFIC` are set.
- TLS must remain enabled; all base URLs must be HTTPS.
- `data/users.json` is ignored by Git.
- `results/` output files are ignored by Git.
- Do not run `large` or `event` profiles until smoke, small, and medium results have passed and Azure health is stable.
- Do not use real user accounts.
- Do not reuse one account across many VUs unless the app owner explicitly approves `ALLOW_ACCOUNT_REUSE=true`.

## Files

- `scripts/auth-smoke.js`: two-user smoke validation of the full auth sequence.
- `scripts/auth-load.js`: staged ramping load profile using the full auth sequence.
- `scripts/auth-helpers.js`: shared Firebase/KBean workflow, safety gates, metrics, and redacted summaries.
- `.env.example`: all environment-specific configuration placeholders.
- `data/users.example.json`: safe user-file template.
- `AUTH_FLOW_FINDINGS.md`: verified auth sequence and redacted schemas.

## Install k6

macOS:

```bash
brew install k6
```

Windows:

```powershell
winget install k6
```

or:

```powershell
choco install k6
```

Linux:

Use the official k6 package repository for your distribution. Do not pipe arbitrary install scripts into a shell.

Docker alternative:

```bash
docker run --rm -i grafana/k6 version
```

Verify:

```bash
k6 version
```

## Local Setup

```bash
cd performance/k6
cp .env.example .env
cp data/users.example.json data/users.json
```

Edit `.env` locally with:

- `FIREBASE_API_KEY`
- `FIREBASE_GMP_ID`
- `KBEAN_PUBLIC_API_KEY`
- staging URLs if they change

Edit `data/users.json` with dedicated staging test accounts. The runtime `USERS_FILE` value is `../data/users.json` because k6 resolves `open()` paths relative to the script file in `scripts/`.

k6 does not automatically load `.env`. Load it in the shell before running:

```bash
set -a
. ./.env
set +a
```

## Profiles

| Profile | Max VUs | Shape |
| --- | ---: | --- |
| `smoke` | 2 | 4 shared iterations over at most 1 minute |
| `small` | 10 | Ramps 5 -> 10 -> 10 -> 0 |
| `medium` | 25 | Ramps 5 -> 20 -> 25 -> 25 -> 0 |
| `large` | 50 | Ramps 5 -> 20 -> 50 -> 50 -> 0 |
| `event` | 100 | Ramps 5 -> 20 -> 50 -> 75 -> 100 -> 100 -> 0 |

Never use the 100-user profile as the first test.

## Commands

Smoke:

```bash
cd performance/k6
set -a
. ./.env
set +a
k6 run \
  -e TEST_PROFILE=smoke \
  -e MAX_VUS=2 \
  scripts/auth-smoke.js
```

10-user small:

```bash
cd performance/k6
set -a
. ./.env
set +a
k6 run \
  -e TEST_PROFILE=small \
  -e MAX_VUS=10 \
  scripts/auth-load.js
```

25-user medium:

```bash
cd performance/k6
set -a
. ./.env
set +a
k6 run \
  -e TEST_PROFILE=medium \
  -e MAX_VUS=25 \
  scripts/auth-load.js
```

50-user large:

```bash
cd performance/k6
set -a
. ./.env
set +a
k6 run \
  -e TEST_PROFILE=large \
  -e MAX_VUS=50 \
  scripts/auth-load.js
```

100-user event:

```bash
cd performance/k6
set -a
. ./.env
set +a
k6 run \
  -e TEST_PROFILE=event \
  -e MAX_VUS=100 \
  scripts/auth-load.js
```

Restricted production command:

```bash
cd performance/k6
set -a
. ./.env
set +a
k6 run \
  -e BASE_URL=https://inssa.us \
  -e TEST_PROFILE=event \
  -e MAX_VUS=100 \
  -e ALLOW_PRODUCTION_LOAD_TEST=true \
  -e PRODUCTION_CONFIRMATION=I_UNDERSTAND_THIS_GENERATES_PRODUCTION_TRAFFIC \
  scripts/auth-load.js
```

DANGER: Do not run production without written authorization, active Azure monitoring, technical staff on standby, and an agreed emergency stop procedure.

## Metrics

End-to-end metrics:

- `auth_success_rate`
- `e2e_login_duration`
- `auth_failures`
- `auth_workflow_successes`
- `auth_login_requests`

Stage durations:

- `firebase_login_duration`
- `firebase_lookup_duration`
- `social_login_jwt_duration`
- `social_authenticate_duration`
- `profile_lookup_duration`

Stage counters:

- `firebase_login_successes` / `firebase_login_failures`
- `firebase_lookup_successes` / `firebase_lookup_failures`
- `social_login_jwt_successes` / `social_login_jwt_failures`
- `social_authenticate_successes` / `social_authenticate_failures`
- `profile_lookup_successes` / `profile_lookup_failures`

HTTP counters:

- `http_400_count`
- `http_401_count`
- `http_403_count`
- `http_408_count`
- `http_429_count`
- `http_500_count`
- `http_502_count`
- `http_503_count`
- `http_504_count`
- `http_5xx_count`
- `network_error_count`

## Thresholds

The load script aborts on:

- `auth_success_rate` below `98%`
- HTTP failure rate at or above `2%`
- `p95` end-to-end auth duration at or above `3000ms`
- `p99` end-to-end auth duration at or above `5000ms`

## Operating Sequence

1. Confirm written authorization.
2. Confirm the target environment.
3. Confirm dedicated staging test accounts.
4. Confirm Azure monitoring is open.
5. Record the current database baseline.
6. Run smoke.
7. Review errors and thresholds.
8. Run 10-user small.
9. Stop and review.
10. Run 25-user medium.
11. Stop and review.
12. Run 50-user large only if earlier stages pass.
13. Run 100-user event only if earlier stages pass and the technical owner approves.
14. Stop immediately if authentication failures, database degradation, 429 responses, or 5xx responses increase materially.
15. Save k6 summaries and Azure screenshots.
16. Do not continue increasing load after a failed stage.

## Azure Observation Table

| Test stage | Start time | End time | Max VUs | Auth success | p95 | 429 | 5xx | Azure DB status | Decision |
| ---------- | ---------- | -------- | ------: | -----------: | --: | --: | --: | --------------- | -------- |
| Smoke | | | 2 | | | | | | |
| Small | | | 10 | | | | | | |
| Medium | | | 25 | | | | | | |
| Large | | | 50 | | | | | | |
| Event | | | 100 | | | | | | |

## Summary Output

Each run writes:

- `results/auth-summary.json`
- `results/auth-summary.txt`

Summaries include metrics only. They must not include passwords, Firebase tokens, refresh tokens, JWTs, cookies, or complete auth responses.

## Validation Without Traffic

```bash
k6 inspect scripts/auth-smoke.js
k6 inspect scripts/auth-load.js
```

`k6 inspect` validates script structure only. It does not send authentication traffic.
