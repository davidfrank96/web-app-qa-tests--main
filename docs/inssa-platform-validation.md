# INSSA Platform Validation

> Historical Phase 14 validation record. Use the current release guide and deployment checklist for Platform Core v1.0 certification.

Phase 14 validates the INSSA QA Security Platform end to end.

Validation rule:

```text
No assumptions. A check is marked verified only when a command was executed and the result was observed in this phase.
```

## Validation Summary

| Area | Status | Evidence |
| --- | --- | --- |
| SIEM export | Verified | `npm run siem:export` completed and wrote `reports/siem/latest-siem-export.json`. |
| SIEM send to ingestion API | Verified | `SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send` completed with `events sent: 45`. |
| `public-by-id` event generation | Verified | `reports/siem/latest-siem-export.json` contains 3 events whose `classification` includes `public-by-id`. |
| Security campaign outputs | Verified | `security-campaigns/lifecycle-security.json` exists and reports `status: passed-with-findings`. |
| Verification campaign outputs | Verified | `security-campaigns/verification/latest-security-verification.json` exists. |
| Cross-user campaign outputs | Verified | `security-campaigns/cross-user/latest-cross-user-verification.json` exists. |
| Reveal-later campaign outputs | Verified | `security-campaigns/reveal-later/latest-reveal-later-security.json` exists. |
| Decoder loading | Not verified in this phase | Requires Wazuh host access or dashboard/logtest evidence. |
| Rule loading | Not verified in this phase | Requires Wazuh host access or dashboard/logtest evidence. |
| Ingestion service process | Not verified in this phase | Requires Wazuh host service access. |
| Nginx routing internals | Partially verified | Public endpoint accepted SIEM send; Nginx process/config was not directly verified. |
| Wazuh collection | Not verified in this phase | Requires `/var/ossec/logs/inssa-qa.log` and Wazuh logcollector visibility. |
| Dashboard visibility | Not verified in this phase | Requires Wazuh dashboard access or exported dashboard evidence. |
| Rule ID `100520` in dashboard | Not verified in this phase | Dashboard access was unavailable from this workspace. |
| `alerts.json` contains event | Not verified in this phase | Requires Wazuh host access. |
| `inssa-qa.log` contains event | Not verified in this phase | Requires Wazuh host access. |
| Service survives restart | Not verified in this phase | Requires Wazuh host access. |
| Nginx survives reload | Not verified in this phase | Requires Wazuh host access. |
| `wazuh-manager` survives restart | Not verified in this phase | Requires Wazuh host access. |

## Commands Executed

### Repo State

```bash
git status --short
```

Result:

```text
Repository contains a large existing INSSA working tree with staged, modified, added, deleted, and untracked files from prior phases.
```

### SIEM Export

```bash
npm run siem:export
```

Observed result:

```text
INSSA SIEM export complete.
output: reports/siem/latest-siem-export.json
events: 45
severities: {"medium":8,"high":9,"critical":16,"informational":12}
statuses: {"passed-with-warnings":6,"failed":15,"passed":15,"passed-with-findings":3,"classified":6}
media policy: screenshots/videos/traces excluded; metadata and report/artifact references only
```

### SIEM Dry Run

```bash
npm run siem:send -- --dry-run
```

Observed result:

```text
INSSA SIEM dry run complete.
input: reports/siem/latest-siem-export.json
events: 46
severities: {"medium":8,"high":9,"critical":16,"informational":13}
statuses: {"passed-with-warnings":6,"failed":15,"passed":16,"passed-with-findings":3,"classified":6}
example Wazuh ingestion endpoint: https://wazuh.kbeanprobo.com/inssa
send skipped: --dry-run or SIEM_DRY_RUN=1
```

Note:

```text
The dry-run command produced an in-memory normalization count that differed from the written export count. The written export was re-read after export and contained 45 events.
```

### Public-By-ID Event Verification In Export

```bash
node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("reports/siem/latest-siem-export.json","utf8")); console.log(JSON.stringify({eventCount:j.eventCount,actualEvents:j.events.length,publicByIdEvents:j.events.filter(e=>String(e.classification||"").includes("public-by-id")).length,generatedAt:j.generatedAt},null,2));'
```

Observed result:

```json
{
  "eventCount": 45,
  "actualEvents": 45,
  "publicByIdEvents": 3,
  "generatedAt": "2026-06-06T02:18:45.170Z"
}
```

### SIEM Send To Ingestion API

```bash
SIEM_WAZUH_URL=https://wazuh.kbeanprobo.com/inssa SIEM_SEND_BATCH=1 npm run siem:send
```

Observed result:

```text
INSSA SIEM send complete.
endpoint: https://wazuh.kbeanprobo.com/inssa
mode: batch
events sent: 45
```

Verified path:

```text
QA Repo -> SIEM Export -> send-to-wazuh.js -> Ingestion API
```

Not verified from this command:

```text
Ingestion API -> inssa-qa.log -> Wazuh Logcollector -> Decoder -> Rules -> Alerts -> Dashboard
```

### Server Access Probe

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 wazuh.kbeanprobo.com 'hostname && date'
```

Observed result:

```text
Host key verification failed.
```

Impact:

```text
Server-side checks could not be performed without establishing trusted SSH host-key access or another approved Wazuh administrative access path.
```

## Campaign Output Verification

| Output | Path | Verified |
| --- | --- | --- |
| SIEM export | `reports/siem/latest-siem-export.json` | Yes |
| Security campaign | `security-campaigns/lifecycle-security.json` | Yes |
| Security verification | `security-campaigns/verification/latest-security-verification.json` | Yes |
| Cross-user verification | `security-campaigns/cross-user/latest-cross-user-verification.json` | Yes |
| Reveal-later security | `security-campaigns/reveal-later/latest-reveal-later-security.json` | Yes |
| Security verification report | `reports/security/security-verification.html` | Yes |
| Cross-user report | `reports/security/cross-user-security.html` | Yes |
| Reveal-later report | `reports/security/reveal-later-security.html` | Yes |

## Required End-To-End Path Status

| Path Segment | Status |
| --- | --- |
| QA Repo | Verified |
| Export | Verified |
| Ingestion API | Verified by successful HTTP send |
| Logcollector | Not verified |
| Decoder | Not verified |
| Rules | Not verified |
| Alerts | Not verified |
| Dashboard | Not verified |

## Unverified Required Checks

These checks remain unverified because this workspace could not access the Wazuh host or dashboard:

- `rule.id 100520` appears inside dashboard.
- `/var/ossec/logs/alerts/alerts.json` contains the `public-by-id` event.
- `/var/ossec/logs/inssa-qa.log` contains the event.
- `inssa-ingestion` service survives restart.
- Nginx survives reload.
- `wazuh-manager` survives restart.
- Decoder loading is active on the host.
- Rule loading is active on the host.

## Commands Required To Complete Server-Side Validation

Run on `wazuh.kbeanprobo.com` with approved administrative access:

```bash
sudo tail -n 20 /var/ossec/logs/inssa-qa.log
sudo grep -n "public-by-id" /var/ossec/logs/inssa-qa.log | tail -n 5
sudo grep -n "100520" /var/ossec/logs/alerts/alerts.json | tail -n 5
sudo grep -n "public-by-id" /var/ossec/logs/alerts/alerts.json | tail -n 5
sudo systemctl restart inssa-ingestion
sudo systemctl status inssa-ingestion --no-pager
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
sudo systemctl restart wazuh-manager
sudo systemctl status wazuh-manager --no-pager
sudo /var/ossec/bin/wazuh-logtest
```

Dashboard validation:

```text
Open Wazuh Dashboard.
Filter source:web-app-qa-tests.
Filter product:INSSA.
Filter classification:public-by-id.
Confirm rule.id 100520 appears for the validation event.
Confirm event timestamp is after the Phase 14 SIEM send.
```

## Validation Verdict

```text
FAIL
```

Reason:

```text
The QA repo, export, and ingestion API send path were verified. The requested Wazuh host, logcollector, decoder, rules, alerts.json, dashboard, and restart validations were not verified in this phase because trusted server-side access was unavailable. Under the no-assumptions rule, the platform cannot receive a PASS or PASS WITH WARNINGS verdict.
```
