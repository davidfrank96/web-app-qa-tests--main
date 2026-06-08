# Wazuh INSSA QA Rule Deployment

Target server:

```text
wazuh-siems-monitor
```

Target rule file:

```text
/var/ossec/etc/rules/local_rules.xml
```

Current decoder status: working.

Verified decoded fields:

```text
source
product
eventType
severity
classification
status
```

This document is documentation-only. Do not deploy these rules from the QA repo.

## Severity Mapping

| Classification | Rule Level | Severity | Operational Route |
| --- | --- | --- | --- |
| `unauthorized-visible` | 14 | Critical | Immediate alert |
| `authentication-bypass` | 14 | Critical | Immediate alert |
| `public-by-id` | 10 | High | Ticket |
| `media-publicly-accessible` | 10 | High | Ticket |
| `share-link-only-visibility` | 7 | Medium | Dashboard |
| `token-optional` | 7 | Medium | Dashboard |
| `reveal-protected` | 3 | Informational | Retention |
| `expected-share-access` | 3 | Informational | Retention |

## Ready-To-Paste Rule XML

Append this block to:

```text
/var/ossec/etc/rules/local_rules.xml
```

```xml
<!-- INSSA QA campaign rules. Decoder: inssa_qa. -->
<group name="inssa_qa,">
  <rule id="121000" level="3">
    <decoded_as>json</decoded_as>
    <field name="source">web-app-qa-tests</field>
    <field name="product">INSSA</field>
    <description>INSSA QA campaign event</description>
    <group>inssa_qa,</group>
  </rule>

  <!-- Critical: immediate alert. -->
  <rule id="121010" level="14">
    <if_sid>121000</if_sid>
    <field name="classification">unauthorized-visible</field>
    <description>INSSA QA critical access-control finding: unauthorized-visible</description>
    <group>inssa_qa,critical,access_control,</group>
  </rule>

  <rule id="121011" level="14">
    <if_sid>121000</if_sid>
    <field name="classification">authentication-bypass</field>
    <description>INSSA QA critical authentication finding: authentication-bypass</description>
    <group>inssa_qa,critical,authentication,</group>
  </rule>

  <!-- High: create security/product ticket. -->
  <rule id="121020" level="10">
    <if_sid>121000</if_sid>
    <field name="classification">public-by-id</field>
    <description>INSSA QA high-risk access finding: public-by-id capsule access</description>
    <group>inssa_qa,high,access_control,</group>
  </rule>

  <rule id="121021" level="10">
    <if_sid>121000</if_sid>
    <field name="classification">media-publicly-accessible</field>
    <description>INSSA QA high-risk media finding: media publicly accessible</description>
    <group>inssa_qa,high,media_access,</group>
  </rule>

  <!-- Medium: dashboard-only operational finding. -->
  <rule id="121030" level="7">
    <if_sid>121000</if_sid>
    <field name="classification">share-link-only-visibility</field>
    <description>INSSA QA medium lifecycle visibility finding: share-link-only visibility</description>
    <group>inssa_qa,medium,visibility,</group>
  </rule>

  <rule id="121031" level="7">
    <if_sid>121000</if_sid>
    <field name="classification">token-optional</field>
    <description>INSSA QA medium token behavior finding: token optional</description>
    <group>inssa_qa,medium,token_behavior,</group>
  </rule>

  <!-- Informational: retention-only event. -->
  <rule id="121040" level="3">
    <if_sid>121000</if_sid>
    <field name="classification">reveal-protected</field>
    <description>INSSA QA informational reveal-later finding: content protected before reveal</description>
    <group>inssa_qa,informational,reveal_later,</group>
  </rule>

  <rule id="121041" level="3">
    <if_sid>121000</if_sid>
    <field name="classification">expected-share-access</field>
    <description>INSSA QA informational cross-user finding: expected targeted share access</description>
    <group>inssa_qa,informational,cross_user,</group>
  </rule>
</group>
```

## Matching Notes

Some campaign summaries can include a comma-separated `classification` value such as:

```text
token-required,share-link-only,delayed-indexing,token-optional,public-by-id,media-publicly-accessible
```

The XML rules above use simple field matching. If your Wazuh deployment treats `<field name="classification">public-by-id</field>` as exact-match only and does not match comma-separated values, use regex field matching supported by your Wazuh version, or update the QA exporter to emit one normalized event per classification. Validate this behavior with `wazuh-logtest` before enabling alert routes.

## Installation Guide

On `wazuh-siems-monitor`:

1. Back up current rules:

```bash
sudo cp /var/ossec/etc/rules/local_rules.xml /var/ossec/etc/rules/local_rules.xml.bak.$(date +%Y%m%d%H%M%S)
```

2. Append the rule XML from this document to:

```text
/var/ossec/etc/rules/local_rules.xml
```

3. Validate XML syntax if available:

```bash
sudo xmllint --noout /var/ossec/etc/rules/local_rules.xml
```

4. Restart Wazuh manager:

```bash
sudo systemctl restart wazuh-manager
```

5. Confirm status:

```bash
sudo systemctl status wazuh-manager --no-pager
```

## Restart Guide

Restart:

```bash
sudo systemctl restart wazuh-manager
```

Check status:

```bash
sudo systemctl status wazuh-manager --no-pager
```

Check logs:

```bash
sudo tail -n 100 /var/ossec/logs/ossec.log
```

## Validation Examples

Run:

```bash
sudo /var/ossec/bin/wazuh-logtest
```

### Critical: unauthorized-visible

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"critical","classification":"unauthorized-visible","status":"failed","campaign":"security-verification","environment":"staging","runId":"example-critical"}
```

Expected:

```text
rule.id=121010
rule.level=14
group contains inssa_qa,critical,access_control
```

### Critical: authentication-bypass

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"critical","classification":"authentication-bypass","status":"failed","campaign":"authentication","environment":"staging","runId":"example-auth"}
```

Expected:

```text
rule.id=121011
rule.level=14
group contains inssa_qa,critical,authentication
```

### High: public-by-id

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"high","classification":"public-by-id","status":"passed-with-findings","campaign":"security","environment":"staging","runId":"20ed1890ed7c-5fd91d5835"}
```

Expected:

```text
rule.id=121020
rule.level=10
group contains inssa_qa,high,access_control
```

### High: media-publicly-accessible

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"high","classification":"media-publicly-accessible","status":"passed-with-findings","campaign":"security","environment":"staging","runId":"20ed1890ed7c-5fd91d5835"}
```

Expected:

```text
rule.id=121021
rule.level=10
group contains inssa_qa,high,media_access
```

### Medium: share-link-only-visibility

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"lifecycle_campaign","severity":"high","classification":"share-link-only-visibility","status":"passed-with-warnings","campaign":"text","environment":"staging","runId":"20ed1890ed7c-f658c3a631"}
```

Expected:

```text
rule.id=121030
rule.level=7
group contains inssa_qa,medium,visibility
```

### Medium: token-optional

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"medium","classification":"token-optional","status":"passed-with-findings","campaign":"security","environment":"staging","runId":"20ed1890ed7c-5fd91d5835"}
```

Expected:

```text
rule.id=121031
rule.level=7
group contains inssa_qa,medium,token_behavior
```

### Informational: reveal-protected

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"informational","classification":"reveal-protected","status":"passed","campaign":"reveal-later-security","environment":"staging","runId":"b952b1d4fe53-c271b67d56"}
```

Expected:

```text
rule.id=121040
rule.level=3
group contains inssa_qa,informational,reveal_later
```

### Informational: expected-share-access

Paste:

```json
{"source":"web-app-qa-tests","product":"INSSA","eventType":"security_campaign","severity":"informational","classification":"expected-share-access","status":"passed","campaign":"cross-user","environment":"staging","runId":"0d877454785d-c98ca92b0e"}
```

Expected:

```text
rule.id=121041
rule.level=3
group contains inssa_qa,informational,cross_user
```

## Dashboard Mapping Guide

Recommended dashboard filters:

```text
source:web-app-qa-tests
product:INSSA
group:inssa_qa
```

Dashboard panels:

| Panel | Query |
| --- | --- |
| Critical INSSA QA findings | `group:inssa_qa AND rule.level:14` |
| High INSSA QA findings | `group:inssa_qa AND rule.level:10` |
| Medium lifecycle visibility | `group:inssa_qa AND rule.level:7` |
| Informational expected behavior | `group:inssa_qa AND rule.level:3` |
| Public-by-ID trend | `classification:public-by-id` |
| Media public accessibility trend | `classification:media-publicly-accessible` |
| Cross-user expected share access | `classification:expected-share-access` |
| Reveal-later protection | `classification:reveal-protected` |

Recommended columns:

```text
timestamp
eventType
campaign
environment
classification
severity
status
runId
rule.id
rule.level
rule.description
```

## Rollback Steps

If rules fail validation or generate unexpected alerts:

1. Restore the backup:

```bash
sudo cp /var/ossec/etc/rules/local_rules.xml.bak.<timestamp> /var/ossec/etc/rules/local_rules.xml
```

2. Restart Wazuh manager:

```bash
sudo systemctl restart wazuh-manager
```

3. Confirm status:

```bash
sudo systemctl status wazuh-manager --no-pager
```

4. Check logs:

```bash
sudo tail -n 100 /var/ossec/logs/ossec.log
```

5. Re-run `wazuh-logtest` with the validation examples before redeploying.
