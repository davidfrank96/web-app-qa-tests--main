# INSSA SIEM Navigation

Primary Wazuh URL:

```text
https://wazuh.kbeanprobo.com
```

Primary INSSA dashboard:

```text
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

This is the operator navigation map for the INSSA QA Security Platform. It is intentionally not another architecture document; use it to find dashboards, saved searches, campaign outputs, investigation terms, rules, reports, and daily operating paths.

## 1. Overview

The INSSA SIEM platform turns QA and security campaign results into Wazuh events.

Operational flow:

```text
QA Campaigns
  -> Security Findings
  -> SIEM Export
  -> Wazuh
  -> Dashboards
  -> Investigation
  -> Cleanup / Engineering Follow-Up
```

Use Wazuh for:

- Finding triage.
- Campaign health.
- Release-gate visibility.
- Cleanup tracking.
- Investigation routing.
- Historical evidence retention.

Base Wazuh filter for INSSA:

```text
data.product:INSSA AND data.source:web-app-qa-tests
```

## 2. Dashboard Directory

| Name | Purpose | URL | When To Use |
| --- | --- | --- | --- |
| INSSA Security Center | Primary landing page for all INSSA observability. | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center` | Start here for daily operations, campaign review, cleanup review, and navigation to deeper dashboards. |
| INSSA Security Overview | Security triage for findings, risk levels, classifications, and active risks. | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-overview` | Use when Critical, High, or Open Findings change. |
| INSSA Campaign Operations | Campaign history, campaign status, release-gate trend, and summary event visibility. | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-campaign-operations` | Use after campaign runs or when expected campaign summaries are missing. |
| INSSA Cleanup Queue | Manual staging cleanup queue for lifecycle artifacts and cleanup events. | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-cleanup-queue` | Use whenever Cleanup Queue Count is non-zero. |
| INSSA Executive View | Rollup for leadership review: findings, campaign health, and cleanup debt. | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-executive-view` | Use for release reviews, stakeholder summaries, and weekly status. |

Fastest dashboard path from Wazuh Home:

```text
Explore -> Dashboards -> INSSA Security Center
```

Fastest path for returning users:

```text
Recently viewed -> INSSA Security Center
```

## 3. Saved Search Directory

| Name | Purpose | URL | Use Case |
| --- | --- | --- | --- |
| INSSA Security Center Recent Activity | Recent INSSA events shown in the Security Center. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-security-center-recent-activity` | Inspect latest campaign, classification, severity, status, and run ID rows. |
| INSSA Campaign Summaries | All campaign summary events. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-campaign-summaries` | Confirm campaign summaries arrived after SIEM export/send. |
| INSSA Security Summaries | Security campaign summaries. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-security-summaries` | Investigate OWASP/security campaign rollups. |
| INSSA Cross User Summaries | Cross-user campaign summaries. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-cross-user-summaries` | Investigate user isolation and targeted-share results. |
| INSSA Reveal Later Summaries | Reveal-later campaign summaries. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-reveal-later-summaries` | Investigate pre-reveal or after-reveal access-control results. |
| INSSA Release Gate Summaries | Release-gate campaign summaries. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-release-gate-summaries` | Review push/release readiness events. |
| INSSA Critical Findings | Critical rule-level findings. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-critical-findings` | Immediate incident triage. |
| INSSA High Findings | High and critical rule-level findings. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-high-findings` | Security/product ticketing and risk review. |
| INSSA Open Findings | Failed, warning, or finding-bearing events. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-open-findings` | Daily open work queue. |
| INSSA Cleanup Queue | Cleanup target rows and artifact references. | `https://wazuh.kbeanprobo.com/app/discover#/view/inssa-cleanup-queue` | Extract exact cleanup artifact/report references. |

## 4. Investigation Keywords

Use these keywords in dashboards, Discover, or saved searches.

| Keyword | Meaning | Severity | When To Investigate |
| --- | --- | --- | --- |
| `public-by-id` | Tokenless `/capsule/<id>` exposes capsule content. | High | Investigate immediately unless product has explicitly accepted public-by-ID behavior. |
| `media-publicly-accessible` | Media URL is accessible without expected token/auth controls. | High | Investigate when media campaigns or verification campaigns surface it. |
| `expected-share-access` | Targeted contact share worked as expected. | Informational | Retain as evidence; investigate only if it appears outside cross-user/contact-share context. |
| `reveal-protected` | Reveal-later content was protected before reveal time. | Informational | Retain as positive access-control evidence. |
| `share-link-only-visibility` | Capsule is retrievable by share/direct route but not broadly indexed in authenticated surfaces. | Medium | Investigate if product expects feed/search/profile discovery. |
| `token-optional` | Tokenized and tokenless routes both work. | Medium | Investigate against product share-token policy. |
| `campaign_summary` | SIEM event summarizing a campaign run. | Informational to High | Investigate if expected campaign summaries are missing or failed. |
| `release-gate` | Release-gate campaign or summary event. | Medium to High | Investigate before push/release decisions. |
| `cross-user` | Cross-user access-control campaign or summary event. | Informational to High | Investigate user isolation, targeted contact delivery, and unexpected visibility. |
| `security_campaign` | OWASP/security campaign event type. | Informational to Critical | Investigate when status is failed, warning, or passed-with-findings. |
| `reveal-later` | Reveal-later lifecycle or security campaign. | Informational to Critical | Investigate pre-reveal access, after-reveal follow-up, or scheduling evidence. |
| `authentication-bypass` | Confirmed auth bypass classification. | Critical | Escalate immediately to Security and Platform. |
| `unauthorized-visible` | Unauthorized user can view content unexpectedly. | Critical | Escalate immediately to Security and Engineering. |
| `manual-dev-cleanup-required` | Live staging artifact requires manual cleanup. | Medium | Assign cleanup owner and track until confirmed. |
| `lifecycle-failed` | Lifecycle campaign failed. | Medium to High | Inspect lifecycle report/artifact before rerun. |
| `finalized-and-retrievable` | Lifecycle finalization and retrieval succeeded. | Informational | Use as positive lifecycle evidence. |

## 5. Rule Directory

Authoritative current INSSA rules are documented in `docs/wazuh-inssa-rules.md`.

| Rule ID | Description | Severity |
| --- | --- | --- |
| `121000` | Base INSSA QA campaign event, source `web-app-qa-tests`, product `INSSA`. | Informational, level 3 |
| `121010` | INSSA critical access-control finding: `unauthorized-visible`. | Critical, level 14 |
| `121011` | INSSA critical authentication finding: `authentication-bypass`. | Critical, level 14 |
| `121020` | INSSA high-risk access finding: `public-by-id`. | High, level 10 |
| `121021` | INSSA high-risk media finding: `media-publicly-accessible`. | High, level 10 |
| `121030` | INSSA medium lifecycle visibility finding: `share-link-only-visibility`. | Medium, level 7 |
| `121031` | INSSA medium token behavior finding: `token-optional`. | Medium, level 7 |
| `121040` | INSSA informational reveal-later finding: `reveal-protected`. | Informational, level 3 |
| `121041` | INSSA informational cross-user finding: `expected-share-access`. | Informational, level 3 |

Legacy validation reference:

| Rule ID | Description | Status |
| --- | --- | --- |
| `100520` | Older platform-validation checklist reference for a `public-by-id` dashboard event. | Legacy reference only; not present in the current rule XML documented in `docs/wazuh-inssa-rules.md`. |

If Wazuh shows `100500`, `100520`, `100530`, or `100540` in a live dashboard, compare the deployed `/var/ossec/etc/rules/local_rules.xml` against this repo and update this navigation file only after confirming the active server rules.

## 6. Campaign Directory

| Campaign | Purpose | Command | Report Output | SIEM Output |
| --- | --- | --- | --- | --- |
| Security Campaign | OWASP-aligned black-box classification over staging and existing artifacts. | `npm run test:inssa:campaign:security` | `reports/security/latest-security-summary.html` | `security-campaigns/*.json`, `reports/siem/latest-siem-export.json` after export |
| Security Verification | Reproduces/classifies known access-control, tokenless, media, reveal-later, and cross-user findings from artifacts. | `npm run test:inssa:campaign:security:verify` | `reports/security/security-verification.html` | `security-campaigns/verification/latest-security-verification.json`, SIEM export after `npm run siem:export` |
| Cross User Campaign | Creates one targeted-contact capsule and validates secondary-user access. | `npm run test:inssa:campaign:cross-user` | `reports/security/cross-user-security.html` | `security-campaigns/cross-user/latest-cross-user-verification.json`, SIEM export after `npm run siem:export` |
| Reveal Later Campaign | Creates/probes reveal-later lifecycle or validates reveal-later access-control behavior. | `npm run test:inssa:campaign:reveal-later-security` | `reports/security/reveal-later-access-control.html` | `security-campaigns/reveal-later/latest-reveal-later-security.json`, SIEM export after `npm run siem:export` |
| Release Gate | Validates QA infrastructure push/release readiness. | Follow release-gate checklist in `docs/inssa-qa-operations-guide.md`; latest phase used explicit validation commands. | Release-gate docs and summaries under `docs/` and `reports/`. | `reports/siem/latest-siem-export.json` after export |
| Lifecycle Campaign - Text | Create one text capsule, discovery, and public-share validation. | `npm run test:inssa:campaign:text` | `reports/lifecycle/latest-lifecycle-summary.html` | `lifecycle-campaigns/*campaign-text.json`, SIEM export after `npm run siem:export` |
| Lifecycle Campaign - Media | Create one image capsule, discovery, and public-share validation. | `npm run test:inssa:campaign:media` | `reports/lifecycle/latest-lifecycle-summary.html` | `lifecycle-campaigns/*campaign-media.json`, SIEM export after `npm run siem:export` |
| Lifecycle Campaign - Video | Create one video capsule, discovery, and public-share validation. | `npm run test:inssa:campaign:video` | `reports/lifecycle/latest-lifecycle-summary.html` | `lifecycle-campaigns/*campaign-video.json`, SIEM export after `npm run siem:export` |
| Lifecycle Campaign - Reveal Later | Create one reveal-later lifecycle artifact. | `npm run test:inssa:campaign:reveal-later` | `reports/lifecycle/latest-lifecycle-summary.html` | `lifecycle-campaigns/*campaign-reveal-later.json`, SIEM export after `npm run siem:export` |
| SIEM Export | Normalize campaign/report metadata into Wazuh-compatible JSON. | `npm run siem:export` | `reports/siem/latest-siem-export.json` | `reports/siem/latest-siem-export.json` |
| SIEM Send | Send metadata-only SIEM events to Wazuh ingestion. | `npm run siem:send` | Console summary | Wazuh events under `wazuh-alerts-*` |

SIEM wrapper commands:

| Wrapper | Flow |
| --- | --- |
| `npm run test:inssa:campaign:security:siem` | Run security campaign, export SIEM events, send to Wazuh. |
| `npm run test:inssa:campaign:cross-user:siem` | Run cross-user campaign, export SIEM events, send to Wazuh. |
| `npm run test:inssa:campaign:reveal-later:siem` | Run reveal-later security campaign, export SIEM events, send to Wazuh. |

## 7. Daily Operations

### Morning Review

1. Open `INSSA Security Center`.
2. Confirm filter is `data.product:INSSA AND data.source:web-app-qa-tests`.
3. Confirm time range is `Last 30 days`.
4. Review Critical Findings, High Findings, Open Findings, Campaigns Run, Release Gate Status, and Cleanup Queue Count.
5. Open `INSSA Cleanup Queue` if cleanup count is non-zero.

### Security Review

1. Open `INSSA Security Overview`.
2. Review Critical Findings and High Findings.
3. Check Findings By Classification.
4. Use `INSSA Critical Findings`, `INSSA High Findings`, or `INSSA Open Findings` saved searches for raw rows.
5. Escalate `unauthorized-visible`, `authentication-bypass`, `public-by-id`, and `media-publicly-accessible`.

### Campaign Review

1. Open `INSSA Campaign Operations`.
2. Confirm `campaign_summary` events exist after expected runs.
3. Confirm campaign statuses are `passed`, `passed-with-findings`, `passed-with-warnings`, or intentionally failed with an owner.
4. Use `INSSA Campaign Summaries` for raw campaign rows.

### Cleanup Review

1. Open `INSSA Cleanup Queue`.
2. Identify run IDs, artifact paths, report paths, and cleanup classification.
3. Notify the development team for manual cleanup.
4. Do not delete staging data from Wazuh.

### Weekly Review

1. Review `INSSA Executive View`.
2. Confirm high-risk findings have owners.
3. Confirm cleanup targets are not aging silently.
4. Confirm campaign cadence is healthy.
5. Confirm SIEM export/send workflow is current.

## 8. Quick Links

### Most Used URLs

| Use | URL |
| --- | --- |
| Wazuh | `https://wazuh.kbeanprobo.com` |
| INSSA Security Center | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center` |
| Security Overview | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-overview` |
| Campaign Operations | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-campaign-operations` |
| Cleanup Queue | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-cleanup-queue` |
| Executive View | `https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-executive-view` |
| Discover | `https://wazuh.kbeanprobo.com/app/discover#/` |

### Most Used Dashboards

- INSSA Security Center.
- INSSA Security Overview.
- INSSA Campaign Operations.
- INSSA Cleanup Queue.
- INSSA Executive View.

### Most Used Searches

- INSSA Security Center Recent Activity.
- INSSA Critical Findings.
- INSSA High Findings.
- INSSA Open Findings.
- INSSA Campaign Summaries.
- INSSA Cleanup Queue.

### Most Used Rule IDs

- `121010`: unauthorized-visible.
- `121011`: authentication-bypass.
- `121020`: public-by-id.
- `121021`: media-publicly-accessible.
- `121030`: share-link-only-visibility.
- `121031`: token-optional.

### Most Used Findings

- `public-by-id`.
- `media-publicly-accessible`.
- `share-link-only-visibility`.
- `token-optional`.
- `expected-share-access`.
- `reveal-protected`.
- `manual-dev-cleanup-required`.

## 9. Troubleshooting

| Symptom | Likely Cause | Action |
| --- | --- | --- |
| Dashboard missing | Saved objects not imported or wrong tenant/context. | Open Dashboards list and search `INSSA`. If absent, import `exports/inssa-security-center.ndjson`. |
| No events | Time range too narrow, SIEM send not run, ingestion issue, or wrong filter. | Set time range to Last 30 days and confirm `data.product:INSSA AND data.source:web-app-qa-tests`. |
| No campaign summaries | Campaign ran locally but SIEM export/send did not run. | Run `npm run siem:export`, then `npm run siem:send`. |
| No findings | There may be no findings in the selected time range, or Wazuh rules did not match. | Check `INSSA Security Center Recent Activity` and rule IDs in Discover. |
| No alerts | Decoder/rules may not be loaded or event classification is not mapped. | Validate `docs/wazuh-inssa-decoder.md` and `docs/wazuh-inssa-rules.md` against server config. |
| No SIEM data | Export missing, send failed, ingestion service down, or Wazuh logcollector not reading. | Check `reports/siem/latest-siem-export.json`, `npm run siem:send -- --dry-run`, and ingestion runbooks. |
| Security Center opens blank | Wazuh app route sometimes initializes better after entering Dashboards app first. | Open `https://wazuh.kbeanprobo.com/app/dashboards#/list`, then open Security Center. |
| INSSA not visible from Wazuh Home | INSSA is not a custom left-nav section. | Use bookmark or Dashboards list. Default-route change requires platform owner approval. |
| Cleanup count non-zero | Live QA staging artifacts require manual cleanup. | Open `INSSA Cleanup Queue`, extract artifact/report references, and notify dev team. |

## 10. Platform Status

Current status:

```text
OPERATIONAL WITH WARNINGS
```

Operational components:

- INSSA lifecycle campaigns.
- INSSA security campaigns.
- Security verification.
- Cross-user validation.
- Reveal-later validation.
- Metadata-only SIEM export.
- Wazuh ingestion.
- Wazuh decoder and rules.
- INSSA dashboards and saved searches.
- Operator documentation.

Known findings:

| Finding | Status |
| --- | --- |
| `public-by-id` | Confirmed high-risk/product-policy finding. |
| `media-publicly-accessible` | Confirmed high-risk/product-policy finding. |
| `share-link-only-visibility` | Confirmed visibility behavior; policy-dependent. |
| `token-optional` | Confirmed token behavior; policy-dependent. |
| `expected-share-access` | Confirmed targeted share behavior. |
| `reveal-protected` | Confirmed pre-reveal protection evidence. |
| Manual staging cleanup | Required for live QA-created capsules. |

Known risks:

- INSSA is not yet a first-class Wazuh left-navigation entry.
- Wazuh default route is currently overridden to `/app/wz-home`.
- Default-route change requires platform owner approval.
- Wazuh Reporting has zero active report definitions.
- Reveal-later after-reveal follow-up remains a tracked validation item.

Future dashboards:

| Dashboard | Status |
| --- | --- |
| INSSA Historical Trends | Designed but not built. |

## 11. Validation

Validation source:

- `docs/wazuh-ui-inventory.md`
- `docs/wazuh-navigation-map.md`
- `docs/inssa-security-center.md`
- `docs/inssa-daily-operations.md`
- `docs/wazuh-inssa-rules.md`
- `package.json`
- `reports/siem/latest-siem-export.json`

Validated inventory:

| Item | Result |
| --- | --- |
| Dashboard names match saved-object inventory | Verified in Phase 13H inventory. |
| Saved search names match saved-object inventory | Verified in Phase 13H inventory. |
| Dashboard URLs use known saved object IDs | Verified from Wazuh saved-object API output documented in repo. |
| Rule IDs match current rule deployment document | `121000-121041` documented in `docs/wazuh-inssa-rules.md`. |
| Legacy rule ID references identified | `100520` appears only as an older validation reference. |
| Campaign commands match `package.json` | Verified from current scripts. |
| No unsupported Wazuh navigation hacks required | Confirmed. |

Validation commands for this file:

```bash
git diff --check -- SIEM_NAVIGATION.md
rg -n "TO""DO|TB""D|PLACE""HOLDER|place""holder" SIEM_NAVIGATION.md
```

Expected result:

```text
No whitespace errors.
No draft-marker terms.
```
