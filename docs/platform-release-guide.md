# QA Operations Platform Release Guide

Current Platform Core version: `1.0.0`. Use the detailed [Deployment Checklist](./deployment-checklist.md) for target-environment evidence.

## Mandatory Gates

| Gate | Pass condition |
| --- | --- |
| Dependency | Root and dashboard `npm audit` report zero vulnerabilities. |
| Build | Dashboard clean build succeeds on the lockfile. |
| Runtime | Runtime Doctor passes and dashboard starts from production artifacts. |
| Ingestion | Missing token prevents startup; missing/invalid bearer returns `401`; authenticated metadata returns `202`. |
| Redaction | Security tests prove logs, URLs, payloads, and diagnostics omit credential material. |
| Evidence | Traversal and symlink-escape tests return `403`; approved reports still open. |
| Persistence | Persistence certification suite passes without schema drift. |
| Worker | Execution foundation suite passes, including lease/recovery behavior. |
| Scheduler | Scheduled occurrence remains idempotent. |
| Monitoring | Authentication-monitor discovery remains credential-free and execution guards remain intact. |
| Secrets | No real env files, private keys, JWTs, service-role keys, or credentials are tracked. |
| Git history | No historical ref contains live share tokens, signed URLs, credentials, or private keys. |
| CI/CD | Both required contexts pass for the correct deterministic commands described in [CI/CD Pipeline](./ci-cd.md). |

## Commands

```bash
npm audit
npm --prefix dashboard audit
npm run typecheck
npm --prefix dashboard run typecheck
CI=true INSSA_URL=https://staging.inssa.us npm run test:ci:playwright
npm run test:ci:auth-monitor:discovery
node --test services/inssa-ingestion/server.test.js scripts/siem/security-hardening.test.js
npm --prefix dashboard run test:execution-foundation
npm run dashboard:doctor
npm run dashboard:build
npm run platform:healthcheck
git status --short
```

Live staging campaigns are not required for an infrastructure-only release unless campaign code changed. Production monitoring must not be used as a release smoke test.

## Release Decision

- `PASS`: every mandatory gate passes and no credential exposure is found.
- `PASS WITH WARNINGS`: all security gates pass, with a documented non-blocking operational limitation.
- `BLOCKED`: any anonymous ingestion, secret exposure, traversal/symlink escape, vulnerable production dependency, failed build, failed persistence gate, or missing environment guard.

Current repository verdict is `BLOCKED` until the historical share-token remediation in [Platform Security Certification](./platform-security-certification.md) is complete. Platform Core implementation completion does not override that security gate.

CI/CD certification is independent of the production security verdict. Branch protection must require `Playwright QA / test` and `QA Enforcement / Playwright QA Gate`.
