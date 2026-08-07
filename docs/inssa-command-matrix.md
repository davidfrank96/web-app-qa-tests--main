# INSSA Command Matrix

Last reviewed: 2026-08-02

Dashboard exposure is derived from `dashboard/lib/inssa-ops/command-registry.ts` and disabled presentation definitions. CLI status is derived from root `package.json`.

## Dashboard Registry

| Registry key | npm script | Purpose | Risk | Mutates staging | Dashboard | Role |
| --- | --- | --- | --- | --- | --- | --- |
| `monitor_inssa_auth_staging` | `test:inssa:monitor:auth:staging` | Three-method authentication monitor for staging. | read-only | No | Executable | operator/admin |
| `monitor_inssa_auth_production` | `test:inssa:monitor:auth:production` | Explicitly confirmed production authentication monitor. | read-only, production guarded | No | Executable when confirmed | operator/admin |
| `test_inssa_safe` | `test:inssa:safe` | Safe compose/media regression baseline. | safe | No | Executable | operator/admin |
| `test_inssa_campaign_text` | `test:inssa:campaign:text` | Create/validate one text lifecycle. | live mutation | Yes | Governed approval | admin |
| `test_inssa_campaign_media` | `test:inssa:campaign:media` | Create/validate one media lifecycle. | live mutation | Yes | Governed approval | admin |
| `test_inssa_campaign_video` | `test:inssa:campaign:video` | Create/validate one video lifecycle. | live mutation | Yes | Governed approval | admin |
| `test_inssa_campaign_reveal_later` | `test:inssa:campaign:reveal-later` | Create or resume reveal-later lifecycle. | live mutation | Yes | Governed create/resume approval | admin |
| `test_inssa_campaign_cross_user` | `test:inssa:campaign:cross-user` | Primary-to-secondary access validation. | live mutation | Yes | Governed approval | admin |
| `test_inssa_campaign_reveal_later_security` | `test:inssa:campaign:reveal-later-security` | Reveal-time access-control validation. | live mutation | Yes | Governed create/resume approval | admin |
| `report_security` | `report:security` | Re-render existing security findings. | read-only | No | Executable | operator/admin |
| `test_inssa_campaign_security` | `test:inssa:campaign:security` | OWASP security campaign. | read-only | No by default | Executable | operator/admin |
| `test_inssa_campaign_security_verify` | `test:inssa:campaign:security:verify` | Verify existing security evidence. | read-only | No | Executable | operator/admin |
| `report_lifecycle` | `report:lifecycle` | Re-render lifecycle report. | read-only | No | Executable | operator/admin |
| `test_inssa_discovery` | `test:inssa:discovery` | Authenticated discovery from selected lifecycle artifact. | read-only | No | Executable with artifact | operator/admin |
| `test_inssa_public_share` | `test:inssa:public-share` | Tokenized/tokenless/public-share validation. | read-only | No | Executable with artifact | operator/admin |
| `test_inssa_cleanup_audit` | `test:inssa:cleanup-audit` | Inspect cleanup controls without mutation. | read-only | No | Executable with artifact | operator/admin |
| `siem_export` | `siem:export` | Generate metadata-only SIEM export. | read-only | No | Executable | operator/admin |
| `platform_healthcheck` | `platform:healthcheck` | Platform wiring check. | read-only operations | No | Executable | admin |

## Lifecycle And Security Campaigns

| Command | Purpose | Risk | Dashboard status | Outputs |
| --- | --- | --- | --- | --- |
| `test:inssa:campaign:text` | Create/validate text lifecycle. | live mutation | Admin governed | Lifecycle summary, evidence, report, cleanup manifest |
| `test:inssa:campaign:media` | Create/validate media lifecycle. | live mutation | Admin governed | Lifecycle summary, media evidence, report, cleanup manifest |
| `test:inssa:campaign:video` | Create/validate video lifecycle. | live mutation | Admin governed | Lifecycle summary, video evidence, report, cleanup manifest |
| `test:inssa:campaign:reveal-later` | Create/resume scheduled lifecycle. | live mutation | Admin governed; explicit mode | Schedule evidence, report, cleanup manifest |
| `test:inssa:campaign:cross-user` | Create and share to secondary user. | high-risk live mutation | Admin governed | Cross-user findings/report, cleanup manifest |
| `test:inssa:campaign:reveal-later-security` | Reveal-time access control campaign. | conditional mutation | Admin governed; explicit mode | Reveal-later findings/report, cleanup manifest |

## Raw INSSA CLI Workflows

| Command | Purpose | Mutation | Dashboard |
| --- | --- | --- | --- |
| `test:inssa` | Run all INSSA project tests. | Mixed | Hidden |
| `test:inssa:live-staging` | Broad sequential lifecycle workflow. | Yes | Hidden |
| `test:inssa:live-text` | Raw text creation spec. | Yes | Hidden |
| `test:inssa:live-media` | Raw media creation spec. | Yes | Hidden |
| `test:inssa:live-video` | Raw video creation spec. | Yes | Hidden |
| `test:inssa:reveal-later` | Raw reveal-later creation spec. | Yes | Hidden |
| `test:inssa:draft-mutations` | Draft mutation/restore coverage. | Yes | Hidden |

## Artifact Validation CLI

| Command | Artifact requirement | Mutation | Output |
| --- | --- | --- | --- |
| `test:inssa:discovery` | Successful lifecycle artifact | No | Playwright/evidence output |
| `test:inssa:public-share` | Successful lifecycle artifact | No | Access-validation evidence |
| `test:inssa:cleanup-audit` | Successful lifecycle artifact | No destructive action | Cleanup-capability evidence |

## Reports, SIEM, And Operations

| Command | Purpose | Dashboard |
| --- | --- | --- |
| `report:show`, `report:open` | Open local Playwright report viewer. | CLI only |
| `report:security` | Re-render security HTML. | Executable |
| `report:lifecycle` | Re-render lifecycle HTML. | Executable |
| `siem:export` | Generate metadata-only export. | Executable |
| `siem:send` | Send to authenticated Wazuh endpoint. | Visible disabled |
| `test:inssa:campaign:security:siem` | Campaign/export/send wrapper. | Hidden |
| `test:inssa:campaign:cross-user:siem` | Cross-user/export/send wrapper. | Hidden |
| `test:inssa:campaign:reveal-later:siem` | Reveal-later/export/send wrapper. | Hidden |
| `platform:healthcheck` | Platform healthcheck. | Admin executable |
| `dashboard:doctor` | Runtime/configuration validation. | CLI only |
| `dashboard:clean` | Safe `.next` cleanup. | CLI only |
| `dashboard:dev` | Development supervisor. | CLI only |
| `dashboard:build` | Production build and doctor validation. | CLI only |
| `dashboard:start` | Production supervisor. | CLI only |
| `dashboard:worker` | Dedicated worker. | CLI/service only |
| `dashboard:scheduler` | Producer-only scheduler. | CLI/service only |

## Other Product Commands

| Command | Status |
| --- | --- |
| `test:localman` | Implemented CLI Playwright project; no managed dashboard campaign. |
| `test:kbean` | Implemented CLI Playwright project; no managed dashboard campaign. |
| `test:mobile` | Generic mobile project; no managed dashboard campaign. |

## Generic Playwright And Dashboard Commands

| Command | Purpose | Dashboard exposure |
| --- | --- | --- |
| `test` | Run the default Playwright suite. | Hidden |
| `test:ui` | Open Playwright UI mode. | CLI only |
| `report` | Open the default Playwright report. | CLI only |
| `install:browsers` | Install Playwright browser binaries. | Setup only |
| `codegen` | Open Playwright code generation. | Development only |
| `test:inssa:monitor:auth` | Alias for staging authentication monitoring. | CLI alias; dashboard uses explicit staging key |

Dashboard package-only commands, normally invoked with `npm --prefix dashboard run <command>`:

| Command | Purpose |
| --- | --- |
| `doctor` | Runtime/configuration validation. |
| `clean` | Safe runtime artifact cleanup. |
| `dev` | Development supervisor. |
| `build` | Production build and post-build doctor. |
| `start` | Production supervisor. |
| `worker` | Dedicated worker. |
| `scheduler` | Producer-only scheduler. |
| `persistence:provision` | Verify metadata resources and provision private evidence bucket. |
| `persistence:verify` | Verify resources without creating the bucket. |
| `test:execution-foundation` | Run dashboard subsystem regression tests. |

No command omitted from the registry may be invoked through the dashboard.
