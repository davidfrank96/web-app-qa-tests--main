# Wazuh INSSA QA Decoder Package

Target server:

```text
wazuh-siems-monitor
```

Known Wazuh paths:

```text
/var/ossec/etc/decoders/local_decoder.xml
/var/ossec/etc/rules/local_rules.xml
```

This document is documentation-only. Do not apply these changes from the QA repo. A Wazuh administrator should copy the XML into the target server and validate it there.

## Event Schema

INSSA QA SIEM events are JSON and are exported from:

```text
reports/siem/latest-siem-export.json
```

Required match fields:

```text
source=web-app-qa-tests
product=INSSA
```

Fields expected to be extracted:

| Field | Example |
| --- | --- |
| `product` | `INSSA` |
| `eventType` | `lifecycle_campaign` |
| `severity` | `high` |
| `classification` | `share-link-only-visibility` |
| `status` | `passed-with-warnings` |
| `campaign` | `text` |
| `environment` | `staging` |
| `runId` | `20ed1890ed7c-f658c3a631` |

The Wazuh `JSON_Decoder` extracts JSON keys as fields. The custom decoder below identifies INSSA QA events and lets rules match extracted fields directly.

## Ready-To-Paste Decoder XML

Append this block to:

```text
/var/ossec/etc/decoders/local_decoder.xml
```

```xml
<!-- INSSA QA campaign events from web-app-qa-tests. -->
<decoder name="inssa_qa">
  <prematch>"source":"web-app-qa-tests"</prematch>
  <plugin_decoder>JSON_Decoder</plugin_decoder>
</decoder>

<!-- Child decoder narrows parsed JSON events to the INSSA product. -->
<decoder name="inssa_qa_product">
  <parent>inssa_qa</parent>
  <field name="product">INSSA</field>
</decoder>
```

Expected extracted fields after `JSON_Decoder`:

```text
source
product
eventType
timestamp
campaign
environment
severity
classification
status
runId
artifactReference.path
reportReference.path
dashboardFields.campaign
dashboardFields.classification
dashboardFields.environment
dashboardFields.eventType
dashboardFields.report
dashboardFields.runId
dashboardFields.severity
dashboardFields.status
```

If the collector sends the full batch object from `latest-siem-export.json`, split `events[]` into individual event objects before Wazuh rule evaluation. This decoder is intended for individual event JSON objects.

## Decoder Validation Examples

These examples are derived from `reports/siem/latest-siem-export.json`.

### Release Gate Event

```json
{
  "source": "web-app-qa-tests",
  "product": "INSSA",
  "eventType": "release_gate",
  "severity": "medium",
  "classification": "gitignore-secrets-audit",
  "status": "passed-with-warnings",
  "campaign": "release-gate",
  "environment": "repository"
}
```

Expected parse:

```text
decoder.name=inssa_qa
product=INSSA
eventType=release_gate
severity=medium
classification=gitignore-secrets-audit
status=passed-with-warnings
campaign=release-gate
environment=repository
```

### Lifecycle Campaign Event

```json
{
  "source": "web-app-qa-tests",
  "product": "INSSA",
  "eventType": "lifecycle_campaign",
  "severity": "high",
  "classification": "share-link-only-visibility",
  "status": "passed-with-warnings",
  "campaign": "text",
  "environment": "staging",
  "runId": "20ed1890ed7c-f658c3a631"
}
```

Expected parse:

```text
decoder.name=inssa_qa
product=INSSA
eventType=lifecycle_campaign
severity=high
classification=share-link-only-visibility
status=passed-with-warnings
campaign=text
environment=staging
runId=20ed1890ed7c-f658c3a631
```

### Security Campaign Event

```json
{
  "source": "web-app-qa-tests",
  "product": "INSSA",
  "eventType": "security_campaign",
  "severity": "high",
  "classification": "token-required,share-link-only,delayed-indexing,token-optional,public-by-id,media-publicly-accessible",
  "status": "passed-with-findings",
  "campaign": "security",
  "environment": "staging",
  "runId": "20ed1890ed7c-5fd91d5835"
}
```

Expected parse:

```text
decoder.name=inssa_qa
product=INSSA
eventType=security_campaign
severity=high
classification=token-required,share-link-only,delayed-indexing,token-optional,public-by-id,media-publicly-accessible
status=passed-with-findings
campaign=security
environment=staging
runId=20ed1890ed7c-5fd91d5835
```

### Discovery Campaign Event

```json
{
  "source": "web-app-qa-tests",
  "product": "INSSA",
  "eventType": "discovery_campaign",
  "severity": "informational",
  "classification": "share-link-only-visibility",
  "status": "passed",
  "campaign": "authenticated-discovery",
  "environment": "staging",
  "runId": "25d81e2e79eb-b29df91b6b"
}
```

Expected parse:

```text
decoder.name=inssa_qa
product=INSSA
eventType=discovery_campaign
severity=informational
classification=share-link-only-visibility
status=passed
campaign=authenticated-discovery
environment=staging
runId=25d81e2e79eb-b29df91b6b
```

## Installation Steps

On `wazuh-siems-monitor`:

1. Back up the current decoder file:

```bash
sudo cp /var/ossec/etc/decoders/local_decoder.xml /var/ossec/etc/decoders/local_decoder.xml.bak.$(date +%Y%m%d%H%M%S)
```

2. Append the decoder XML from this document to:

```text
/var/ossec/etc/decoders/local_decoder.xml
```

3. Validate XML syntax if local tooling is available:

```bash
sudo xmllint --noout /var/ossec/etc/decoders/local_decoder.xml
```

4. Restart Wazuh manager:

```bash
sudo systemctl restart wazuh-manager
```

5. Confirm manager status:

```bash
sudo systemctl status wazuh-manager --no-pager
```

## Validation Steps

Use `wazuh-logtest` on `wazuh-siems-monitor`:

```bash
sudo /var/ossec/bin/wazuh-logtest
```

Paste this lifecycle event:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"lifecycle_campaign","severity":"high","classification":"share-link-only-visibility","status":"passed-with-warnings","campaign":"text","environment":"staging","runId":"20ed1890ed7c-f658c3a631"}
```

Expected result:

```text
decoder: inssa_qa
source: web-app-qa-tests
product: INSSA
eventType: lifecycle_campaign
severity: high
classification: share-link-only-visibility
status: passed-with-warnings
campaign: text
environment: staging
runId: 20ed1890ed7c-f658c3a631
```

Then validate a security event:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"high","classification":"public-by-id","status":"passed-with-findings","campaign":"security","environment":"staging","runId":"20ed1890ed7c-5fd91d5835"}
```

Expected result:

```text
decoder: inssa_qa
source: web-app-qa-tests
product: INSSA
eventType: security_campaign
severity: high
classification: public-by-id
status: passed-with-findings
campaign: security
environment: staging
runId: 20ed1890ed7c-5fd91d5835
```

If fields do not appear, confirm the event is sent as a single JSON object and not as a wrapper containing `events[]`.

## Restart Commands

Restart:

```bash
sudo systemctl restart wazuh-manager
```

Status:

```bash
sudo systemctl status wazuh-manager --no-pager
```

Logs:

```bash
sudo tail -n 100 /var/ossec/logs/ossec.log
```

## Rollback Guide

If Wazuh manager fails to restart or the decoder misparses unrelated events:

1. Restore the backup created before installation:

```bash
sudo cp /var/ossec/etc/decoders/local_decoder.xml.bak.<timestamp> /var/ossec/etc/decoders/local_decoder.xml
```

2. Restart Wazuh manager:

```bash
sudo systemctl restart wazuh-manager
```

3. Confirm status:

```bash
sudo systemctl status wazuh-manager --no-pager
```

4. Confirm no INSSA QA decoder errors remain:

```bash
sudo tail -n 100 /var/ossec/logs/ossec.log
```

## Notes For Rule Integration

The decoder only identifies and parses INSSA QA JSON events. Alerting rules should be installed separately in:

```text
/var/ossec/etc/rules/local_rules.xml
```

Recommended rule mapping:

| Classification | Severity |
| --- | --- |
| `unauthorized-visible` | Critical |
| `authentication-bypass` | Critical |
| `public-by-id` | High |
| `media-publicly-accessible` | High |
| `share-link-only-visibility` | Medium |
| `delayed-indexing` | Medium |
| `reveal-protected` | Informational |
| `expected-share-access` | Informational |

Full rule and dashboard guidance is documented in [Wazuh INSSA QA Integration](wazuh-inssa-integration.md).
