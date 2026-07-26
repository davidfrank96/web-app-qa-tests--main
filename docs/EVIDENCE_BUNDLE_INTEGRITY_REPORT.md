# Evidence Bundle Integrity Report

> Historical Phase 2.5 validation record. Current evidence status is maintained in `EVIDENCE_SYSTEM_CERTIFICATION.md`.

Date: 2026-07-13

Scope: Phase 2.5 validation for dashboard-served Playwright evidence bundles.

## Executive Summary

Phase 2 bundle serving compiles and exposes an authenticated, bundle-relative route for Playwright reports:

```text
GET /api/artifacts/:id/bundle/*
```

The route resolves files relative to `playwright-report/`, enforces authentication before serving content, rejects directory escape, and preserves the legacy endpoint:

```text
GET /api/artifacts/:id/file
```

Validation found one serving-layer hardening issue: Playwright bundle serving accepted any non-sensitive artifact classified as `Playwright Report`. That was tightened so only the compatibility artifact path `playwright-report/index.html` is accepted.

Full authenticated visual parity could not be completed in this environment because no valid dashboard-authenticated browser session was available and the local Supabase password login attempt returned `401 Invalid email or password`. Authentication was not bypassed.

## Playwright Bundle Inventory

Current local Playwright bundle:

```text
playwright-report/
  index.html
  data/*.png
  data/*.md
```

Detected files:

| Type | Count | Expected MIME |
| --- | ---: | --- |
| HTML | 1 | `text/html; charset=utf-8` |
| PNG screenshots/images | 7 | `image/png` |
| Markdown/error context | 1 | `text/markdown; charset=utf-8` |
| CSS | 0 | Not present as external file |
| JavaScript | 0 | Not present as external file |
| JSON | 0 | Not present in current report bundle |
| WebM/MP4 video | 0 | Not present in current report bundle |
| Trace ZIP | 0 | Not present in current report bundle |
| Fonts/icons | 0 | Not present as external files |

The current Playwright report is mostly self-contained HTML with external `data/` evidence files.

## Campaign Output Matrix

Dashboard metadata currently contains historical runs created before evidence bundle metadata indexing was introduced. Those historical runs have artifacts but no `evidenceBundles` or `evidenceItems`.

| Campaign | Latest Run | Status | Playwright Report | Artifacts | Evidence Bundle | Integrity Status |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Safe Suite | `e61cce7d-a421-422a-a6a1-db166b80ccce` | failed | 1 | 74 | 0 | Partial: historical run has no bundle metadata |
| Security Campaign | `c58b5ef1-3266-4501-92fd-380a09ed3ce2` | passed_with_warnings | 1 | 38 | 0 | Partial: historical run has no bundle metadata |
| Security Verification | none | unavailable | 0 | 0 | 0 | Not validated: no dashboard run record |
| Artifact Validation | none | unavailable | 0 | 0 | 0 | Not validated: no dashboard run record |

## API Validation

Temporary dashboard server:

```text
http://127.0.0.1:3101
```

Representative Playwright artifact:

```text
398b0c29-606c-46b5-a0f2-59ae07bffec7
```

| Route | Result | Meaning |
| --- | --- | --- |
| `/api/artifacts/:id/bundle/index.html` | `401 application/json` | Route is reachable and authentication is enforced |
| `/api/artifacts/:id/bundle/data/<png>` | `401 application/json` | Asset route is reachable and authentication is enforced |
| `/api/artifacts/:id/bundle/data/<md>` | `401 application/json` after route compile | Markdown asset route is reachable and authentication is enforced |
| `/api/artifacts/:id/file` | `401 application/json` | Legacy route remains reachable and authentication is enforced |
| `/api/artifacts/:id/bundle/%2e%2e/package.json` | `404` before handler | Next route normalization prevents traversal route match; helper also blocks traversal if reached |

## Build Validation

Command:

```bash
npm run dashboard:build
```

Result: PASS.

Compiled route present:

```text
/api/artifacts/[id]/bundle/[[...relativePath]]
```

## Chain of Custody

Current intended chain:

```text
Campaign
↓
Run
↓
Evidence Bundle
↓
Evidence Items
↓
Reports
↓
SIEM Export
```

Current historical metadata status:

| Layer | Status |
| --- | --- |
| Campaign | Present |
| Run | Present |
| Artifact records | Present |
| Evidence Bundle records | Missing for historical runs |
| Evidence Item records | Missing for historical runs |
| Reports | Present |
| SIEM Export | Present |

New dashboard runner executions should create evidence bundle metadata automatically through the Phase 1 metadata layer. Historical runs were not backfilled during this sprint because Phase 2.5 does not implement metadata redesign, storage migration, or retention.

## Integrity Findings

### Finding 1: Historical runs are not chain-of-custody complete

Severity: Medium

Evidence: `dashboard/.data/inssa-runs.json` contains runs and artifacts, but `evidenceBundles` and `evidenceItems` are empty.

Impact: Historical runs can still expose artifact metadata through compatibility APIs, but they cannot prove the full evidence chain introduced in Phase 1.

Resolution: Not fixed in Phase 2.5. Requires either new dashboard-run executions or a dedicated metadata backfill sprint.

### Finding 2: Authenticated visual parity is blocked by missing dashboard session

Severity: Medium

Evidence:

```text
GET /api/artifacts/:id/bundle/index.html -> 401 Authentication required
POST /api/auth/password -> 401 Invalid email or password
```

Impact: This environment cannot prove browser-rendered dashboard parity against the local Playwright report without a valid dashboard user session.

Resolution: Not fixed. Authentication remains enforced. Validate manually with a valid dashboard Supabase user or create the required test user in Supabase outside this sprint.

### Finding 3: Playwright artifact classifier was too broad for serving

Severity: Low

Evidence: Bundle route originally accepted any non-sensitive `Playwright Report` artifact.

Resolution: Fixed. Bundle serving now requires:

```text
artifactType === "Playwright Report"
sensitive === false
filePath === "playwright-report/index.html"
```

## Backward Compatibility

| API | Status |
| --- | --- |
| `GET /api/artifacts/:id/file` | Preserved |
| `GET /api/artifacts/:id/bundle/*` | Added in Phase 2 |
| `GET /api/runs/:id/artifacts` | Unchanged |
| Dashboard execution flow | Unchanged |
| Artifact indexing | Unchanged |
| Report generation | Unchanged |
| Runner | Unchanged |

## Final Integrity Matrix

| Area | Status | Notes |
| --- | --- | --- |
| Bundle route compilation | PASS | Next build includes route |
| Bundle-relative routing | PASS | HTML/PNG/Markdown paths route through API after compile |
| Authentication | PASS | Unauthenticated access returns 401 |
| Path traversal protection | PASS | Traversal URL does not serve files |
| MIME mapping | PASS for current bundle | HTML, PNG, Markdown mapped; CSS/JS/JSON/WebM/ZIP supported for future bundles |
| Local bundle inventory | PASS | Current files enumerated and hashable |
| Visual parity | BLOCKED | Requires authenticated dashboard session |
| Trace viewer | NOT APPLICABLE | No trace files in current Playwright report |
| Video | NOT APPLICABLE | No video files in current Playwright report |
| Chain of custody | PARTIAL | Historical runs have no evidence bundle metadata |

## Remaining Gaps Before Storage

1. Run a fresh dashboard-triggered Safe Suite with a valid operator/admin user so evidence bundle metadata is created for a current run.
2. Repeat with Security Campaign, Security Verification, and Artifact Validation once valid dashboard authentication is available.
3. Validate authenticated browser parity by opening both:

```text
playwright-report/index.html
/api/artifacts/:id/bundle/index.html
```

4. Add a future metadata backfill sprint if historical evidence bundles must be chain-of-custody complete.
5. Defer durable historical report preservation to the storage phase; the current local Playwright output remains transient and can be overwritten.
