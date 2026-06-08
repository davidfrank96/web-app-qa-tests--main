# INSSA Security Center Options for Wazuh

Assessment date: 2026-06-08

Target Wazuh deployment:

```text
https://wazuh.kbeanprobo.com
Wazuh app version observed in UI health check: 4.14.4
OpenSearch Dashboards version observed through /api/status: 2.19.4
```

Scope:

```text
Discovery and recommendation only.
No Wazuh saved objects, decoders, rules, ingestion services, tenants, roles, or configuration files were modified.
```

## Executive Summary

The best near-term user experience is an `INSSA Security Center` landing dashboard in Wazuh, backed by the existing INSSA dashboards and optionally configured as the Wazuh default route for INSSA operators.

Recommended architecture:

```text
Primary recommendation:
Option B - Dashboard Collection

Implementation:
Create an INSSA Security Center landing dashboard with markdown/link panels to:
- INSSA Security Overview
- INSSA Campaign Operations
- INSSA Cleanup Queue
- INSSA Executive View

Optional enhancement:
Use Wazuh/OpenSearch tenants as an INSSA tenant when role isolation is required.

Avoid:
Custom left-navigation modifications unless a formal Wazuh plugin-maintenance path is accepted.
```

Why:

- It uses supported Wazuh dashboard capabilities.
- It does not require modifying Wazuh plugin source or left navigation internals.
- It survives upgrades better than custom navigation patches.
- It gives users a single first-click destination.
- It can later be moved into a custom tenant for role-based isolation.

## Evidence Collected

Live UI observations:

| Capability | Evidence |
| --- | --- |
| Existing INSSA dashboards | Saved-object API returned four dashboards: `INSSA Security Overview`, `INSSA Campaign Operations`, `INSSA Cleanup Queue`, and `INSSA Executive View`. |
| Left navigation | Wazuh primary navigation shows built-in sections such as Home, Explore, Endpoint security, Threat intelligence, Security operations, Cloud security, Agents management, Server management, Indexer management, and Dashboard management. No custom `INSSA` nav slot was visible. |
| Recently viewed | Recently viewed surfaced all four INSSA dashboards after they had been opened. This is useful but user-history based, not managed navigation. |
| Spaces API | `/api/spaces/space` returned `404`. Kibana-style Spaces were not available through this deployment. |
| OpenSearch tenants | `_plugins/_security/api/tenants` returned `global_tenant` and `admin_tenant`, so tenant-based separation is available at the OpenSearch Security layer. |
| Default route | The saved config object did not currently include `defaultRoute`. Wazuh documentation supports setting `uiSettings.overrides.defaultRoute` in `opensearch_dashboards.yml`. |

Screenshots captured:

| Screenshot | Path |
| --- | --- |
| Wazuh home overview | `reports/wazuh-security-center-discovery/wazuh-home-overview.png` |
| Wazuh left navigation | `reports/wazuh-security-center-discovery/wazuh-left-navigation.png` |
| Recently viewed with INSSA dashboards | `reports/wazuh-security-center-discovery/wazuh-recently-viewed-inssa.png` |
| Dashboards list route behavior | `reports/wazuh-security-center-discovery/wazuh-dashboards-list.png` |

Documentation references:

- Wazuh custom dashboards are supported through dashboard and visualization creation: [Creating custom dashboards](https://documentation.wazuh.com/current/user-manual/wazuh-dashboard/creating-custom-dashboards.html).
- Wazuh multi-tenancy uses tenants for saved objects, dashboards, visualizations, and role-scoped access: [Enabling multi-tenancy](https://documentation.wazuh.com/current/user-manual/wazuh-dashboard/multi-tenancy.html).
- Wazuh supports default route configuration through `uiSettings.overrides.defaultRoute`: [Enabling multi-tenancy](https://documentation.wazuh.com/current/user-manual/wazuh-dashboard/multi-tenancy.html).
- Wazuh custom branding supports logos/header/footer branding, not a supported custom left-navigation item: [Setting up custom branding](https://documentation.wazuh.com/current/user-manual/wazuh-dashboard/custom-branding.html).

## Existing INSSA Dashboards

| Dashboard | Saved object ID | Purpose |
| --- | --- | --- |
| INSSA Security Overview | `inssa-security-overview` | Security triage, severity, classifications, active risks. |
| INSSA Campaign Operations | `inssa-campaign-operations` | Campaign history, campaign health, and summary events. |
| INSSA Cleanup Queue | `inssa-cleanup-queue` | Manual staging cleanup tracking. |
| INSSA Executive View | `inssa-executive-view` | Leadership rollup for risk, campaign health, and cleanup debt. |

## Capability Assessment

### 1. Custom Navigation Support

Question:

```text
Can Wazuh expose a custom menu item named INSSA inside the left navigation?
```

Assessment:

```text
Not as a supported low-risk UI setting in the current deployment.
```

Evidence:

- The current Wazuh primary navigation exposes fixed Wazuh sections.
- The visible navigation did not expose a UI control for adding a custom section.
- Wazuh custom branding documentation covers logos and report branding, not arbitrary left-navigation items.
- Wazuh/OpenSearch Dashboards has a plugin system, but adding a durable first-class `INSSA` app entry would require custom plugin work or patching Wazuh/OpenSearch Dashboard internals.

Recommendation:

```text
Do not implement custom navigation for the first operational version.
```

Risk:

| Risk | Level |
| --- | --- |
| Upgrade breakage from patched navigation internals | High |
| Operational ownership of custom plugin lifecycle | High |
| User experience benefit | High |
| Maintainability | Low |

Verdict:

```text
Technically possible only through custom plugin/patch work; not recommended now.
```

### 2. Dashboard Landing Pages

Question:

```text
Can Wazuh open directly into an INSSA dashboard collection?
```

Assessment:

```text
Yes, through dashboard URLs and Wazuh default route configuration.
```

Evidence:

- Existing INSSA dashboards are reachable by stable dashboard IDs.
- Wazuh documentation supports `uiSettings.overrides.defaultRoute` in `opensearch_dashboards.yml`.
- The live config object does not currently define a default route, so this is not enabled yet.

Recommended landing route:

```text
/app/dashboards#/view/inssa-executive-view
```

Better long-term landing route:

```text
/app/dashboards#/view/inssa-security-center
```

The second route assumes a new landing dashboard named `INSSA Security Center` is created with markdown panels and links to the four operational dashboards.

Risk:

| Risk | Level |
| --- | --- |
| Global default route affects all users | Medium |
| Supported Wazuh/OpenSearch setting | Low |
| Rollback complexity | Low |
| Upgrade risk | Low |

Verdict:

```text
Recommended if the default route is acceptable for the target user group or tenant.
```

### 3. Spaces Support

Question:

```text
Can Wazuh create INSSA Space with its own dashboards?
```

Assessment:

```text
Kibana-style Spaces API is not available in the current deployment, but Wazuh/OpenSearch tenant isolation is available.
```

Evidence:

- `/api/spaces/space` returned `404`.
- Saved object type `space` returned zero objects.
- `_plugins/_security/api/tenants` returned `global_tenant` and `admin_tenant`.
- Wazuh documentation describes tenants as containers for saved objects including index patterns, visualizations, and dashboards.

Recommendation:

```text
Use a custom OpenSearch Security tenant named INSSA or INSSA QA if role-scoped isolation is required.
```

Implementation shape:

```text
1. Create INSSA tenant.
2. Map INSSA operator roles to the tenant.
3. Import/copy INSSA saved objects into the tenant.
4. Confirm index pattern access to wazuh-alerts-*.
5. Set tenant-aware default route if desired.
```

Risk:

| Risk | Level |
| --- | --- |
| Users confused by tenant switching | Medium |
| Saved objects duplicated across tenants | Medium |
| Better isolation for INSSA users | High benefit |
| Upgrade risk | Low to medium |

Verdict:

```text
Recommended for role-based operations, but not required for first discoverability improvement.
```

### 4. Dashboard Grouping

Question:

```text
Can dashboards be grouped into INSSA Security Center inside the UI?
```

Assessment:

```text
Not as a native folder/collection object in the observed UI. Grouping is achievable through naming and a landing dashboard.
```

Current grouping mechanisms:

- `INSSA` title prefix.
- `inssa-` saved object ID prefix.
- Saved searches prefixed with `INSSA`.
- Recently viewed entries after dashboards are opened.
- A purpose-built markdown landing dashboard.

Recommended grouping pattern:

```text
Dashboard:
INSSA Security Center

Panels:
- Security Overview link card
- Campaign Operations link card
- Cleanup Queue link card
- Executive View link card
- Current high/critical count metrics
- Cleanup debt metric
```

Risk:

| Risk | Level |
| --- | --- |
| Naming-only organization is less discoverable than folders | Medium |
| Landing dashboard solves first-click flow | Low |
| Upgrade risk | Low |

Verdict:

```text
Use a landing dashboard as the dashboard collection.
```

### 5. Saved Object Organization

Question:

```text
Can INSSA dashboards be organized separately from core Wazuh dashboards?
```

Assessment:

```text
Yes, partially through naming and fully through tenants.
```

Observed current state:

- All INSSA saved objects already use `INSSA` titles or `inssa-` IDs.
- Core Wazuh index patterns remain separate and should not be modified.

Recommended organization:

| Layer | Recommendation |
| --- | --- |
| Object names | Keep `INSSA` prefix. |
| Object IDs | Keep `inssa-` prefix for reproducible automation. |
| Queries | Keep `data.source:web-app-qa-tests AND data.product:INSSA`. |
| Tenant isolation | Use a custom tenant when operators need a separate workspace. |
| Saved object export | Export INSSA-only object bundle after changes. |

Verdict:

```text
Current organization is acceptable. Tenant isolation is the next step if the audience expands.
```

### 6. Landing Page Customization

Question:

```text
Can INSSA become a first-click destination for users?
```

Assessment:

```text
Yes, by setting a default route or by training users to open the INSSA Security Center dashboard from Recently viewed/Dashboards.
```

Options:

| Approach | User experience | Risk |
| --- | --- | --- |
| Create `INSSA Security Center` dashboard only | Users search/open it once; then it appears in Recently viewed. | Low |
| Set global default route to `INSSA Security Center` | Users land directly on INSSA. | Medium |
| Set tenant default route to `INSSA Security Center` | INSSA users land directly on INSSA after tenant selection. | Low to medium |
| Custom left navigation | Users see `INSSA` as first-class app. | High |

Verdict:

```text
Create the landing dashboard first. Add default route only after stakeholder approval.
```

### 7. Role-Based Visibility

Question:

```text
Can future INSSA users see INSSA first while retaining access to Wazuh?
```

Assessment:

```text
Likely yes through Wazuh/OpenSearch Security tenants and role mapping, but not through Kibana-style Spaces in this deployment.
```

Recommended role model:

| Role | Tenant | Access |
| --- | --- | --- |
| INSSA QA Viewer | INSSA tenant | Read-only dashboards and Discover views. |
| INSSA QA Operator | INSSA tenant | Read dashboards, run Discover, export reports. |
| INSSA Admin | INSSA tenant and Global | Manage INSSA saved objects and troubleshoot Wazuh. |
| Platform Admin | Global and admin tenants | Wazuh platform administration. |

Important note:

```text
Role-based first-click routing should be validated in a non-production Wazuh tenant before changing global defaults.
```

Verdict:

```text
Use tenants for future role-based visibility. Do not patch navigation for role-based UX.
```

## Option Comparison

### Option A: Dashboard-only

Description:

```text
Keep the four existing INSSA dashboards and share their direct URLs.
```

Pros:

- Already implemented.
- Lowest operational risk.
- No Wazuh server config change.
- No saved object duplication.

Cons:

- Poor discoverability.
- Users must know the exact URL or use Recently viewed.
- No single `Security Center` entry point.

Recommendation:

```text
Acceptable as baseline, but not enough for operational rollout.
```

### Option B: Dashboard Collection

Description:

```text
Create an INSSA Security Center landing dashboard that links to the existing dashboards and includes top-level metrics.
```

Pros:

- Best balance of user experience and maintainability.
- Uses standard Wazuh dashboard objects.
- Low upgrade risk.
- Can be linked, bookmarked, made default route, or copied into a tenant.
- Does not modify Wazuh core code.

Cons:

- Not a native left-nav app.
- Users still need one initial route unless default route is configured.
- Requires dashboard maintenance as more INSSA views are added.

Recommendation:

```text
Recommended primary option.
```

### Option C: Space

Description:

```text
Use Wazuh/OpenSearch tenant isolation as an INSSA workspace.
```

Pros:

- Stronger separation from core Wazuh dashboards.
- Cleaner role mapping for future INSSA-only users.
- Tenant can contain only INSSA saved objects.

Cons:

- Live deployment does not expose Kibana-style Spaces.
- Tenant setup requires Wazuh/OpenSearch Security administration.
- Saved objects may need re-import/copy into the tenant.
- Users may need tenant-switching guidance.

Recommendation:

```text
Recommended second phase for role-based operations, not required for immediate discoverability.
```

### Option D: Custom Navigation

Description:

```text
Add a first-class INSSA item to the Wazuh left navigation.
```

Pros:

- Best possible discoverability.
- Cleanest user-facing experience.

Cons:

- No supported UI setting was found for this.
- Likely requires custom plugin work or patching Wazuh/OpenSearch Dashboard internals.
- Highest upgrade risk.
- Requires ongoing platform engineering ownership.

Recommendation:

```text
Do not implement now.
Only consider if Wazuh operators accept custom plugin maintenance.
```

## Recommended Architecture

Recommended near-term:

```text
INSSA Security Center landing dashboard
  -> INSSA Security Overview
  -> INSSA Campaign Operations
  -> INSSA Cleanup Queue
  -> INSSA Executive View
```

Recommended medium-term:

```text
INSSA tenant
  -> INSSA Security Center landing dashboard
  -> INSSA saved searches
  -> INSSA visualizations
  -> INSSA dashboards
  -> Read-only role for QA/security viewers
```

Recommended optional default route:

```text
uiSettings.overrides.defaultRoute: /app/dashboards#/view/inssa-security-center
```

If using a tenant-aware route, validate the final route in Wazuh before applying it globally.

## Implementation Plan

Phase 1:

1. Create `INSSA Security Center` dashboard.
2. Add markdown link panels to the four current dashboards.
3. Add top-level metric panels for critical, high, open findings, and cleanup debt.
4. Validate it appears in Recently viewed.
5. Export INSSA saved objects as backup.

Phase 2:

1. Decide whether INSSA should be the default route for all Wazuh users or only INSSA users.
2. If all users, set global default route to the landing dashboard.
3. If only INSSA users, create a custom tenant and validate tenant routing.

Phase 3:

1. Add role mapping for INSSA QA/Security users.
2. Validate read-only access.
3. Validate Wazuh core admin access remains unaffected.

## Final Recommendation

Use this decision:

```text
Best user experience: Option B now, Option C later.
Best maintainability: Option B.
Least risk to Wazuh upgrades: Option B.
Best role-based isolation: Option C.
Do not use Option D unless custom plugin maintenance is explicitly accepted.
```

Final recommendation:

```text
Create an INSSA Security Center landing dashboard as the primary entry point.
Keep existing dashboard names and IDs.
Use defaultRoute only after validating whether it should be global or tenant-specific.
Use a custom tenant later if INSSA users need a dedicated workspace.
Avoid custom navigation modifications for now.
```
