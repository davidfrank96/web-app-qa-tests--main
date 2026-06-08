# Release Gate Gitignore And Secrets Audit

Date: 2026-06-01  
Repository: `web-app-qa-tests`  
Scope: local QA harness repository, tracked files, ignored local files, generated lifecycle/security evidence, reports, traces, videos, screenshots, and environment files.

## Executive Summary

Verdict: **PASS WITH WARNINGS**

The audit found one release-blocking gap and remediated it in the working tree:

- `lifecycle-investigations/` was tracked and contained generated screenshots/JSON evidence. Some screenshot filenames included tokenized staging capsule URL material.
- The directory has been removed from git tracking with `git rm --cached -r lifecycle-investigations`.
- `.gitignore` now ignores `lifecycle-investigations/` plus broad local env, IDE, temporary, trace, and video output patterns.

No tracked private keys, service account files, AWS keys, OpenAI keys, concrete Bearer tokens, or UUID-style `token=...` share tokens remain after remediation.

Warning: if commits containing `lifecycle-investigations/` will be pushed, repository history may still contain tokenized staging evidence even though the latest tree removes the files. Before first push, squash or rewrite the branch so those artifacts never enter remote history. If they were already pushed, treat the affected staging share tokens as exposed and rotate/delete the related QA capsules or rewrite history according to team policy.

## Gitignore Audit

| Path | Exists | Ignored | Should Be Ignored | Reason |
| --- | --- | --- | --- | --- |
| `.env` | Yes | Yes | Yes | Local credentials and URLs. |
| `.env.local` | Not observed | Yes | Yes | Local credentials and overrides. |
| `.env.development` | Not observed | Yes | Yes | Local credentials and overrides. |
| `.env.production` | Not observed | Yes | Yes | Production secrets must never be committed. |
| `.env.test` | Not observed | Yes | Yes | Test credentials and overrides. |
| `.env.inssa.live-staging` | Yes | Yes | Yes | Real INSSA QA account credentials and live flags. |
| `.env.example` | Yes | No | No | Safe placeholder template. |
| `.env.inssa.live-staging.example` | Yes | No | No | Safe placeholder live-staging template. |
| `lifecycle-artifacts/` | Yes | Yes | Yes | Persistent generated live lifecycle artifacts; may include capsule IDs/share links. |
| `lifecycle-campaigns/` | Yes | Yes | Yes | Generated campaign summaries. |
| `security-campaigns/` | Yes | Yes | Yes | Generated security campaign JSON outputs. |
| `lifecycle-investigations/` | Yes | Yes | Yes | Generated black-box audit artifacts/screenshots; filenames may include tokenized URLs. |
| `reports/` | Yes | Yes | Yes | Generated HTML/JSON reports. |
| `playwright-report/` | Yes | Yes | Yes | Generated Playwright HTML report. |
| `test-results/` | Yes | Yes | Yes | Generated traces/screenshots/videos/test metadata. |
| `docs/` | Yes | No | No | Source-controlled documentation. |
| `scripts/` | Yes | No | No | Source-controlled runner/reporting code. |
| `tests/` | Yes | No | No | Source-controlled Playwright tests and fixtures. |
| `.vscode/` | Not observed | Yes | Yes | Local IDE config. |
| `.idea/` | Not observed | Yes | Yes | Local IDE config. |
| `.DS_Store` | Possible | Yes | Yes | macOS metadata. |
| `Thumbs.db` | Not observed | Yes | Yes | Windows metadata. |
| `*.tmp`, `*.bak`, `*.swp` | Not observed | Yes | Yes | Temporary/editor backup files. |
| `trace.zip`, `*.trace.zip`, `*.webm` | Possible | Yes | Yes | Browser evidence artifacts. |

## Secret Findings

| Severity | File / Area | Line | Finding | Status |
| --- | --- | --- | --- | --- |
| High | `lifecycle-investigations/screenshots/*token-<redacted>.png` | Filename | Generated screenshot filenames contained tokenized staging capsule URL material. | Remediated: directory untracked and ignored. |
| High | `.env` | 12, 14 | Local credential values were present. | Safe locally: file is ignored. Do not commit. |
| High | `.env.inssa.live-staging` | 17 | Local INSSA password value was present. | Safe locally: file is ignored. Do not commit. |
| Review | `.env.example` | 10, 12, 14 | Placeholder password keys. | Safe: values are empty placeholders. |
| Review | `.env.inssa.live-staging.example` | 8, 22 | Placeholder password/token keys. | Safe: values are empty placeholders. |
| Review | `.github/workflows/*.yml` | Multiple | GitHub Actions references `${{ secrets.* }}`. | Safe: references secret names only, not values. |
| Review | `utils/cleanup.ts` | 179 | Runtime `Authorization: Bearer ${accessToken}` construction. | Safe: runtime token variable, no hardcoded token. |
| Review | `utils/security.ts`, `utils/inssa-lifecycle-network.ts` | Multiple | Secret-detection/redaction regex patterns. | Safe: detection code, no concrete secret. |
| Review | Docs | Multiple | Terms such as tokenized/tokenless access. | Safe: product/security documentation; no concrete token after artifact untracking. |

Direct tracked-file grep after remediation found no matches for:

- UUID-style `token=...` or `token-...` share tokens.
- `BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`, or `BEGIN OPENSSH PRIVATE KEY`.
- AWS access key IDs matching `AKIA...`.
- OpenAI-style `sk-...` keys.
- Concrete `Bearer <token>` values.

## Gitignore Gaps Fixed

Added or hardened:

- `.env.*`
- `!.env.example`
- `!.env.inssa.live-staging.example`
- `lifecycle-investigations/`
- `.vscode/`
- `.idea/`
- `Thumbs.db`
- `*.tmp`
- `*.bak`
- `*.swp`
- `trace.zip`
- `*.trace.zip`
- `*.webm`

Existing generated-output ignores retained:

- `playwright-report/`
- `test-results/`
- `lifecycle-artifacts/`
- `lifecycle-campaigns/`
- `security-campaigns/`
- `reports/`

## Git Status Classification

Safe to commit:

- `.gitignore`
- `docs/release-gate-gitignore-audit.md`

Generated artifacts intentionally removed from tracking:

- `lifecycle-investigations/**`

Ignored local sensitive files:

- `.env`
- `.env.inssa.live-staging`

No potential secret exposure should remain in `git status` after committing the `.gitignore` update, this audit report, and the `lifecycle-investigations/**` removals.

## Manual Action Required

1. Include the staged removal of `lifecycle-investigations/**` in the release commit.
2. If commits containing `lifecycle-investigations/**` would be pushed, squash/rewrite before push so those generated artifacts never enter remote history.
3. If `lifecycle-investigations/**` was already pushed to a remote branch, rotate/delete the affected staging share links or rewrite git history according to team policy.
4. Keep `lifecycle-artifacts/`, `lifecycle-campaigns/`, `security-campaigns/`, `reports/`, `playwright-report/`, and `test-results/` out of source control.
5. Do not commit `.env` or `.env.inssa.live-staging`.

## Final Recommendation

**PASS WITH WARNINGS** after the remediation is committed and branch history is handled safely.

The warning is historical/exposure-oriented: tracked generated investigation artifacts previously contained tokenized staging evidence. The working tree now protects those artifacts going forward, but branch history still matters and must be handled outside `.gitignore`.
