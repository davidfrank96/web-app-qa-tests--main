# Wazuh UI Inventory

Inventory date: 2026-06-08

Target:

```text
https://wazuh.kbeanprobo.com
Wazuh app version observed: 4.14.4
OpenSearch Dashboards version previously observed: 2.19.4
```

Scope:

```text
Read-only inventory of the authenticated Wazuh UI.
No dashboards, visualizations, saved searches, reports, rules, decoders, ingestion services, or Wazuh settings were modified.
```

Evidence:

| Evidence | Path |
| --- | --- |
| Expanded Wazuh navigation screenshot | `reports/wazuh-ui-inventory/expanded-navigation.png` |

## Executive Summary

The current Wazuh UI contains a clean INSSA dashboard set plus normal Wazuh platform navigation.

Saved-object inventory:

| Object type | Count | Classification |
| --- | ---: | --- |
| Dashboards | 5 | INSSA |
| Visualizations | 31 | INSSA |
| Saved searches | 10 | INSSA |
| Index patterns | 3 | Core Wazuh |
| Reports | 0 | Not configured |
| Report definitions | 0 | Not configured |

No sample-data dashboards, demo dashboards, duplicate dashboards, or orphan dashboards were found in the saved-object inventory.

## Classification Model

| Classification | Meaning |
| --- | --- |
| Core Wazuh | Built-in Wazuh or OpenSearch Dashboard capability required for Wazuh operations. |
| INSSA | Created for INSSA QA/security observability. |
| Infrastructure | Useful for Wazuh platform, indexer, API, rules, decoders, logs, or agent operations. |
| Unused | Present but not referenced or not currently useful. |
| Unknown | Visible capability whose ownership or current operational use was not verified. |

## Dashboard Inventory

| Name | Purpose | URL | Owner | Category | Classification | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| INSSA Security Center | Primary landing page for INSSA observability. | `/app/dashboards#/view/inssa-security-center` | INSSA QA/Security | Dashboard collection | INSSA | Surface |
| INSSA Security Overview | Security triage dashboard for INSSA Wazuh findings. | `/app/dashboards#/view/inssa-security-overview` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Campaign Operations | Campaign history, status, and summary event dashboard. | `/app/dashboards#/view/inssa-campaign-operations` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Cleanup Queue | Manual staging cleanup tracking dashboard. | `/app/dashboards#/view/inssa-cleanup-queue` | INSSA QA/Security | Cleanup | INSSA | Keep |
| INSSA Executive View | Executive rollup for findings, campaign health, and cleanup debt. | `/app/dashboards#/view/inssa-executive-view` | INSSA QA/Security | Executive reporting | INSSA | Keep |

Dashboard findings:

| Finding | Result |
| --- | --- |
| Hidden dashboards | No unaccounted hidden dashboards found. INSSA dashboards are not first-class left-nav entries, but are reachable from the Security Center, Dashboards list, and Recently viewed. |
| Orphan dashboards | None found. |
| Duplicate dashboards | None found. |
| Useful built-in dashboards | Wazuh built-in dashboard applications exist through the left navigation, but no built-in saved dashboard objects were present in the saved-object inventory. |

## Visualization Inventory

All 31 visualizations are INSSA-owned and referenced by at least one dashboard.

| Name | Type | Purpose | URL | Owner | Category | Classification | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| INSSA Critical Findings | metric | Critical finding count using `rule.level >= 14`. | `/app/visualize#/edit/inssa-critical-findings-count` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA High Findings | metric | High and critical finding count using `rule.level >= 10`. | `/app/visualize#/edit/inssa-high-findings-count` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Open Findings | metric | Open warning/failure-bearing finding count. | `/app/visualize#/edit/inssa-open-findings-count` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Findings By Severity | pie | Finding distribution by `data.severity`. | `/app/visualize#/edit/inssa-findings-by-severity` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Findings By Classification | histogram | Finding distribution by `data.classification`. | `/app/visualize#/edit/inssa-findings-by-classification` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Findings By Day | histogram | Finding trend by day. | `/app/visualize#/edit/inssa-findings-by-day` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Findings By Campaign | histogram | Finding distribution by campaign. | `/app/visualize#/edit/inssa-findings-by-campaign` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Top Active Risks | table | Active risk table for failed or warning statuses. | `/app/visualize#/edit/inssa-top-active-risks` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Security Campaign History | histogram | Security campaign history. | `/app/visualize#/edit/inssa-security-campaign-history` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Cross User Campaign History | histogram | Cross-user campaign history. | `/app/visualize#/edit/inssa-cross-user-campaign-history` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Reveal Later Campaign History | histogram | Reveal-later campaign history. | `/app/visualize#/edit/inssa-reveal-later-campaign-history` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Release Gate History | histogram | Release-gate event history. | `/app/visualize#/edit/inssa-release-gate-history` | INSSA QA/Security | Release gate | INSSA | Keep |
| INSSA Campaign Success Rate | pie | Campaign status distribution. | `/app/visualize#/edit/inssa-campaign-success-rate` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Campaign History By Day | histogram | Campaign event trend by day. | `/app/visualize#/edit/inssa-campaign-duration-proxy` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Cleanup Age | table | Cleanup target age table. | `/app/visualize#/edit/inssa-cleanup-age` | INSSA QA/Security | Cleanup | INSSA | Keep |
| INSSA Capsules Pending Cleanup | metric | Cleanup queue count. | `/app/visualize#/edit/inssa-capsules-pending-cleanup` | INSSA QA/Security | Cleanup | INSSA | Keep |
| INSSA Campaign Summary Events | metric | Campaign summary event count. | `/app/visualize#/edit/inssa-campaign-summary-count` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Cleanup Status | histogram | Cleanup status distribution. | `/app/visualize#/edit/inssa-cleanup-status` | INSSA QA/Security | Cleanup | INSSA | Keep |
| INSSA SC Critical Findings | metric | Security Center critical KPI. | `/app/visualize#/edit/inssa-security-center-critical-findings` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC High Findings | metric | Security Center high KPI. | `/app/visualize#/edit/inssa-security-center-high-findings` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Open Findings | metric | Security Center open findings KPI. | `/app/visualize#/edit/inssa-security-center-open-findings` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Campaigns Run Last 30 Days | metric | Security Center campaign summary count. | `/app/visualize#/edit/inssa-security-center-campaigns-run` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Release Gate Status | table | Security Center release-gate status table. | `/app/visualize#/edit/inssa-security-center-release-gate-status` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Cleanup Queue Count | metric | Security Center cleanup KPI. | `/app/visualize#/edit/inssa-security-center-cleanup-count` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Card - Security Overview | markdown | Navigation card to Security Overview. | `/app/visualize#/edit/inssa-security-center-card-security-overview` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Card - Campaign Operations | markdown | Navigation card to Campaign Operations. | `/app/visualize#/edit/inssa-security-center-card-campaign-operations` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Card - Cleanup Queue | markdown | Navigation card to Cleanup Queue. | `/app/visualize#/edit/inssa-security-center-card-cleanup-queue` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Card - Executive View | markdown | Navigation card to Executive View. | `/app/visualize#/edit/inssa-security-center-card-executive-view` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Campaign Timeline | histogram | Campaign summary timeline. | `/app/visualize#/edit/inssa-security-center-campaign-timeline` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Findings By Classification | histogram | Security Center classification distribution. | `/app/visualize#/edit/inssa-security-center-findings-by-classification` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA SC Findings By Severity | pie | Security Center severity distribution. | `/app/visualize#/edit/inssa-security-center-findings-by-severity` | INSSA QA/Security | Security Center | INSSA | Keep |

Visualization findings:

| Finding | Result |
| --- | --- |
| Orphan visualizations | None found. |
| Duplicate visualizations | Security Center has its own KPI/card widgets with similar concepts to the deeper dashboards. This is intentional landing-page duplication, not cleanup debt. |
| Non-INSSA visualizations | None found in saved-object inventory. |

## Saved Search Inventory

| Name | Purpose | URL | Owner | Category | Classification | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| INSSA Security Center Recent Activity | Recent INSSA event table embedded in Security Center. | `/app/discover#/view/inssa-security-center-recent-activity` | INSSA QA/Security | Security Center | INSSA | Keep |
| INSSA Campaign Summaries | Discover entry point for all campaign summaries. | `/app/discover#/view/inssa-campaign-summaries` | INSSA QA/Security | Campaign operations | INSSA | Keep |
| INSSA Security Summaries | Security campaign summary view. | `/app/discover#/view/inssa-security-summaries` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Cross User Summaries | Cross-user campaign summary view. | `/app/discover#/view/inssa-cross-user-summaries` | INSSA QA/Security | Cross-user | INSSA | Keep |
| INSSA Reveal Later Summaries | Reveal-later campaign summary view. | `/app/discover#/view/inssa-reveal-later-summaries` | INSSA QA/Security | Reveal-later | INSSA | Keep |
| INSSA Release Gate Summaries | Release-gate campaign summary view. | `/app/discover#/view/inssa-release-gate-summaries` | INSSA QA/Security | Release gate | INSSA | Keep |
| INSSA Critical Findings | Critical-finding Discover view. | `/app/discover#/view/inssa-critical-findings` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA High Findings | High-risk finding Discover view. | `/app/discover#/view/inssa-high-findings` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Open Findings | Open finding work queue. | `/app/discover#/view/inssa-open-findings` | INSSA QA/Security | Security | INSSA | Keep |
| INSSA Cleanup Queue | Cleanup target Discover view. | `/app/discover#/view/inssa-cleanup-queue` | INSSA QA/Security | Cleanup | INSSA | Keep |

Saved-search findings:

| Finding | Result |
| --- | --- |
| Embedded searches | `INSSA Security Center Recent Activity` is embedded in the Security Center. |
| Standalone searches | The other nine searches are intentional Discover entry points. |
| Orphan searches | None requiring deletion. Standalone searches are retained intentionally. |

## Report Inventory

The Reporting page was inspected directly.

| Report surface | Count | Purpose | URL | Owner | Category | Classification | Recommendation |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| Reports | 0 | Generated reports from dashboards/searches/visualizations. | `/app/reports-dashboards#/` | Wazuh/OpenSearch | Reporting | Core Wazuh | Keep |
| Report definitions | 0 | Scheduled or reusable report definitions. | `/app/reports-dashboards#/` | Wazuh/OpenSearch | Reporting | Core Wazuh | Keep |

Reporting recommendation:

```text
Keep Reporting available. Do not create scheduled reports until a reporting owner, cadence, and recipient list are agreed.
```

## Index Pattern Inventory

| Name | Purpose | URL | Owner | Category | Classification | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| `wazuh-alerts-*` | Wazuh alerts and INSSA event dashboards. | `/app/management/opensearch-dashboards/indexPatterns/patterns/wazuh-alerts-*` | Wazuh/OpenSearch | Alerts index pattern | Core Wazuh | Keep |
| `wazuh-monitoring-*` | Wazuh monitoring data. | `/app/management/opensearch-dashboards/indexPatterns/patterns/wazuh-monitoring-*` | Wazuh/OpenSearch | Monitoring index pattern | Core Wazuh | Keep |
| `wazuh-statistics-*` | Wazuh statistics data. | `/app/management/opensearch-dashboards/indexPatterns/patterns/wazuh-statistics-*` | Wazuh/OpenSearch | Statistics index pattern | Core Wazuh | Keep |

## Navigation Entry Inventory

| Section | Entry | Purpose | URL | Owner | Category | Classification | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Recently viewed | INSSA Security Center | Recent dashboard shortcut. | `/app/dashboards#/view/inssa-security-center` | INSSA QA/Security | Dashboard shortcut | INSSA | Surface |
| Recently viewed | INSSA Security Overview | Recent dashboard shortcut. | `/app/dashboards#/view/inssa-security-overview` | INSSA QA/Security | Dashboard shortcut | INSSA | Keep |
| Recently viewed | INSSA Campaign Operations | Recent dashboard shortcut. | `/app/dashboards#/view/inssa-campaign-operations` | INSSA QA/Security | Dashboard shortcut | INSSA | Keep |
| Recently viewed | INSSA Cleanup Queue | Recent dashboard shortcut. | `/app/dashboards#/view/inssa-cleanup-queue` | INSSA QA/Security | Dashboard shortcut | INSSA | Keep |
| Recently viewed | INSSA Executive View | Recent dashboard shortcut. | `/app/dashboards#/view/inssa-executive-view` | INSSA QA/Security | Dashboard shortcut | INSSA | Keep |
| Home | Overview | Wazuh home and health/overview landing page. | `/app/wz-home` | Wazuh | Home | Core Wazuh | Keep |
| Explore | Discover | Raw event discovery and saved-search execution. | `/app/discover#/` | Wazuh/OpenSearch | Discover | Core Wazuh | Keep |
| Explore | Dashboards | Dashboard list and dashboard open flow. | `/app/dashboards#/list` | Wazuh/OpenSearch | Dashboards | Core Wazuh | Keep |
| Explore | Visualize | Visualization list/editor. | `/app/visualize#/` | Wazuh/OpenSearch | Visualizations | Core Wazuh | Keep |
| Explore | Reporting | Report and report definition management. | `/app/reports-dashboards` | Wazuh/OpenSearch | Reporting | Core Wazuh | Keep |
| Explore | Alerting | Alerting configuration and monitors. | `/app/alerting` | Wazuh/OpenSearch | Alerting | Infrastructure | Keep |
| Explore | Anomaly Detection | OpenSearch anomaly detection dashboards. | `/app/anomaly-detection-dashboards` | Wazuh/OpenSearch | Analytics | Unknown | Keep |
| Explore | Maps | Map visualizations. | `/app/maps-dashboards` | Wazuh/OpenSearch | Visualization | Unknown | Keep |
| Explore | Notifications | Notification management. | `/app/notifications-dashboards` | Wazuh/OpenSearch | Notifications | Infrastructure | Keep |
| Endpoint security | Configuration Assessment | Endpoint configuration posture. | `/app/configuration-assessment` | Wazuh | Endpoint security | Core Wazuh | Keep |
| Endpoint security | Malware Detection | Malware detection dashboard. | `/app/malware-detection` | Wazuh | Endpoint security | Core Wazuh | Keep |
| Endpoint security | File Integrity Monitoring | File integrity monitoring dashboard. | `/app/file-integrity-monitoring` | Wazuh | Endpoint security | Core Wazuh | Keep |
| Threat intelligence | Threat Hunting | Threat hunting view. | `/app/threat-hunting` | Wazuh | Threat hunting | Core Wazuh | Keep |
| Threat intelligence | Vulnerability Detection | Vulnerability detection view. | `/app/vulnerability-detection` | Wazuh | Vulnerability management | Core Wazuh | Keep |
| Threat intelligence | MITRE ATT&CK | MITRE ATT&CK mapping. | `/app/mitre-attack` | Wazuh | Threat intelligence | Core Wazuh | Keep |
| Security operations | IT Hygiene | IT hygiene view. | `/app/it-hygiene` | Wazuh | Security operations | Core Wazuh | Keep |
| Security operations | PCI DSS | PCI DSS compliance view. | `/app/pci-dss` | Wazuh | Compliance | Core Wazuh | Keep |
| Security operations | GDPR | GDPR compliance view. | `/app/gdpr` | Wazuh | Compliance | Core Wazuh | Keep |
| Security operations | HIPAA | HIPAA compliance view. | `/app/hipaa` | Wazuh | Compliance | Core Wazuh | Keep |
| Security operations | NIST 800-53 | NIST 800-53 compliance view. | `/app/nist-800-53` | Wazuh | Compliance | Core Wazuh | Keep |
| Security operations | TSC | TSC compliance view. | `/app/tsc` | Wazuh | Compliance | Core Wazuh | Keep |
| Cloud security | Docker | Docker security view. | `/app/docker` | Wazuh | Cloud/container security | Core Wazuh | Keep |
| Cloud security | Amazon Web Services | AWS security view. | `/app/amazon-web-services` | Wazuh | Cloud security | Core Wazuh | Keep |
| Cloud security | Google Cloud | Google Cloud security view. | `/app/google-cloud` | Wazuh | Cloud security | Core Wazuh | Keep |
| Cloud security | GitHub | GitHub security view. | `/app/github` | Wazuh | Cloud/integration security | Core Wazuh | Keep |
| Cloud security | Office 365 | Office 365 security view. | `/app/office365` | Wazuh | SaaS security | Core Wazuh | Keep |
| Cloud security | Microsoft Graph API | Microsoft Graph API security view. | `/app/microsoft-graph-api` | Wazuh | SaaS security | Core Wazuh | Keep |
| Agents management | Summary | Agent summary. | `/app/endpoints-summary` | Wazuh | Agent management | Core Wazuh | Keep |
| Agents management | Groups | Agent group management. | `/app/endpoint-groups` | Wazuh | Agent management | Core Wazuh | Keep |
| Server management | Rules | Wazuh rules management. | `/app/rules` | Wazuh | Server management | Infrastructure | Keep |
| Server management | Decoders | Wazuh decoder management. | `/app/decoders` | Wazuh | Server management | Infrastructure | Keep |
| Server management | CDB Lists | CDB list management. | `/app/cdb-lists` | Wazuh | Server management | Infrastructure | Keep |
| Server management | Status | Server status. | `/app/server-status` | Wazuh | Server health | Infrastructure | Keep |
| Server management | Cluster | Cluster status. | `/app/cluster` | Wazuh | Server health | Infrastructure | Keep |
| Server management | Statistics | Server statistics. | `/app/statistics` | Wazuh | Server health | Infrastructure | Keep |
| Server management | Logs | Wazuh logs. | `/app/logs` | Wazuh | Server diagnostics | Infrastructure | Keep |
| Server management | Settings | Wazuh app settings. | `/app/dashboards-settings` | Wazuh | Server management | Infrastructure | Keep |
| Server management | Dev Tools | Wazuh Dev Tools. | `/app/dev-tools` | Wazuh | Diagnostics | Infrastructure | Keep |
| Server management | Ruleset Test | Ruleset testing. | `/app/ruleset-test` | Wazuh | Rule validation | Infrastructure | Keep |
| Server management | Security | Wazuh app security. | `/app/security` | Wazuh | Security management | Infrastructure | Keep |
| Indexer management | Index Management | OpenSearch index management. | `/app/opensearch_index_management_dashboards#/?dataSourceId=Local` | OpenSearch | Indexer management | Infrastructure | Keep |
| Indexer management | Snapshot Management | OpenSearch snapshot management. | `/app/opensearch_snapshot_management_dashboards#/?dataSourceId=Local` | OpenSearch | Indexer management | Infrastructure | Keep |
| Indexer management | Security | OpenSearch security plugin. | `/app/security-dashboards-plugin` | OpenSearch | Indexer security | Infrastructure | Keep |
| Indexer management | Sample Data | OpenSearch sample data installer. | `/app/sample-data` | OpenSearch | Sample data | Unknown | Hide |
| Indexer management | Dev Tools | OpenSearch Dev Tools. | `/app/dev_tools` | OpenSearch | Diagnostics | Infrastructure | Keep |
| Dashboard management | Dashboards Management | OpenSearch Dashboards management. | `/app/management` | OpenSearch | Dashboard management | Infrastructure | Keep |
| Dashboard management | Reporting | Reporting entry point. | `/app/reporting` | OpenSearch | Reporting | Core Wazuh | Keep |
| Dashboard management | Server APIs | Wazuh server API configuration. | `/app/server-apis` | Wazuh | API management | Infrastructure | Keep |
| Dashboard management | App Settings | Wazuh app settings. | `/app/app-settings` | Wazuh | App settings | Infrastructure | Keep |
| Dashboard management | About | Wazuh app/about information. | `/app/about` | Wazuh | About | Core Wazuh | Keep |

## Section-Specific Findings

### Threat Hunting Views

| View | URL | Classification | Recommendation |
| --- | --- | --- | --- |
| Threat Hunting | `/app/threat-hunting` | Core Wazuh | Keep |
| Vulnerability Detection | `/app/vulnerability-detection` | Core Wazuh | Keep |
| MITRE ATT&CK | `/app/mitre-attack` | Core Wazuh | Keep |

### Discover Views

| View | URL | Classification | Recommendation |
| --- | --- | --- | --- |
| Discover | `/app/discover#/` | Core Wazuh | Keep |
| INSSA saved searches | `/app/discover#/view/<saved-search-id>` | INSSA | Keep |

### Security Operations Views

| View | URL | Classification | Recommendation |
| --- | --- | --- | --- |
| IT Hygiene | `/app/it-hygiene` | Core Wazuh | Keep |
| PCI DSS | `/app/pci-dss` | Core Wazuh | Keep |
| GDPR | `/app/gdpr` | Core Wazuh | Keep |
| HIPAA | `/app/hipaa` | Core Wazuh | Keep |
| NIST 800-53 | `/app/nist-800-53` | Core Wazuh | Keep |
| TSC | `/app/tsc` | Core Wazuh | Keep |

### Threat Intelligence Views

| View | URL | Classification | Recommendation |
| --- | --- | --- | --- |
| Threat Hunting | `/app/threat-hunting` | Core Wazuh | Keep |
| Vulnerability Detection | `/app/vulnerability-detection` | Core Wazuh | Keep |
| MITRE ATT&CK | `/app/mitre-attack` | Core Wazuh | Keep |

### Cloud Security Views

| View | URL | Classification | Recommendation |
| --- | --- | --- | --- |
| Docker | `/app/docker` | Core Wazuh | Keep |
| Amazon Web Services | `/app/amazon-web-services` | Core Wazuh | Keep |
| Google Cloud | `/app/google-cloud` | Core Wazuh | Keep |
| GitHub | `/app/github` | Core Wazuh | Keep |
| Office 365 | `/app/office365` | Core Wazuh | Keep |
| Microsoft Graph API | `/app/microsoft-graph-api` | Core Wazuh | Keep |

### Endpoint Security Views

| View | URL | Classification | Recommendation |
| --- | --- | --- | --- |
| Configuration Assessment | `/app/configuration-assessment` | Core Wazuh | Keep |
| Malware Detection | `/app/malware-detection` | Core Wazuh | Keep |
| File Integrity Monitoring | `/app/file-integrity-monitoring` | Core Wazuh | Keep |

## Useful Built-In Dashboards and Pages

| Built-in area | Why useful for INSSA operations | Recommendation |
| --- | --- | --- |
| Discover | Inspect raw INSSA events and saved searches. | Keep and document as advanced triage path. |
| Dashboards | Open the INSSA Security Center and target dashboards. | Keep. |
| Visualize | Maintain INSSA widgets. | Keep for dashboard owners only. |
| Reporting | Future export/scheduled-report capability. | Keep, but do not surface as primary INSSA workflow until report definitions exist. |
| Alerting | Future alert monitor management. | Keep for platform/security owners. |
| Rules | Validate INSSA Wazuh rule mappings. | Keep for platform/security owners. |
| Decoders | Validate INSSA decoder behavior. | Keep for platform/security owners. |
| Logs | Troubleshoot Wazuh ingestion and processing. | Keep for platform owners. |
| Index Management | Validate index health and retention. | Keep for platform owners. |

## Safe Hide / Surface / Retire Recommendations

| Area | Recommendation | Reason |
| --- | --- | --- |
| INSSA Security Center | Surface | Best first-click INSSA entry point. |
| INSSA Security Overview | Keep | Primary security triage view. |
| INSSA Campaign Operations | Keep | Campaign operations view. |
| INSSA Cleanup Queue | Keep | Cleanup work queue. |
| INSSA Executive View | Keep | Leadership rollup. |
| Recently viewed INSSA dashboards | Keep | Useful user-history shortcut, but not sufficient as managed navigation. |
| OpenSearch Sample Data | Hide | Not used by INSSA and can distract operators. Do not delete without platform approval. |
| Reporting | Keep | Empty today, but useful once report definitions are intentionally created. |
| Anomaly Detection and Maps | Keep | Built-in capabilities; current INSSA usage unverified. Do not remove. |
| Core Wazuh security/compliance pages | Keep | Built-in operational capability. |

## Best Location for INSSA Visibility

Recommended current location:

```text
Explore -> Dashboards -> INSSA Security Center
```

Recommended operator shortcut:

```text
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

Rationale:

- Uses standard Wazuh/OpenSearch dashboard features.
- Avoids custom navigation or plugin changes.
- Keeps INSSA separate through dashboard naming and `data.product:INSSA` filters.
- Gives operators one landing page with navigation cards to every INSSA view.

Future improvement, if approved:

```text
Set Wazuh default route to /app/dashboards#/view/inssa-security-center for INSSA operator users or an INSSA tenant.
```

Do not implement a custom left-navigation plugin unless Wazuh plugin ownership and upgrade maintenance are accepted.

## Final Recommendation

Verdict:

```text
PASS WITH USABILITY WARNINGS
```

The Wazuh UI inventory is clean and INSSA content is well isolated. The main usability gap is discoverability: INSSA is available through Dashboard Management/Dashboards and Recently viewed, but it is not a first-class left-navigation section.

