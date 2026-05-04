# Web App QA Tests

Reusable Playwright QA framework for testing multiple web apps from one place.

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

Edit `.env` and set the correct URLs:

```env
LOCALMAN_URL=http://localhost:3000


## Run tests

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

Run with Playwright UI:

```bash
npm run test:ui
```

Open report:

```bash
npm run report
```

## Folder structure

```text
tests/
  localman/
  kbean/
  inssa/
  shared/
pages/
  localman/
  kbean/
  inssa/
utils/
codex-prompts/
```

## How to use with Codex

1. Open this folder in Codex.
2. Give Codex the prompt in `codex-prompts/01-build-out-framework.md`.
3. Let it inspect the app-specific routes and improve selectors.
4. Run one suite at a time.
5. Paste failures back into Codex using `codex-prompts/03-analyze-test-failures.md`.

## Rules

- Do not hardcode secrets.
- Do not commit `.env`.
- Keep each app's tests in its own folder.
- Use page objects for repeated flows.
- Keep smoke tests stable and strict.
- Do not turn real failures into skipped tests unless the feature is genuinely optional.

## Recommended workflow

```bash
npm run test:localman
npm run test:inssa
npm run report
```

Then ask Codex:

```text
Analyze the latest Playwright report and fix only the failing selectors or tests. Do not rewrite unrelated files.
```
