# INSSA Final Platform Status

> Historical Phase 15 status. Current release status is `BLOCKED`; see `platform-core-v1.0-release-notes.md` and `platform-security-certification.md`.

Current status for the INSSA QA Security Platform after Phase 15 consolidation.

## Platform Verdict

```text
OPERATIONAL
```

The platform is implemented, documented, automated for routine operation, and able to run QA/security campaigns, generate reports, export SIEM metadata, and send metadata to the Wazuh ingestion endpoint.

Operational warnings remain:

- `public-by-id`
- `media-publicly-accessible`
- reveal-later post-reveal follow-up remains open
- manual staging cleanup remains required

## Current Architecture

```text
Playwright QA campaigns
-> lifecycle/security artifacts
-> reports
-> SIEM export
-> send-to-wazuh.js
-> INSSA ingestion API
-> Wazuh log collection
-> decoder/rules
-> dashboards/alerts
```

Primary docs:

- `README.md`
- `docs/inssa-platform-operations.md`
- `docs/inssa-final-program-report.md`
- `docs/inssa-qa-operations-guide.md`
- `docs/inssa-siem-architecture.md`
- `docs/inssa-dashboard-engineering.md`
- `docs/inssa-alert-routing.md`

## Current Capabilities

| Capability | Status |
| --- | --- |
| Safe INSSA regression suite | Operational |
| Draft mutation tests | Operational, gated |
| Text lifecycle campaign | Operational, gated |
| Media lifecycle campaign | Operational, gated |
| Video lifecycle campaign | Operational, gated |
| Reveal-later lifecycle | Operational, gated |
| Security campaign | Operational |
| Security verification | Operational |
| Cross-user validation | Operational |
| Reveal-later security validation | Operational |
| Persistent artifacts | Operational |
| HTML reports | Operational |
| SIEM export | Operational |
| SIEM send | Operational |
| Wazuh ingestion service | Implemented and documented |
| Wazuh decoder/rules | Implemented and documented |
| Dashboard engineering | Documented |
| Alert routing | Documented |
| Platform healthcheck | Operational |

## Current Limitations

| Limitation | Impact | Handling |
| --- | --- | --- |
| Live staging cleanup remains manual | QA-created staging capsules require development-team cleanup. | Preserve artifact cleanup targets and avoid broad deletion. |
| `public-by-id` remains open | Tokenless capsule-by-ID access requires product/security decision. | Track as high risk until accepted or fixed. |
| `media-publicly-accessible` remains open | Media URL access policy requires review. | Track as high risk until accepted or fixed. |
| Reveal-later post-reveal follow-up remains open | After-reveal behavior is not fully closed for latest scheduled artifact. | Schedule follow-up and update risk matrix. |
| Dashboard verification requires Wazuh UI access | Repo-side automation cannot prove live dashboard rendering without access. | Use Wazuh runbooks and release-gate checklist. |

## Operational Status

Routine commands:

```bash
npm run platform:healthcheck
npm run test:inssa:safe
npm run test:inssa:campaign:security
npm run test:inssa:campaign:security:verify
npm run siem:export
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

Automated SIEM wrappers:

```bash
npm run test:inssa:campaign:security:siem
npm run test:inssa:campaign:cross-user:siem
npm run test:inssa:campaign:reveal-later:siem
```

## Known Findings

| Finding | Severity | Status |
| --- | --- | --- |
| `public-by-id` | High | Confirmed warning |
| `media-publicly-accessible` | High | Confirmed warning |
| `token-optional` | Medium | Confirmed |
| `share-link-only-visibility` | Medium | Confirmed product behavior |
| Reveal-later pre-reveal protection | Informational | Verified |
| Cross-user contact delivery | Informational | Verified |
| Manual staging cleanup | Medium | Operational limitation |

## Deployment Status

| Layer | Status |
| --- | --- |
| QA harness | Operational |
| Campaign runners | Operational |
| Reports | Operational |
| SIEM export | Operational |
| SIEM send | Operational |
| Wazuh ingestion service | Implemented and documented |
| Wazuh decoder/rules | Implemented and documented |
| Dashboards | Designed and documented |
| Alert routing | Designed and documented |
| Runbooks | Complete |

## Final Operational Verdict

```text
OPERATIONAL
```

The platform is ready for routine INSSA QA/security operations with documented warnings and manual cleanup requirements.
