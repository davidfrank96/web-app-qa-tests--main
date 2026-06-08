# INSSA Default Route Decision

Decision date: 2026-06-08

Target:

```text
https://wazuh.kbeanprobo.com
```

Proposed route:

```text
/app/dashboards#/view/inssa-security-center
```

Current route:

```text
/app/wz-home
```

## Decision

```text
GO, WITH PLATFORM OWNER APPROVAL
```

Make `INSSA Security Center` the Wazuh/OpenSearch Dashboards default route if the current deployment is primarily used for INSSA QA/security operations or if INSSA operators can be routed through a dedicated tenant/user group.

Do not apply the change blindly if the same Wazuh instance is shared by unrelated infrastructure, endpoint, or cloud-security operators who expect the Wazuh Home page.

## Reasoning

The default route is the lowest-risk supported method for making INSSA immediately accessible.

It avoids:

- Wazuh source patches.
- Plugin changes.
- Unsupported left-navigation hacks.
- Dependency on Recently Viewed.
- Dependency on direct dashboard history.

It uses:

```yaml
uiSettings.overrides.defaultRoute
```

which is already active in the deployment.

## Current Deployment Assessment

| Area | Current state | Decision impact |
| --- | --- | --- |
| INSSA dashboards | Present and validated. | Supports Go. |
| Saved searches | Present and validated. | Supports Go. |
| Visualizations | Present and dashboard-referenced. | Supports Go. |
| Wazuh default route | Server-overridden to `/app/wz-home`. | Requires server config access. |
| User base | Not fully confirmed from repo context. | Requires owner approval. |
| Shared Wazuh operations | Built-in Wazuh sections are present. | Use caution if non-INSSA users rely on Wazuh Home. |
| Rollback | Simple config rollback to `/app/wz-home`. | Supports Go. |

## Go Criteria

Proceed when all are true:

| Criterion | Required state |
| --- | --- |
| Platform owner approval | Approved. |
| User impact accepted | Non-INSSA users accept default landing on INSSA or use another tenant/URL. |
| Rollback path confirmed | Prior config backed up. |
| Dashboard validation current | `INSSA Security Center` renders and target cards work. |
| Wazuh restart window approved | Restart impact accepted. |

## No-Go Criteria

Do not proceed when any are true:

| Criterion | Reason |
| --- | --- |
| Wazuh is primarily used by non-INSSA operators. | Default route would be disruptive. |
| No platform owner approval. | Server config change affects all users in the scope. |
| No rollback access. | Operational risk is unnecessary. |
| INSSA Security Center is not rendering. | Do not route users to a broken dashboard. |
| A dedicated tenant is planned immediately. | Better to set route in the tenant-specific scope. |

## Recommended Implementation

Server-side setting:

```yaml
uiSettings.overrides.defaultRoute: "/app/dashboards#/view/inssa-security-center"
```

Expected config locations:

```text
/etc/wazuh-dashboard/opensearch_dashboards.yml
/usr/share/wazuh-dashboard/config/opensearch_dashboards.yml
```

Implementation steps:

```bash
sudo grep -R "defaultRoute" /etc/wazuh-dashboard /usr/share/wazuh-dashboard/config
sudo cp /etc/wazuh-dashboard/opensearch_dashboards.yml /etc/wazuh-dashboard/opensearch_dashboards.yml.bak.$(date -u +%Y%m%dT%H%M%SZ)
sudo editor /etc/wazuh-dashboard/opensearch_dashboards.yml
sudo systemctl restart wazuh-dashboard
sudo systemctl status wazuh-dashboard --no-pager
```

Validation:

```text
1. Open https://wazuh.kbeanprobo.com.
2. Authenticate.
3. Confirm Wazuh opens to INSSA Security Center.
4. Confirm Security Overview card opens INSSA Security Overview.
5. Confirm Campaign Operations card opens INSSA Campaign Operations.
6. Confirm Cleanup Queue card opens INSSA Cleanup Queue.
7. Confirm Executive View card opens INSSA Executive View.
```

Settings API validation:

```bash
curl -k https://wazuh.kbeanprobo.com/api/opensearch-dashboards/settings
```

Expected:

```json
{
  "defaultRoute": {
    "isOverridden": true,
    "userValue": "/app/dashboards#/view/inssa-security-center"
  }
}
```

## Rollback

Restore:

```yaml
uiSettings.overrides.defaultRoute: "/app/wz-home"
```

Then:

```bash
sudo systemctl restart wazuh-dashboard
```

Rollback validation:

```text
Open https://wazuh.kbeanprobo.com and confirm Wazuh Home appears.
```

## User Experience Impact

Before:

```text
New operator -> Wazuh Home -> Explore -> Dashboards -> INSSA Security Center
```

After:

```text
New operator -> Wazuh -> INSSA Security Center
```

Expected result:

```text
The 30-second discoverability target is met.
```

## Final Recommendation

```text
GO after platform owner approval and user-impact confirmation.
```

Until approved, use bookmarks and the documented quick-start flow.

