# Wazuh Navigation Map

Map date: 2026-06-08

Target:

```text
https://wazuh.kbeanprobo.com
```

Scope:

```text
Read-only navigation map from the authenticated Wazuh UI.
No Wazuh navigation, dashboards, saved objects, rules, decoders, or infrastructure were modified.
```

## Primary Navigation Tree

```text
Wazuh Home
  -> Home
     -> Overview
  -> Recently viewed
     -> INSSA Security Center
     -> INSSA Security Overview
     -> INSSA Campaign Operations
     -> INSSA Cleanup Queue
     -> INSSA Executive View
  -> Explore
     -> Discover
        -> INSSA saved searches
     -> Dashboards
        -> INSSA Security Center
        -> INSSA Security Overview
        -> INSSA Campaign Operations
        -> INSSA Cleanup Queue
        -> INSSA Executive View
     -> Visualize
        -> INSSA visualizations
     -> Reporting
     -> Alerting
     -> Anomaly Detection
     -> Maps
     -> Notifications
  -> Endpoint security
     -> Configuration Assessment
     -> Malware Detection
     -> File Integrity Monitoring
  -> Threat intelligence
     -> Threat Hunting
     -> Vulnerability Detection
     -> MITRE ATT&CK
  -> Security operations
     -> IT Hygiene
     -> PCI DSS
     -> GDPR
     -> HIPAA
     -> NIST 800-53
     -> TSC
  -> Cloud security
     -> Docker
     -> Amazon Web Services
     -> Google Cloud
     -> GitHub
     -> Office 365
     -> Microsoft Graph API
  -> Agents management
     -> Summary
     -> Groups
  -> Server management
     -> Rules
     -> Decoders
     -> CDB Lists
     -> Status
     -> Cluster
     -> Statistics
     -> Logs
     -> Settings
     -> Dev Tools
     -> Ruleset Test
     -> Security
  -> Indexer management
     -> Index Management
     -> Snapshot Management
     -> Security
     -> Sample Data
     -> Dev Tools
  -> Dashboard management
     -> Dashboards Management
     -> Reporting
     -> Server APIs
     -> App Settings
     -> About
```

## INSSA Navigation Map

```text
Wazuh Home
  -> Explore
     -> Dashboards
        -> INSSA Security Center
           -> Security Overview card
              -> INSSA Security Overview
                 -> INSSA Critical Findings
                 -> INSSA High Findings
                 -> INSSA Open Findings
                 -> INSSA Findings By Severity
                 -> INSSA Findings By Classification
                 -> INSSA Findings By Day
                 -> INSSA Findings By Campaign
                 -> INSSA Top Active Risks
           -> Campaign Operations card
              -> INSSA Campaign Operations
                 -> INSSA Security Campaign History
                 -> INSSA Cross User Campaign History
                 -> INSSA Reveal Later Campaign History
                 -> INSSA Release Gate History
                 -> INSSA Campaign Success Rate
                 -> INSSA Campaign History By Day
                 -> INSSA Campaign Summary Events
           -> Cleanup Queue card
              -> INSSA Cleanup Queue
                 -> INSSA Capsules Pending Cleanup
                 -> INSSA Cleanup Status
                 -> INSSA Cleanup Age
           -> Executive View card
              -> INSSA Executive View
                 -> INSSA Critical Findings
                 -> INSSA High Findings
                 -> INSSA Capsules Pending Cleanup
                 -> INSSA Campaign Success Rate
                 -> INSSA Findings By Severity
                 -> INSSA Findings By Day
                 -> INSSA Top Active Risks
           -> Recent Activity
              -> INSSA Security Center Recent Activity saved search
           -> Campaign Timeline
           -> Findings By Classification
           -> Findings By Severity
```

## Saved Search Map

```text
Wazuh Home
  -> Explore
     -> Discover
        -> INSSA Security Center Recent Activity
        -> INSSA Campaign Summaries
        -> INSSA Security Summaries
        -> INSSA Cross User Summaries
        -> INSSA Reveal Later Summaries
        -> INSSA Release Gate Summaries
        -> INSSA Critical Findings
        -> INSSA High Findings
        -> INSSA Open Findings
        -> INSSA Cleanup Queue
```

## Navigation Detail

| Path | Target | Purpose | Classification | Recommendation |
| --- | --- | --- | --- | --- |
| Home -> Overview | `/app/wz-home` | Wazuh home and health overview. | Core Wazuh | Keep |
| Recently viewed -> INSSA Security Center | `/app/dashboards#/view/inssa-security-center` | User-history shortcut to the INSSA landing page. | INSSA | Surface |
| Explore -> Discover | `/app/discover#/` | Inspect raw events and saved searches. | Core Wazuh | Keep |
| Explore -> Dashboards | `/app/dashboards#/list` | Open dashboards including INSSA Security Center. | Core Wazuh | Keep |
| Explore -> Visualize | `/app/visualize#/` | Edit visualizations. | Core Wazuh | Keep for dashboard maintainers |
| Explore -> Reporting | `/app/reports-dashboards` | Report and report definition management. | Core Wazuh | Keep |
| Explore -> Alerting | `/app/alerting` | Alerting and monitor management. | Infrastructure | Keep |
| Explore -> Anomaly Detection | `/app/anomaly-detection-dashboards` | Anomaly detection dashboards. | Unknown | Keep |
| Explore -> Maps | `/app/maps-dashboards` | Map visualizations. | Unknown | Keep |
| Explore -> Notifications | `/app/notifications-dashboards` | Notification destinations. | Infrastructure | Keep |
| Endpoint security -> Configuration Assessment | `/app/configuration-assessment` | Endpoint configuration posture. | Core Wazuh | Keep |
| Endpoint security -> Malware Detection | `/app/malware-detection` | Malware detection. | Core Wazuh | Keep |
| Endpoint security -> File Integrity Monitoring | `/app/file-integrity-monitoring` | File integrity monitoring. | Core Wazuh | Keep |
| Threat intelligence -> Threat Hunting | `/app/threat-hunting` | Threat hunting. | Core Wazuh | Keep |
| Threat intelligence -> Vulnerability Detection | `/app/vulnerability-detection` | Vulnerability detection. | Core Wazuh | Keep |
| Threat intelligence -> MITRE ATT&CK | `/app/mitre-attack` | MITRE technique/tactic mapping. | Core Wazuh | Keep |
| Security operations -> IT Hygiene | `/app/it-hygiene` | Security posture hygiene. | Core Wazuh | Keep |
| Security operations -> PCI DSS | `/app/pci-dss` | PCI DSS view. | Core Wazuh | Keep |
| Security operations -> GDPR | `/app/gdpr` | GDPR view. | Core Wazuh | Keep |
| Security operations -> HIPAA | `/app/hipaa` | HIPAA view. | Core Wazuh | Keep |
| Security operations -> NIST 800-53 | `/app/nist-800-53` | NIST 800-53 view. | Core Wazuh | Keep |
| Security operations -> TSC | `/app/tsc` | TSC view. | Core Wazuh | Keep |
| Cloud security -> Docker | `/app/docker` | Docker/container view. | Core Wazuh | Keep |
| Cloud security -> Amazon Web Services | `/app/amazon-web-services` | AWS view. | Core Wazuh | Keep |
| Cloud security -> Google Cloud | `/app/google-cloud` | Google Cloud view. | Core Wazuh | Keep |
| Cloud security -> GitHub | `/app/github` | GitHub integration view. | Core Wazuh | Keep |
| Cloud security -> Office 365 | `/app/office365` | Office 365 view. | Core Wazuh | Keep |
| Cloud security -> Microsoft Graph API | `/app/microsoft-graph-api` | Microsoft Graph API view. | Core Wazuh | Keep |
| Agents management -> Summary | `/app/endpoints-summary` | Agent summary. | Core Wazuh | Keep |
| Agents management -> Groups | `/app/endpoint-groups` | Agent groups. | Core Wazuh | Keep |
| Server management -> Rules | `/app/rules` | Wazuh rule management. | Infrastructure | Keep |
| Server management -> Decoders | `/app/decoders` | Wazuh decoder management. | Infrastructure | Keep |
| Server management -> CDB Lists | `/app/cdb-lists` | Wazuh CDB lists. | Infrastructure | Keep |
| Server management -> Status | `/app/server-status` | Wazuh server status. | Infrastructure | Keep |
| Server management -> Cluster | `/app/cluster` | Wazuh cluster view. | Infrastructure | Keep |
| Server management -> Statistics | `/app/statistics` | Wazuh statistics. | Infrastructure | Keep |
| Server management -> Logs | `/app/logs` | Wazuh logs. | Infrastructure | Keep |
| Server management -> Settings | `/app/dashboards-settings` | Wazuh dashboard settings. | Infrastructure | Keep |
| Server management -> Dev Tools | `/app/dev-tools` | Wazuh development tools. | Infrastructure | Keep |
| Server management -> Ruleset Test | `/app/ruleset-test` | Ruleset testing. | Infrastructure | Keep |
| Server management -> Security | `/app/security` | Wazuh security management. | Infrastructure | Keep |
| Indexer management -> Index Management | `/app/opensearch_index_management_dashboards#/?dataSourceId=Local` | OpenSearch index management. | Infrastructure | Keep |
| Indexer management -> Snapshot Management | `/app/opensearch_snapshot_management_dashboards#/?dataSourceId=Local` | OpenSearch snapshot management. | Infrastructure | Keep |
| Indexer management -> Security | `/app/security-dashboards-plugin` | OpenSearch security plugin. | Infrastructure | Keep |
| Indexer management -> Sample Data | `/app/sample-data` | Sample data installer. | Unknown | Hide |
| Indexer management -> Dev Tools | `/app/dev_tools` | OpenSearch Dev Tools. | Infrastructure | Keep |
| Dashboard management -> Dashboards Management | `/app/management` | Saved object and dashboard management. | Infrastructure | Keep |
| Dashboard management -> Reporting | `/app/reporting` | Reporting management shortcut. | Core Wazuh | Keep |
| Dashboard management -> Server APIs | `/app/server-apis` | Wazuh API configuration. | Infrastructure | Keep |
| Dashboard management -> App Settings | `/app/app-settings` | Wazuh app settings. | Infrastructure | Keep |
| Dashboard management -> About | `/app/about` | Wazuh application information. | Core Wazuh | Keep |

## Current Best INSSA Entry Point

Recommended entry point:

```text
INSSA Security Center
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

Best standard UI path:

```text
Wazuh Home
  -> Explore
  -> Dashboards
  -> INSSA Security Center
```

Fast path after first use:

```text
Wazuh Home
  -> Recently viewed
  -> INSSA Security Center
```

## Operator Paths

| Operator need | Recommended path |
| --- | --- |
| Daily INSSA review | INSSA Security Center |
| Critical/high finding triage | INSSA Security Center -> Security Overview |
| Campaign status review | INSSA Security Center -> Campaign Operations |
| Staging cleanup review | INSSA Security Center -> Cleanup Queue |
| Leadership review | INSSA Security Center -> Executive View |
| Raw event investigation | Explore -> Discover -> INSSA saved search |
| Wazuh rule/decoder troubleshooting | Server management -> Rules or Decoders |
| Ingestion/log troubleshooting | Server management -> Logs |
| Index health troubleshooting | Indexer management -> Index Management |

## Usability Gaps

| Gap | Impact | Recommendation |
| --- | --- | --- |
| INSSA is not a first-class left-navigation section. | New operators need the dashboard URL or Dashboards list path. | Surface the Security Center URL in onboarding docs and bookmarks. Consider default route later. |
| Recently viewed is user-history based. | New users may not see INSSA until they open it once. | Do not rely on Recently viewed as the primary discovery method. |
| Reporting page has no reports or report definitions. | Operators cannot use Wazuh reports for INSSA yet. | Keep Reporting available, but do not advertise it as an active INSSA report source until definitions are created. |
| Sample Data remains visible. | It can distract operators. | Hide from operator guidance; do not delete without platform approval. |
| Multiple Dev Tools links exist. | Operator confusion between Wazuh and OpenSearch diagnostic tools. | Restrict Dev Tools usage to platform owners. |

## Recommendation

Use `INSSA Security Center` as the primary operator landing page and keep the rest of Wazuh navigation unchanged.

Do not implement custom navigation in this phase. If stronger discoverability is needed, the safest future improvement is a role- or tenant-scoped default route to:

```text
/app/dashboards#/view/inssa-security-center
```

