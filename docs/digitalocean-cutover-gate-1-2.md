# DigitalOcean Cutover Gate 1 and Gate 2

Date: 2026-08-10

## Scope

This gate prepares the QA Operations Platform for its first hosted deployment. It does not deploy DigitalOcean resources, enable live mutation campaigns, or certify Media, Video, Cross-User, or Reveal-Later campaigns.

## Release Security

The dashboard's transitive `nanoid` dependency is pinned to patched version `3.3.17`. Root and dashboard production audits report zero high or critical vulnerabilities.

The historical-token audit confirmed six affected JSON files in commit `3506a72a018f`, containing five unique UUID-form token values. Four values have complete lifecycle capsule URLs; one appears only in incomplete navigation evidence. Read-only browser probes showed that the four tokenized URLs no longer expose the expected QA capsule content through the supplied token, while the corresponding tokenless capsule IDs remain publicly readable. This means the historical values provide no observed access benefit, but it does not prove server-side expiry or revocation. The repository exposes no token-status or revocation API, and the fifth value cannot be validated from a complete URL.

Security policy therefore still requires the coordinated Git-history rewrite. No history rewrite was performed by this sprint.

## Supabase Target And Migration State

The configured host and authenticated Supabase dashboard session resolve to the dedicated `QA platform` project. The separate Supabase connector exposes a different project and was not used.

The repository now has a committed Supabase CLI configuration and nine ordered migrations. The ninth forward migration disables scheduled staging authentication monitoring without removing the monitor or changing controlled manual execution.

Remote application is blocked because the local environment has no Supabase CLI access token or database password. `persistence:verify` and `persistence:provision` confirm that all 12 PostgREST resources are absent. A separate read-only storage check confirms that the configured `inssa-evidence` bucket exists and is private. Migrations were not applied through the SQL Editor because doing so would bypass CLI migration history and create drift.

## Historical Development Archive

The pre-deployment archive was created at:

```text
/Users/frankenstein/Desktop/web-app-qa-tests/deployment-archives/qa-platform-pre-deployment-2026-08-10T13-22-22-020Z/
```

It contains 1,588 files in a 312,568,454-byte compressed archive. `archive-manifest.json` records the source Git SHA, per-root counts and sizes, and a SHA-256 checksum. This archive must be copied to restricted off-host storage before host deployment. It is historical development evidence and must not be represented as uploaded Supabase evidence.

## Hosted Production Operational State

The operational-state importer dry-run passes. It prepares exactly:

- nine identified deferred-cleanup records, including originating run IDs, object paths, campaigns, statuses, and retention deadlines;
- seven monitoring definitions;
- zero scheduler occurrences, execution jobs, outbox events, historical runs, logs, artifacts, or evidence items.

Every authentication monitoring definition is forced disabled during import. The importer requires a verified archive checksum and an explicit project reference matching the configured Supabase URL before it can write.

Remote import remains blocked until the migration chain is applied.

## Production Configuration

`dashboard/.env.production.example` is the first-deployment template. It configures Supabase metadata and evidence providers, keeps `INSSA_URL` on staging, disables production authentication monitoring, disables live mutation campaigns, and leaves SIEM delivery in dry-run mode. Real credentials belong in the host's restricted service environment, never in the repository.

## Validation

| Check | Result |
| --- | --- |
| Root TypeScript | PASS |
| Dashboard TypeScript | PASS |
| Platform subsystem tests | PASS, 35/35 |
| Security regression | PASS, 5/5 |
| Safe Suite | PASS, 10/10 |
| Dashboard production build | PASS |
| Runtime Doctor | PASS |
| Root production audit | PASS, zero high/critical |
| Dashboard production audit | PASS, zero high/critical |
| Operational import dry-run | PASS, 9 cleanup records and 7 monitor definitions |
| Pre-deployment archive | PASS, checksum recorded |
| Private evidence bucket | PASS, exists and is private |
| Remote migrations | BLOCKED, missing CLI/database authorization |
| Remote RLS and table verification | BLOCKED, migrations not applied |
| Supabase cutover run | BLOCKED, migrations not applied |
| Git history policy | BLOCKED, approved rewrite outstanding |

## Gate Verdict

**CUTOVER BLOCKED**

Remaining Gate 1/2 actions are limited to obtaining authorized CLI/database access for the verified QA Platform project, applying and verifying the nine migrations, importing the operational state, validating a fresh Supabase-backed safe run and restart, copying the archive off-host, and completing the approved history rewrite.
