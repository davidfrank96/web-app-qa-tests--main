# Web App QA Tests

Reusable Playwright QA harness for testing multiple hosted or local web apps.

Current targets:

- Local Man
- KBean
- INSSA

## Setup

```bash
npm install
npm run install:browsers
cp .env.example .env
```

Edit `.env` for normal non-live suites. For INSSA live staging lifecycle work, use the dedicated profile:

```bash
cp .env.inssa.live-staging.example .env.inssa.live-staging
```

Do not commit real credentials.

## Common Commands

Run everything:

```bash
npm test
```

Run one app:

```bash
npm run test:localman
npm run test:kbean
npm run test:inssa
```

Run the safe INSSA baseline:

```bash
npm run test:inssa:safe
```

Run focused INSSA live lifecycle campaigns:

```bash
npm run test:inssa:campaign:text
npm run test:inssa:campaign:media
npm run test:inssa:campaign:video
npm run test:inssa:campaign:reveal-later
```

Run the read-only INSSA lifecycle security campaign:

```bash
npm run test:inssa:campaign:security
```

## INSSA Documentation

- [Current state and next work](docs/inssa-current-state.md)
- [Live staging lifecycle runner](docs/inssa-live-staging-lifecycle.md)
- [Lifecycle security campaign](docs/inssa-security-campaign.md)

## Folder Structure

```text
tests/
  localman/
  kbean/
  inssa/
pages/
  localman/
  kbean/
  inssa/
utils/
scripts/
  inssa/
docs/
```

## Rules

- Do not hardcode secrets.
- Do not commit `.env` or `.env.inssa.live-staging`.
- Keep each app's tests in its own folder.
- Use page objects for repeated flows.
- Keep smoke tests stable and strict.
- Do not turn real product failures into skipped tests.
- INSSA live mutation tests are staging-only and require explicit flags.
