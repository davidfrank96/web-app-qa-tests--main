# Staging manual cleanup mode

Set server-only `INSSA_MANUAL_CLEANUP_MODE=1` on the QA app to make cleanup backlog advisory for registered governed mutations targeting exactly `https://staging.inssa.us` (optional trailing slash). Default/off restores normal cleanup enforcement. This flag does not itself enable staging mutation or authorize production mutation.

All six mutation campaigns share the policy. Historical unknown identities, cleanup state, missing ledger entries, age, unresolved count, disabled deferred mode and cleanup-oriented daily usage limits become advisories. Dedicated account requirements, non-QA ownership, missing sanitization evidence and unexpected data still block. Admin authorization, approval, acknowledgement phrase, registered command, feature flags, worker health, active-execution exclusion, credentials, account separation, fixture, output storage and Resume-artifact checks remain mandatory.

No INSSA objects are deleted or automatically marked completed. Ledger identity, ownership, recipients, age, retention, evidence and historical states remain intact. Publication adds new discoveries without erasing earlier IDs or reopening confirmed resolutions. Paginated ledger reads retain large backlogs. Durable run manifests preserve unknown identities across deploys.

Functional process exit remains authoritative: success with manual cleanup is `passed_with_warnings`; real functional failure stays failed. Unknown identity is prominently recorded as `MANUAL_CLEANUP_IDENTITY_UNKNOWN`, without claiming safe accounting. Functional assertions requiring identity still fail truthfully while the next unrelated staging test can pass preflight.

Readiness is `READY_WITH_MANUAL_CLEANUP` for campaigns with execution history; no history remains `NOT_YET_VALIDATED`. Last functional result is separate. The UI lists every campaign's object, originating run, owner, age, deadline and status. Backlog bands (0–25 normal, 26–50 warning, 51+ high) are advisory.

**Run Preflight Only** checks prerequisites without creating a job. **Run Staging Mutation** still rechecks on the server before enqueue. The existing atomic single-active execution mechanism and no-retry final-action rule are unchanged.

After independently deleting an object in INSSA staging, an admin may choose **Confirm deleted object**, type `DELETED FROM INSSA STAGING`, and supply an optional note. The server checks exact ledger/object/run identity and active-run state, durably audits operator/time/note, then updates that existing record. No product deletion request occurs. Run-wide confirmation requires known ledger identities and explicit confirmation that every run object was removed. Neither evidence nor historical functional results are rewritten.

Authentication monitoring, credentials, providers, schedules and Brevo settings are unchanged. No schema migration is required. Disable the flag to restore normal cleanup enforcement when supported automatic cleanup becomes available.
