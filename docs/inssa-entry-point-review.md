# INSSA Entry Point Review

Review date: 2026-06-08

Target:

```text
https://wazuh.kbeanprobo.com
```

Scope:

```text
Optimize INSSA discoverability inside the existing Wazuh UI.
Do not patch Wazuh source code.
Do not modify Wazuh plugins.
Do not create unsupported navigation hacks.
```

## Executive Summary

The best supported INSSA entry-point solution is to make `INSSA Security Center` the Wazuh/OpenSearch Dashboards default route.

Target route:

```text
/app/dashboards#/view/inssa-security-center
```

This would make INSSA reachable immediately after opening Wazuh, without depending on:

- Direct URLs.
- Recently Viewed.
- Dashboard history.
- Custom source/plugin patches.

Implementation status:

```text
BLOCKED BY SERVER-SIDE DEFAULT ROUTE OVERRIDE
```

The authenticated Wazuh settings API rejected the change because `defaultRoute` is currently overridden server-side:

```text
Unable to update "defaultRoute" because it is overridden
```

Current effective default route:

```text
/app/wz-home
```

No Wazuh saved objects, dashboards, plugins, rules, decoders, ingestion services, or source files were modified.

## Source Findings Reviewed

Reviewed:

- [wazuh-ui-inventory.md](wazuh-ui-inventory.md)
- [wazuh-navigation-map.md](wazuh-navigation-map.md)

Relevant findings:

| Finding | Impact |
| --- | --- |
| `INSSA Security Center` exists and is the correct dashboard collection landing page. | The target landing page already exists. |
| INSSA dashboards are available from Dashboards and Recently Viewed. | Current access works but is not guaranteed for new users. |
| INSSA is not a first-class left-navigation item. | New users need guidance or a default route. |
| Custom Wazuh navigation is not a supported low-risk change. | Avoid plugin/source modifications. |
| Current best UI path is `Explore -> Dashboards -> INSSA Security Center`. | More than one click for new users. |

## Options Reviewed

| Option | Result | Risk | Recommendation |
| --- | --- | --- | --- |
| Dashboard landing page | Already implemented as `INSSA Security Center`. | Low | Keep. |
| Dashboard collection | Already implemented with cards to Security Overview, Campaign Operations, Cleanup Queue, and Executive View. | Low | Keep. |
| Default route | Best supported way to avoid direct URLs and Recently Viewed. Currently blocked by server-side override. | Medium because it affects all users in the current tenant/global context. | Implement through server config with owner approval. |
| Tenant landing page | Good future option if INSSA operators get a dedicated Wazuh/OpenSearch tenant. | Medium because it requires tenant/role planning. | Defer. |
| Dashboard Management shortcuts | Existing path requires multiple clicks. | Low | Use only as fallback. |
| Saved search shortcuts | Useful for investigation, not an operational landing page. | Low | Do not use as primary entry point. |
| Custom navigation item | Would require Wazuh plugin/source customization. | High | Do not implement. |

## Attempted Implementation

The supported OpenSearch Dashboards settings API was tested from the authenticated Wazuh session.

Requested change:

```json
{
  "defaultRoute": "/app/dashboards#/view/inssa-security-center"
}
```

API result:

```text
HTTP 400
Unable to update "defaultRoute" because it is overridden
```

Post-check confirmed the setting remains:

```json
{
  "defaultRoute": {
    "isOverridden": true,
    "userValue": "/app/wz-home"
  }
}
```

Interpretation:

```text
The default route is controlled by Wazuh/OpenSearch Dashboard server configuration, not by editable user settings.
```

## Required Supported Implementation

Apply the default route through Wazuh/OpenSearch Dashboards server configuration.

Recommended setting:

```yaml
uiSettings.overrides.defaultRoute: "/app/dashboards#/view/inssa-security-center"
```

Expected configuration location depends on the deployment, commonly one of:

```text
/etc/wazuh-dashboard/opensearch_dashboards.yml
/usr/share/wazuh-dashboard/config/opensearch_dashboards.yml
```

Deployment steps:

```bash
sudo grep -R "defaultRoute" /etc/wazuh-dashboard /usr/share/wazuh-dashboard/config
sudo cp /etc/wazuh-dashboard/opensearch_dashboards.yml /etc/wazuh-dashboard/opensearch_dashboards.yml.bak.$(date -u +%Y%m%dT%H%M%SZ)
sudo editor /etc/wazuh-dashboard/opensearch_dashboards.yml
sudo systemctl restart wazuh-dashboard
sudo systemctl status wazuh-dashboard --no-pager
```

Validation:

```bash
curl -k https://wazuh.kbeanprobo.com/api/opensearch-dashboards/settings
```

Expected setting:

```json
{
  "defaultRoute": {
    "isOverridden": true,
    "userValue": "/app/dashboards#/view/inssa-security-center"
  }
}
```

Browser validation:

```text
1. Open https://wazuh.kbeanprobo.com
2. Authenticate if needed.
3. Confirm the first visible operational page is INSSA Security Center.
4. Confirm navigation cards open:
   - INSSA Security Overview
   - INSSA Campaign Operations
   - INSSA Cleanup Queue
   - INSSA Executive View
```

Rollback:

```yaml
uiSettings.overrides.defaultRoute: "/app/wz-home"
```

Then restart:

```bash
sudo systemctl restart wazuh-dashboard
```

## Current User Flow

Until the server-side default route is changed, the reliable new-user path is:

```text
Wazuh Home
  -> Explore
  -> Dashboards
  -> INSSA Security Center
```

Fast path for users who have opened INSSA before:

```text
Wazuh Home
  -> Recently viewed
  -> INSSA Security Center
```

Direct operational URL:

```text
https://wazuh.kbeanprobo.com/app/dashboards#/view/inssa-security-center
```

## 30-Second New-User Validation

Current state:

| Scenario | Result |
| --- | --- |
| New user starts at Wazuh Home with no prior history. | Not guaranteed within 30 seconds unless they know to open Explore -> Dashboards. |
| Existing user has INSSA in Recently Viewed. | One click from Wazuh Home. |
| User has direct Security Center URL. | Immediate. |
| Server-side default route points to Security Center. | Immediate and reliable for new users. |

Conclusion:

```text
The 30-second new-user goal is not fully met until the server-side default route is changed.
```

## Recommendation

Proceed with the server-side default-route change using the supported Wazuh/OpenSearch Dashboards configuration mechanism.

Recommended final state:

```text
https://wazuh.kbeanprobo.com
  -> INSSA Security Center
```

Do not implement:

- Wazuh source patches.
- Wazuh plugin changes.
- Custom left-navigation hacks.
- Saved-search-only entry points.

## Final Status

Verdict:

```text
IMPLEMENTATION BLOCKED PENDING WAZUH SERVER CONFIG ACCESS
```

The correct solution is identified and validated as the lowest-risk supported path, but the current authenticated UI/API session cannot apply it because `defaultRoute` is server-overridden.

