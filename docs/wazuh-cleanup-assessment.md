# Wazuh Cleanup Assessment for INSSA Dashboards

Assessment date: 2026-06-08

Scope:

```text
Wazuh saved objects only:
- dashboards
- visualizations
- saved searches
- index patterns
```

This assessment did not delete, hide, archive, or modify any Wazuh objects.

## Executive Summary

The current Wazuh saved object inventory is already narrow and INSSA-focused. The only non-INSSA saved objects found are the three core Wazuh index patterns required by Wazuh functionality.

Inventory counts:

| Object type | Count |
| --- | ---: |
| Dashboards | 4 |
| Visualizations | 18 |
| Saved searches | 9 |
| Index patterns | 3 |

Classification summary:

| Classification | Count | Notes |
| --- | ---: | --- |
| Core Wazuh | 3 | Required index patterns. Do not remove. |
| INSSA | 31 | Current INSSA saved searches, visualizations, and dashboards. Keep. |
| Sample Data | 0 | No sample-data saved objects found. |
| Demo Content | 0 | No demo saved objects found. |
| Unused | 0 | No orphaned visualizations found. |

Recommendation:

```text
Do not delete anything in the current state.
Keep all existing objects.
Use naming, optional Wazuh spaces, and export backups to isolate INSSA from core Wazuh.
```

## Assessment Method

Inventory was pulled from the authenticated Wazuh Dashboard saved-objects API for these types:

```text
dashboard
visualization
search
index-pattern
```

The assessment classified objects using:

- Saved object type.
- Saved object title.
- Saved object ID.
- Dashboard panel references.
- Whether the object is a known Wazuh core index pattern.
- Whether the object uses the `INSSA` title prefix or `inssa-` object ID prefix.

## Classification Rules

| Classification | Rule |
| --- | --- |
| Core Wazuh | Required Wazuh index patterns such as `wazuh-alerts-*`, `wazuh-monitoring-*`, and `wazuh-statistics-*`. |
| Sample Data | Objects clearly created by Wazuh/OpenSearch sample data installers. |
| Demo Content | Objects with demo/example/tutorial naming not used by INSSA or Wazuh core operations. |
| Unused | Visualizations not referenced by any dashboard and not intentionally retained as standalone operational views. |
| INSSA | Objects with `INSSA` title prefix or `inssa-` saved object ID prefix. |

## Dashboard Inventory

| Dashboard | Saved object ID | Classification | Recommendation | Reason |
| --- | --- | --- | --- | --- |
| INSSA Security Overview | `inssa-security-overview` | INSSA | Keep | Primary security triage dashboard. |
| INSSA Executive View | `inssa-executive-view` | INSSA | Keep | Leadership rollup for findings, campaign health, and cleanup debt. |
| INSSA Campaign Operations | `inssa-campaign-operations` | INSSA | Keep | Campaign history and operational health dashboard. |
| INSSA Cleanup Queue | `inssa-cleanup-queue` | INSSA | Keep | Manual staging cleanup tracking dashboard. |

Dashboard cleanup recommendation:

```text
No dashboards are safe deletion candidates.
```

## Visualization Inventory

All current visualizations are INSSA-owned and referenced by at least one INSSA dashboard.

| Visualization | Saved object ID | Referenced by dashboard | Classification | Recommendation | Reason |
| --- | --- | --- | --- | --- | --- |
| INSSA Critical Findings | `inssa-critical-findings-count` | Yes | INSSA | Keep | Used by Security Overview and Executive View. |
| INSSA High Findings | `inssa-high-findings-count` | Yes | INSSA | Keep | Used by Security Overview and Executive View. |
| INSSA Open Findings | `inssa-open-findings-count` | Yes | INSSA | Keep | Used by Security Overview. |
| INSSA Findings By Severity | `inssa-findings-by-severity` | Yes | INSSA | Keep | Used by Security Overview and Executive View. |
| INSSA Findings By Classification | `inssa-findings-by-classification` | Yes | INSSA | Keep | Used by Security Overview. |
| INSSA Findings By Day | `inssa-findings-by-day` | Yes | INSSA | Keep | Used by Security Overview and Executive View. |
| INSSA Findings By Campaign | `inssa-findings-by-campaign` | Yes | INSSA | Keep | Used by Security Overview. |
| INSSA Top Active Risks | `inssa-top-active-risks` | Yes | INSSA | Keep | Used by Security Overview and Executive View. |
| INSSA Security Campaign History | `inssa-security-campaign-history` | Yes | INSSA | Keep | Used by Campaign Operations. |
| INSSA Cross User Campaign History | `inssa-cross-user-campaign-history` | Yes | INSSA | Keep | Used by Campaign Operations. |
| INSSA Reveal Later Campaign History | `inssa-reveal-later-campaign-history` | Yes | INSSA | Keep | Used by Campaign Operations. |
| INSSA Release Gate History | `inssa-release-gate-history` | Yes | INSSA | Keep | Used by Campaign Operations. |
| INSSA Campaign Success Rate | `inssa-campaign-success-rate` | Yes | INSSA | Keep | Used by Campaign Operations and Executive View. |
| INSSA Campaign History By Day | `inssa-campaign-duration-proxy` | Yes | INSSA | Keep | Used by Campaign Operations. |
| INSSA Cleanup Age | `inssa-cleanup-age` | Yes | INSSA | Keep | Used by Cleanup Queue. |
| INSSA Capsules Pending Cleanup | `inssa-capsules-pending-cleanup` | Yes | INSSA | Keep | Used by Cleanup Queue and Executive View. |
| INSSA Campaign Summary Events | `inssa-campaign-summary-count` | Yes | INSSA | Keep | Used by Campaign Operations to validate campaign summary ingestion. |
| INSSA Cleanup Status | `inssa-cleanup-status` | Yes | INSSA | Keep | Used by Cleanup Queue. |

Visualization cleanup recommendation:

```text
No visualizations are safe deletion candidates.
```

## Saved Search Inventory

Saved searches are not embedded in the current dashboard panels, but they are intentionally retained as Discover entry points for operations and validation.

| Saved search | Saved object ID | Classification | Recommendation | Reason |
| --- | --- | --- | --- | --- |
| INSSA Campaign Summaries | `inssa-campaign-summaries` | INSSA | Keep | Direct Discover view for `campaign_summary` events. |
| INSSA Reveal Later Summaries | `inssa-reveal-later-summaries` | INSSA | Keep | Reveal-later campaign troubleshooting. |
| INSSA Release Gate Summaries | `inssa-release-gate-summaries` | INSSA | Keep | Release-gate troubleshooting. |
| INSSA Open Findings | `inssa-open-findings` | INSSA | Keep | Operational work queue for unresolved findings. |
| INSSA Security Summaries | `inssa-security-summaries` | INSSA | Keep | Security campaign rollup inspection. |
| INSSA Cross User Summaries | `inssa-cross-user-summaries` | INSSA | Keep | Cross-user access-control investigation view. |
| INSSA Critical Findings | `inssa-critical-findings` | INSSA | Keep | Critical-finding triage entry point. |
| INSSA High Findings | `inssa-high-findings` | INSSA | Keep | High-risk finding triage entry point. |
| INSSA Cleanup Queue | `inssa-cleanup-queue` | INSSA | Keep | Cleanup investigation entry point. |

Saved search cleanup recommendation:

```text
No saved searches are safe deletion candidates.
```

## Index Pattern Inventory

| Index pattern | Saved object ID | Classification | Recommendation | Reason |
| --- | --- | --- | --- | --- |
| `wazuh-monitoring-*` | `wazuh-monitoring-*` | Core Wazuh | Keep | Required for Wazuh monitoring dashboards and health visibility. |
| `wazuh-statistics-*` | `wazuh-statistics-*` | Core Wazuh | Keep | Required for Wazuh statistics views. |
| `wazuh-alerts-*` | `wazuh-alerts-*` | Core Wazuh | Keep | Required for Wazuh alerts, INSSA dashboards, rules, and investigations. |

Index pattern cleanup recommendation:

```text
Do not delete or modify Wazuh index patterns as part of INSSA cleanup.
```

## Safe Deletion Candidates

None.

No sample data, demo dashboards, or orphaned INSSA visualizations were found in the current Wazuh saved object inventory.

## Objects That Should Remain

These must remain:

- All four INSSA dashboards.
- All INSSA visualizations because each is referenced by at least one dashboard.
- All INSSA saved searches because they are operational Discover entry points.
- All three Wazuh index patterns because they are core Wazuh objects.

## Objects That Should Be Isolated From INSSA

Core Wazuh objects should remain separate from INSSA-specific content:

| Object | Isolation guidance |
| --- | --- |
| `wazuh-alerts-*` | Shared core alerts index pattern. INSSA should use filters such as `data.source:web-app-qa-tests AND data.product:INSSA`. |
| `wazuh-monitoring-*` | Keep for platform monitoring only. Do not add INSSA dashboard objects that depend on this pattern unless monitoring Wazuh health. |
| `wazuh-statistics-*` | Keep for Wazuh statistics only. Do not repurpose for INSSA campaign reporting. |

Recommended INSSA isolation practices:

- Keep the `INSSA` title prefix for dashboards, visualizations, and saved searches.
- Keep the `inssa-` saved object ID prefix for reproducible automation.
- Use the dashboard-level filter `data.source:web-app-qa-tests AND data.product:INSSA`.
- If Wazuh Spaces are available, create a dedicated `INSSA QA` space before adding more dashboard families.
- Export INSSA saved objects before any future cleanup.

## Hide, Archive, Delete, Keep Recommendations

| Action | Current recommendation | Rationale |
| --- | --- | --- |
| Hide | Not needed | No noisy non-INSSA dashboard content was found. |
| Archive | Not needed now | No stale or orphaned saved objects were found. |
| Delete | Do not delete | Current inventory is either INSSA-owned or core Wazuh. |
| Keep | Required | All objects currently serve Wazuh core functionality or INSSA observability. |

## Risk Assessment

| Risk | Level | Mitigation |
| --- | --- | --- |
| Deleting `wazuh-alerts-*` breaks Wazuh alert dashboards and INSSA dashboards. | High | Never delete core Wazuh index patterns during INSSA cleanup. |
| Deleting INSSA visualizations breaks dashboard panels. | Medium | Keep visualizations referenced by dashboards. Export saved objects before cleanup. |
| Deleting saved searches reduces investigation ergonomics. | Low | Retain saved searches as operational Discover entry points. |
| Mixing INSSA and core Wazuh content causes dashboard clutter. | Low | Continue using `INSSA` naming and base filters; use Wazuh Spaces if available. |
| Deleting objects without backup makes rollback slow. | Medium | Export saved objects before any future hide/archive/delete action. |

## Future Cleanup Procedure

Before any future cleanup:

1. Export all Wazuh saved objects from Stack Management.
2. Export the INSSA-only objects as a separate backup.
3. Confirm object ownership with QA/Security/Platform.
4. Archive or hide first when possible.
5. Delete only after a restore path has been validated.

Recommended deletion criteria for future runs:

- Object is not a core Wazuh object.
- Object is not INSSA-owned.
- Object is not referenced by any dashboard.
- Object is confirmed sample/demo content.
- Object has an exported backup.
- Owner approves deletion.

## Final Recommendation

Verdict:

```text
PASS WITH WARNINGS
```

The Wazuh saved object inventory is clean enough for INSSA dashboards. No cleanup action is required before continuing INSSA observability work.

Warnings:

- `wazuh-alerts-*` is shared between Wazuh core views and INSSA dashboards; keep INSSA filters strict.
- Do not delete any Wazuh object without first exporting saved objects.
- If additional non-INSSA dashboards appear later, reassess them before deletion.
