# INSSA-CLEANUP-001: Owner Delete Does Not Remove Time Capsule Draft

## Summary

The authenticated owner action labelled **Delete** on a staging capsule detail page does not delete the underlying `timeCapsules` object. Its confirmation dialog describes a message-removal operation, and the exact draft remains active after the action completes.

| Field | Value |
| --- | --- |
| Environment | `https://staging.inssa.us` |
| Account role | Primary QA owner |
| Run | `dd7b8a3d-7bcc-4409-8d3c-ef7a99ad70bb` |
| Object | `timeCapsules/Zd7QsNEJGbMXOSvAn3qc` |
| State | Draft; no recipients, media, or share token |
| Severity | High operational impact; no demonstrated confidentiality impact |
| Cleanup status | `cleanup_unavailable` (unresolved, safely represented in the deferred-cleanup ledger) |

## Reproduction

1. Authenticate as the exact staging object owner.
2. Open `/capsule/Zd7QsNEJGbMXOSvAn3qc` in a fresh browser context.
3. Verify the exact QA title and `Draft` state.
4. Open **More actions** and select **Delete**.
5. Observe the confirmation: `Delete message? This will remove the message for you, but keep it for other recipients.`
6. Confirm **Delete** once.
7. Open the same exact route in a fresh authenticated context.

## Expected

An owner control presented as deletion for a draft should either remove the underlying draft or clearly expose a separate owner-only draft deletion mechanism. A fresh server-backed lookup should no longer return an active object.

## Actual

The confirmation completed and Firestore write-channel requests returned HTTP `200`, but no hard-delete result was observed. A fresh authenticated direct-route load returned HTTP `200`, rendered the same exact draft, and generated Firestore read/listen requests targeting the exact document path. No success message proving object deletion was captured, and there is no evidence that the client deleted and later recreated the object.

## Classification

This is an **INSSA delete-product defect** and unresolved cleanup debt. It is not a missed confirmation, stale UI result, wrong-object selection, authentication failure, or failed HTTP write. The QA cleanup harness incorrectly treated a message-removal control as candidate object cleanup, but it correctly refused to infer deletion from the click. Deferred Cleanup Mode may account for this exact object without claiming deletion.

## Evidence

- `run-output/dd7b8a3d-7bcc-4409-8d3c-ef7a99ad70bb/cleanup-current-before.json`
- `run-output/dd7b8a3d-7bcc-4409-8d3c-ef7a99ad70bb/cleanup-current-before.png`
- `run-output/dd7b8a3d-7bcc-4409-8d3c-ef7a99ad70bb/cleanup-investigation.json`
- `run-output/dd7b8a3d-7bcc-4409-8d3c-ef7a99ad70bb/test-results/inssa-live-capsule-create--e772c-its-manual-cleanup-evidence-inssa-chrome/trace.zip`

## Authorized Manual Cleanup

An authorized staging data owner must:

1. Confirm the active project is staging.
2. Target only `timeCapsules/Zd7QsNEJGbMXOSvAn3qc`.
3. Capture a sanitized before-state.
4. Remove the exact object using an approved owner-side administrative mechanism.
5. Capture a sanitized server-backed after-state.
6. Confirm the owner UI no longer renders the exact ID in a fresh session.
7. Record approver, operator, method, timestamp, and verification evidence in the original cleanup manifest.

Do not retry the existing message-removal action. Do not delete by subject, broad query, or collection scan. Another governed staging mutation is allowed only while this exact record continues to pass every Deferred Cleanup Mode identity, ownership, sanitization, age, count, and daily-rate control.
