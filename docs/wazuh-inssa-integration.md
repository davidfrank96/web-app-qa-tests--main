# Wazuh INSSA QA Integration

This guide defines how to ingest INSSA QA and security campaign metadata into Wazuh dashboards and alerts.

The QA harness exports metadata-only SIEM events from:

```text
reports/siem/latest-siem-export.json
```

The export intentionally excludes screenshots, videos, traces, and raw browser evidence. It includes only campaign metadata, findings, classifications, statuses, artifact references, and report references.

## Event Source

Required event identity:

| Field | Value |
| --- | --- |
| `source` | `web-app-qa-tests` |
| `product` | `INSSA` |
| `schemaVersion` | `inssa-qa-siem.v1` |

Supported event types:

- `release_gate`
- `lifecycle_campaign`
- `security_campaign`
- `discovery_campaign`
- `cleanup_audit`

Generate local export:

```bash
npm run siem:export
```

Send to Wazuh-compatible endpoint:

```bash
SIEM_WAZUH_URL=https://wazuh.example.local/events \
SIEM_WAZUH_TOKEN=<redacted> \
npm run siem:send
```

Dry run:

```bash
npm run siem:send -- --dry-run
```

## Wazuh Decoder

The export is JSON. Wazuh should ingest either individual event objects or the batch payload. The sender supports both event mode and batch mode through `SIEM_SEND_BATCH=1`.

Recommended custom decoder file:

```text
/var/ossec/etc/decoders/local_decoder.xml
```

Decoder specification:

```xml
<decoder name="inssa-qa-json">
  <prematch>"source":"web-app-qa-tests"</prematch>
  <plugin_decoder>JSON_Decoder</plugin_decoder>
</decoder>

<decoder name="inssa-qa-campaign">
  <parent>inssa-qa-json</parent>
  <field name="source">web-app-qa-tests</field>
  <field name="product">INSSA</field>
</decoder>
```

If Wazuh receives the whole batch payload rather than individual events, configure the collector or integration layer to split `events[]` into individual log events before rule evaluation. Rule matching is designed for individual event objects.

Minimum event fields expected by dashboards and rules:

| Field | Purpose |
| --- | --- |
| `timestamp` | Campaign event time. |
| `eventType` | Release, lifecycle, security, discovery, or cleanup category. |
| `campaign` | Campaign or phase name. |
| `environment` | `staging` or `repository`. |
| `severity` | Normalized severity: `critical`, `high`, `medium`, `low`, `informational`. |
| `classification` | Lifecycle/security classification. |
| `status` | `passed`, `failed`, `passed-with-warnings`, `passed-with-findings`, or `classified`. |
| `artifactReference.path` | Local artifact reference, if present. |
| `reportReference.path` | Local report reference, if present. |
| `dashboardFields.*` | Flattened fields for dashboard indexing. |

## Rule Specification

Recommended custom rule file:

```text
/var/ossec/etc/rules/local_rules.xml
```

Base rule:

```xml
<group name="inssa,qa,">
  <rule id="120000" level="3">
    <decoded_as>json</decoded_as>
    <field name="source">web-app-qa-tests</field>
    <field name="product">INSSA</field>
    <description>INSSA QA campaign event</description>
    <group>inssa,qa,</group>
  </rule>
</group>
```

Critical rules:

```xml
<group name="inssa,qa,critical,">
  <rule id="120010" level="14">
    <if_sid>120000</if_sid>
    <field name="classification">unauthorized-visible</field>
    <description>INSSA critical access-control finding: unauthorized-visible</description>
    <group>inssa,qa,critical,access_control,</group>
  </rule>

  <rule id="120011" level="14">
    <if_sid>120000</if_sid>
    <field name="classification">authentication-bypass</field>
    <description>INSSA critical authentication finding: authentication-bypass</description>
    <group>inssa,qa,critical,authentication,</group>
  </rule>
</group>
```

High rules:

```xml
<group name="inssa,qa,high,">
  <rule id="120020" level="10">
    <if_sid>120000</if_sid>
    <field name="classification">public-by-id</field>
    <description>INSSA high-risk access finding: public-by-id capsule access</description>
    <group>inssa,qa,high,access_control,</group>
  </rule>

  <rule id="120021" level="10">
    <if_sid>120000</if_sid>
    <field name="classification">media-publicly-accessible</field>
    <description>INSSA high-risk media finding: media publicly accessible</description>
    <group>inssa,qa,high,media_access,</group>
  </rule>
</group>
```

Medium rules:

```xml
<group name="inssa,qa,medium,">
  <rule id="120030" level="7">
    <if_sid>120000</if_sid>
    <field name="classification">share-link-only-visibility</field>
    <description>INSSA medium lifecycle visibility finding: share-link-only visibility</description>
    <group>inssa,qa,medium,visibility,</group>
  </rule>

  <rule id="120031" level="7">
    <if_sid>120000</if_sid>
    <field name="classification">delayed-indexing</field>
    <description>INSSA medium lifecycle visibility finding: delayed indexing</description>
    <group>inssa,qa,medium,indexing,</group>
  </rule>
</group>
```

Informational rules:

```xml
<group name="inssa,qa,informational,">
  <rule id="120040" level="3">
    <if_sid>120000</if_sid>
    <field name="classification">reveal-protected</field>
    <description>INSSA informational finding: reveal-later content protected before reveal</description>
    <group>inssa,qa,informational,reveal_later,</group>
  </rule>

  <rule id="120041" level="3">
    <if_sid>120000</if_sid>
    <field name="classification">expected-share-access</field>
    <description>INSSA informational finding: expected targeted share access</description>
    <group>inssa,qa,informational,cross_user,</group>
  </rule>
</group>
```

Fallback severity rules:

```xml
<group name="inssa,qa,severity,">
  <rule id="120050" level="14">
    <if_sid>120000</if_sid>
    <field name="severity">critical</field>
    <description>INSSA QA critical event</description>
    <group>inssa,qa,critical,</group>
  </rule>

  <rule id="120051" level="10">
    <if_sid>120000</if_sid>
    <field name="severity">high</field>
    <description>INSSA QA high-severity event</description>
    <group>inssa,qa,high,</group>
  </rule>

  <rule id="120052" level="7">
    <if_sid>120000</if_sid>
    <field name="severity">medium</field>
    <description>INSSA QA medium-severity event</description>
    <group>inssa,qa,medium,</group>
  </rule>
</group>
```

## Alert Mappings

| Classification | Severity | Wazuh Level | Route |
| --- | --- | --- | --- |
| `unauthorized-visible` | Critical | 14 | Immediate alert |
| `authentication-bypass` | Critical | 14 | Immediate alert |
| `public-by-id` | High | 10 | Ticket |
| `media-publicly-accessible` | High | 10 | Ticket |
| `share-link-only-visibility` | Medium | 7 | Dashboard only |
| `delayed-indexing` | Medium | 7 | Dashboard only |
| `reveal-protected` | Informational | 3 | Retention only |
| `expected-share-access` | Informational | 3 | Retention only |

Routing policy:

| Severity | Action | SLA |
| --- | --- | --- |
| Critical | Immediate alert to security/on-call channel. | Same day triage. |
| High | Create security/product ticket. | Next business day triage. |
| Medium | Dashboard visibility only. | Review during QA/security sync. |
| Informational | Retain for trend/history. | No action unless trend changes. |

## Dashboard Specification

Create one Wazuh dashboard named:

```text
INSSA QA Campaigns
```

Recommended global filters:

```text
source: web-app-qa-tests
product: INSSA
schemaVersion: inssa-qa-siem.v1
```

### Security Findings

Purpose: prioritize confirmed and suspected security findings.

Panels:

- Count by `severity`.
- Count by `classification`.
- Count by `status`.
- Finding table with `timestamp`, `campaign`, `classification`, `severity`, `status`, `reportReference.path`.
- High-risk detail table filtered to `classification:(public-by-id OR media-publicly-accessible OR unauthorized-visible OR authentication-bypass)`.

### Lifecycle Campaigns

Purpose: track lifecycle campaign health and visibility semantics.

Panels:

- Count by `campaign`.
- Count by `lifecycle.lifecycleNetworkClassification`.
- Count by `lifecycle.tokenlessAccessClassification`.
- Timeline of `status` over time.
- Table with `runId`, `campaign`, `classification`, `status`, `artifactReference.path`, `reportReference.path`.

### Release Gates

Purpose: monitor push readiness and release safety.

Panels:

- Latest `eventType:release_gate`.
- Count by `status`.
- Table with `classification`, `severity`, `status`, `reportReference.path`.
- Alert when `status:failed` or `severity:critical`.

### Cleanup Targets

Purpose: preserve visibility into QA-created staging data requiring manual cleanup.

Panels:

- Events with `eventType:cleanup_audit`.
- Lifecycle/security events with findings containing cleanup instructions.
- Table with `runId`, `campaign`, `artifactReference.path`, `reportReference.path`, `status`.
- Optional manual field in ticketing system for cleanup owner/status.

Recommended indexed fields:

| Field | Type |
| --- | --- |
| `timestamp` | date |
| `eventType` | keyword |
| `campaign` | keyword |
| `environment` | keyword |
| `severity` | keyword |
| `classification` | keyword |
| `status` | keyword |
| `runId` | keyword |
| `artifactReference.path` | keyword |
| `reportReference.path` | keyword |
| `dashboardFields.*` | keyword |

## Retention Policy

Recommended retention:

| Data | Retention | Reason |
| --- | --- | --- |
| Wazuh metadata events | 180 days | Trend and release audit history. |
| Critical/high alerts | 1 year | Security review and remediation tracking. |
| Medium/informational events | 90 to 180 days | Operational trend analysis. |
| Local raw artifacts | Team-defined; do not commit | May contain staging evidence and URLs. |
| Screenshots/videos/traces | Local only unless sanitized | Not sent to Wazuh by design. |

Do not send raw screenshot/video/trace files to Wazuh. Use report/artifact references only.

## Deployment Guide

1. Generate and inspect local SIEM export:

```bash
npm run siem:export
```

2. Confirm payload is metadata-only:

```bash
npm run siem:send -- --dry-run
```

3. Install decoder XML into Wazuh manager:

```text
/var/ossec/etc/decoders/local_decoder.xml
```

4. Install rule XML into Wazuh manager:

```text
/var/ossec/etc/rules/local_rules.xml
```

5. Restart Wazuh manager:

```bash
sudo systemctl restart wazuh-manager
```

6. Send one dry-run-reviewed export to the configured endpoint:

```bash
SIEM_WAZUH_URL=https://wazuh.example.local/events \
SIEM_WAZUH_TOKEN=<redacted> \
npm run siem:send
```

7. Validate ingestion:

- Confirm `source=web-app-qa-tests`.
- Confirm `product=INSSA`.
- Confirm `classification` and `severity` are indexed.
- Confirm critical/high rules fire on matching synthetic or historical events.

8. Build the `INSSA QA Campaigns` dashboard using the dashboard sections above.

9. Configure alert routing:

- Critical: immediate alert.
- High: ticket.
- Medium: dashboard only.
- Informational: retention only.

## Validation Checklist

- `npm run siem:export` succeeds.
- `reports/siem/latest-siem-export.json` exists.
- Export contains `source=web-app-qa-tests`.
- Export contains `product=INSSA`.
- Export contains no screenshot/video/trace uploads.
- Wazuh decoder parses JSON fields.
- Wazuh rules match expected classifications.
- Dashboard shows security findings, lifecycle campaigns, release gates, and cleanup targets.
- Alert routing matches severity policy.
