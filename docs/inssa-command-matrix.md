# INSSA Command Matrix

Last updated: 2026-06-11

This matrix covers INSSA-specific npm scripts and the current dashboard exposure status.

## Dashboard-Exposed Commands

| Command | Registry Key | Purpose | Risk | Mutates Staging | Outputs | Dashboard Exposure | Current Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `npm run test:inssa:safe` | `test_inssa_safe` | Run non-mutating INSSA compose/media safe suite. | safe | No | Playwright report, test results | Executable | V1 |
| `npm run test:inssa:campaign:security` | `test_inssa_campaign_security` | Execute OWASP-aligned black-box security campaign. | read-only | No | Security campaign JSON, reports, Playwright report | Executable | V1 |
| `npm run test:inssa:campaign:security:verify` | `test_inssa_campaign_security_verify` | Verify known findings from existing artifacts. | read-only | No | Verification JSON/reports | Executable | V1 |
| `npm run test:inssa:discovery` | `test_inssa_discovery` | Validate authenticated discovery from existing lifecycle artifact. | read-only | No | Playwright report, validation artifacts | Executable with artifact | V1 |
| `npm run test:inssa:public-share` | `test_inssa_public_share` | Validate public/tokenized/tokenless retrieval from existing lifecycle artifact. | read-only | No | Playwright report, validation artifacts | Executable with artifact | V1 |
| `npm run test:inssa:cleanup-audit` | `test_inssa_cleanup_audit` | Audit cleanup controls without deleting/archive/unpublish. | read-only | No | Playwright report, cleanup audit evidence | Executable with artifact | V1 |
| `npm run report:security` | `report_security` | Re-render latest security HTML report from existing findings. | read-only | No | Security HTML reports | Executable as report tool | V1 |
| `npm run report:lifecycle` | `report_lifecycle` | Re-render latest lifecycle HTML report from existing evidence. | read-only | No | Lifecycle HTML reports | Executable as report tool | V1 |
| `npm run siem:export` | `siem_export` | Generate metadata-only SIEM export JSON. | read-only | No | `reports/siem/latest-siem-export.json` | Executable | V1 |
| `npm run platform:healthcheck` | `platform_healthcheck` | Check local platform wiring and expected output locations. | read-only | No | Healthcheck logs/artifacts | Executable for admin | V1 |

## Visible But Disabled In Dashboard

| Command | Purpose | Risk | Mutates Staging | Why Disabled | Current Phase |
| --- | --- | --- | --- | --- | --- |
| `npm run test:inssa:campaign:text` | Text lifecycle campaign. | live mutation | Yes | Requires approval workflow and manual cleanup. | Later |
| `npm run test:inssa:campaign:media` | Media lifecycle campaign. | live mutation | Yes | Creates staging data and uploads media. | Later |
| `npm run test:inssa:campaign:video` | Video lifecycle campaign. | live mutation | Yes | Creates staging data and uploads video. | Later |
| `npm run test:inssa:campaign:reveal-later` | Reveal-later lifecycle campaign. | live mutation | Yes | Creates scheduled staging data and needs post-reveal policy. | Later |
| `npm run test:inssa:campaign:cross-user` | Cross-user access-control campaign. | live mutation | Yes | Creates staging data and needs secondary-account/cleanup confirmation. | Later |
| `npm run test:inssa:campaign:reveal-later-security` | Reveal-later security validation. | conditional mutation | Possible | Artifact resume vs creation must be explicit. | Later |
| `npm run siem:send` | Send SIEM export to Wazuh ingestion endpoint. | external transmission | No | Needs endpoint preview, dry-run, and confirmation workflow. | Later |

## Available CLI Commands Not Exposed As Dashboard Actions

| Command | Purpose | Risk | Mutates Staging | Dashboard Status |
| --- | --- | --- | --- | --- |
| `npm run test:inssa` | Run all INSSA tests under project config. | mixed | Possible | Hidden; too broad for dashboard. |
| `npm run test:inssa:live-staging` | Sequential live staging lifecycle runner. | broad live mutation | Yes | Hidden; should not be primary workflow. |
| `npm run test:inssa:live-text` | Raw text live create spec. | live mutation | Yes | Hidden; use campaign only after approval workflow. |
| `npm run test:inssa:live-media` | Raw media live create spec. | live mutation | Yes | Hidden. |
| `npm run test:inssa:live-video` | Raw video live create spec. | live mutation | Yes | Hidden. |
| `npm run test:inssa:reveal-later` | Raw reveal-later create spec. | live mutation | Yes | Hidden. |
| `npm run test:inssa:draft-mutations` | Draft mutation tests. | mutation | Yes | Hidden until mutation policy exists. |
| `npm run test:inssa:campaign:security:siem` | Security campaign then SIEM export/send wrapper. | external transmission | No | Hidden until SIEM send workflow is approved. |
| `npm run test:inssa:campaign:cross-user:siem` | Cross-user campaign then SIEM wrapper. | live mutation/external transmission | Yes | Hidden. |
| `npm run test:inssa:campaign:reveal-later:siem` | Reveal-later security then SIEM wrapper. | conditional mutation/external transmission | Possible | Hidden. |
| `npm run report:show` | Open Playwright HTML report. | read-only | No | CLI only. |
| `npm run report:open` | Open Playwright HTML report. | read-only | No | CLI only. |
| `npm run dashboard:dev` | Start dashboard dev server. | operations | No | CLI only. |
| `npm run dashboard:build` | Build dashboard. | operations | No | CLI only. |
| `npm run dashboard:start` | Start dashboard production server. | operations | No | CLI only. |

## Exposure Rules

- Dashboard-executable commands must be present in `dashboard/lib/inssa-ops/command-registry.ts`.
- Commands must have `phase1Enabled: true`.
- Commands must have `mutatesStaging: false`.
- Artifact Validation commands must require explicit/latest artifact selection.
- Live lifecycle commands remain disabled until approval and cleanup workflows exist.
- SIEM send remains disabled until transmission confirmation exists.

