# Stabilization Wave 1 — September 14, 2026

This change addresses dependency security, failure evidence durability, atomic publication and minimal infrastructure health. The September baseline and measurements are preserved in their original files. Release approval remains conditional on current PR CI and the post-merge checks below.

## Dependency remediation

Next.js 15.5.22 → **15.5.24**, sharp 0.35.0 → **0.35.4**. Fresh npm advisory queries confirmed these as the minimum patched compatible versions. The sharp override also updates its required native/libvips entries and required @emnapi/runtime patch. React, Supabase, Playwright and Node are unchanged. Both production audits report zero vulnerabilities. The local runtime is Node 22.23.2; the live target reported Node 22.22.2.

Sources: [Next advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c). Two independent security reviews found no actionable bypass in the patch. The app does not use next/image directly, but the framework image endpoint exists; the patched loader and native codec remain relevant. A native PNG/WebP/AVIF round-trip regression exercises the installed sharp runtime. No public remote image origin was enabled.

## Evidence publication

A settled process tree and a current execution lease determine upload eligibility. Test exit status does not gate uploads. Passing, failed and timed-out fixture runs now index, upload, download-verify and publish evidence. Test outcome remains independent of upload outcome. A lost lease stops publication and leaves a diagnostic `EVIDENCE_UNAVAILABLE`; the current owner/recovery reconciles the run. A still-alive process tree prevents indexing and upload.

Before the first Storage mutation, the full manifest and every source file must match original sizes and SHA-256 hashes. Canonical real paths must remain inside the repository. The existing bucket must be verified private; immutable uploads use `upsert:false`, and retries accept an existing object only after downloaded bytes match. All Storage requests are bounded and guarded by current ownership. Failure does not claim that ephemeral source files are still available.

`publish_inssa_evidence` replaces the separate DELETE/INSERT requests with one service-role-only, security-invoker PostgreSQL transaction. It locks the run and execution record, verifies a live owner (or inactive historical terminal run), validates artifact/item/count/checksum identity, and upserts availability fields. Existing identities, bytes, retention classification and uploaded keys cannot be replaced or downgraded. There are no evidence DELETE statements. The HTTP client retries the same immutable payload once when an acknowledgement is lost. Storage transfer occurs outside the database transaction.

Real PostgreSQL tests inject failures before the first write and in the second item after bundle/first-item writes. Both roll back completely. Tests also cover repeated committed publication, count/checksum/key mismatches, metadata downgrade and public RPC denial. The CI platform job now includes this disposable PostgreSQL test, and the aggregate QA gate requires it.

## Historical evidence

The original **12 local-only failed bundles / 533 items / 344,429,165 declared bytes** were checked in the live target container. Every source file returned ENOENT: **recoverable 0, source bytes gone 12, backfilled 0**. No integrity or access error was misclassified as missing bytes. Per-bundle evidence is in `stabilization-wave-1-evidence-classification.json`.

The explicit reconciliation tool requires a bundle allowlist and defaults to dry run. It only handles inactive failed runs. Recoverable bytes are verified before upload. Missing source metadata is preserved with `upload_status=failed` and `upload_error=EVIDENCE_UNAVAILABLE_AFTER_EPHEMERAL_RUN` on the bundle and items, using the same atomic RPC. Existing durable evidence cannot be marked unavailable merely because local bytes disappeared. The classification was applied through the service-role RPC after the additive migration. All 12 bundles and 533 items now record this explicit state; read-back verification confirmed that every other metadata field, identity and checksum was preserved. No historical test was recreated and no object was invented.

## Hosted Safe investigation

Original scheduled run: `29ba5d74-400e-4e51-8c73-cb9210654416`, September 14 at 02:00 UTC / 03:00 Europe/Dublin. The error monitor observed the staging product reporting `FirebaseError: Document already exists` during **reach Media safely without publishing**. Austin used document `y9vsG9KrbxNLnLUT8NQ4`; Seattle on the serial-suite retry used **a different document**, `rQGEQKCzqFWecRzsmnE7`. The console source was the product bundle `main.1316cad5.js`. Request failures were also recorded during compose rendering and transition.

The repository's Safe tests navigate location-default routes and click the normal Next controls; they do not assign a Firestore document ID or type a fixed capsule identity. The public product bundle's save function updates when `draftId` is present and calls Firestore's generated-document creation path when absent. Thus the observed error is in the **staging product's capsule save/create path**, not a demonstrated fixed-identifier collision in this repository. Changing the location defaults or suppressing the error would weaken the test and is not justified.

Classification: **PRODUCT DEFECT observed; precise autosave/transport race remains unproven**. The old trace/source files and hosted auth cache are gone, so prior draft state and backend retry history cannot be reconstructed conclusively. No staging data is deleted and no product patch is claimed. The new Safe fixture regression supplies an offline seed through the actual Safe storage-state fixture and exercises two independent browser contexts, with local response interception, and proves browser local/session compose markers are not carried into the next execution. This does not claim to fix the product's Firestore behavior. All original Safe assertions are retained.

## Health and status semantics

`/api/health` now returns sanitized `web`, `supabase`, `worker`, `scheduler`, `evidenceProvider` and `platformInfrastructure` states. It preserves the HTTP 200/503 contract and existing metadata/supervisor fields. Worker and scheduler liveness comes from successful poll/lease-renewal or scheduler-evaluation checkpoints, bound to the current supervisor token and live process IDs. These are local file writes, throttled to at most one per 15 seconds. Worker polling interval and database heartbeat frequency are unchanged.

Metadata checks request at most one ID; the evidence check reads bucket privacy. Both have a 2-second deadline and share a coalesced 30-second cache. No credentials, internal paths, supervisor tokens, sessions or raw errors are returned. Stale-process checks are evaluated on each request. Provider monitor outcomes such as Google `blocked_external` and Apple `missing_configuration` are not inputs into infrastructure health. Existing monitor result labels remain truthful in their own UI.

## Release and verification

Use the dedicated stabilization branch and merge only after **QA Enforcement** and **Playwright QA** are green at the current head. The additive evidence RPC migration was applied to project `qdrhzdulhlkjhckosdrv` as version `20260914131916` before deployment. The repository filename matches that recorded remote migration version. Anonymous and authenticated roles cannot execute the function; the existing service role can. Only app `kbean-qa-webapp` (`25bef95b-e762-4675-b850-65794c62aa10`) is authorized for deployment.

After deployment: verify login and authenticated dashboard access; health; fresh hosted Safe; staging auth schedules at 12:00 and 18:00 Europe/Dublin; production auth disabled; private evidence retrieval; bundle/item/object consistency; and the 12 historical state updates. The controlled evidence fixture is explicitly marked expected-failure, writes run-owned JSON and an HTML report allowed by the existing authenticated report endpoint, makes zero product requests and is not exposed as a dashboard launch campaign. It can certify real failed-run → private Storage → atomic metadata → authenticated retrieval without damaging staging. Timed-out execution is validated by integration fixtures; hosted timeout certification is separate.

No worker/database optimization is claimed. No cleanup GET behavior, terminal polling, retention policy, outbox dispatch, logs, old runs, Storage objects, DNS, droplets or other DigitalOcean resources are changed. Retention remains a future dry-run phase with no authorized deletion.

## Local release gates

Root and dashboard TypeScript PASS; production build PASS (11.022s); Runtime Doctor PASS; platform PASS (8 root policy tests + 86 dashboard subsystem tests); security PASS (5 tests); Playwright QA PASS (15/15, 81.252s, including the original 10 Safe cases plus 2 new isolation cases); both production audits PASS with zero vulnerabilities; PostgreSQL publication fault tests PASS. These are focused Wave 1 measurements, not evidence of polling or database optimization. One initial fixture test exposed macOS temporary-directory alias handling; the fixture now resolves real paths and the complete platform suite passes. CI and hosted release verification are subsequent gates.

The first PR Playwright run exposed an unintended credential dependency in the new isolation fixture. The offline seed removes that dependency without skipping either regression; both cases pass with staging credentials explicitly absent (2/2, 1.2s), and root TypeScript passes. Existing authenticated CI skips are unchanged; full authenticated Safe coverage is validated locally and on the hosted worker.
