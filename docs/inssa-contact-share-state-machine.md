# INSSA Contact Share State Machine

## Scope

This note documents the Phase 6 cross-user security validation diagnostic for the current INSSA staging contact-selection share flow.

- Environment: `https://staging.inssa.us`
- Diagnostic spec: `tests/inssa/contact-share-state-machine.spec.ts`
- Live mutation gates:
  - `INSSA_ENABLE_LIVE_CAPSULE_TESTS=1`
  - `INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED=1`
  - `INSSA_ENABLE_CONTACT_SHARE_DIAGNOSTIC=1`

## Current Lifecycle

Observed staging flow:

```text
Compose
-> Media
-> Share
-> Bury
-> Reveal settings
-> Reveal now
-> Continue
-> Send or save
-> Contact selection
-> Bury, then choose who to share with
-> Share/success surface
```

## Confirmed Step 2 UI

The current Step 2 contact/share UI is no longer the older `Skip contacts & share link with others` flow.

Observed controls:

- Title: `Send or save`
- Step label: `0 selected · Step 2 of 2`
- Search input: `Search by name or email`
- Contact loading/empty state can appear briefly:
  - `No saved contacts yet`
  - `Loading connections...`
- Loaded contact state:
  - `0 of 3 contacts selected`
  - `Select all`
  - Contact rows
  - `Bury, then choose who to share with`
  - `Back`

## Diagnostic Run Evidence

Latest completed diagnostic artifact:

- Artifact: `lifecycle-artifacts/0d877454785d-496a94e325-contact-share-state-machine.json`
- Run ID: `0d877454785d-496a94e325`
- Subject: `QA_LIVE_CAPSULE_0d877454785d-496a94e325_20260605T113322Z`
- Final URL: `https://staging.inssa.us/timecapsule?lat=53.3382&lng=-6.2591&address=8PQR%2B79%20Dublin%2C%20County%20Dublin%2C%20Ireland&place=&placeId=`
- Capsule ID captured: none
- Share token captured: none
- Final share link captured: none
- Success signals:
  - `share-link-button-visible`
  - `home-button-visible`
  - `visible-success=success`

Screenshots:

- Before contact selection: `lifecycle-artifacts/0d877454785d-496a94e325-contact-step-before-selection.png`
- After attempted contact selection: `lifecycle-artifacts/0d877454785d-496a94e325-contact-step-after-selection.png`
- After final contact-share action: `lifecycle-artifacts/0d877454785d-496a94e325-contact-step-after-final-click.png`

## Important Diagnostic Caveat

The completed run did not actually select a real contact.

The harness clicked the transient `No saved contacts yet` empty-state text before the contact list finished loading. After that, the contact list loaded, but selected count remained:

```text
0 selected · Step 2 of 2
0 of 3 contacts selected
```

The final action `Bury, then choose who to share with` was still enabled and was clicked once. The app then exposed success/share controls.

Because this likely created a staging capsule, the diagnostic was not rerun.

## Current Findings

- Contact-selection step detection is confirmed.
- The old skip-link button is not visible in the current UI.
- The new final action is `Bury, then choose who to share with`.
- The final action appears enabled even when selected contact count is `0`.
- Share/success controls can appear after clicking the final action with `0` selected.
- Route may remain on `/timecapsule` after success.
- Share-link UI can be visible without the harness extracting a concrete `/capsule/...` URL or token.
- OS/native share-sheet behavior was not directly observable in headless Playwright.

## Open Questions

- Whether selecting exactly one contact changes the selected count to `1 selected`.
- Whether selecting exactly one contact changes the final action label or enables additional controls.
- Whether selecting exactly one contact produces a tokenized share link.
- Whether the selected contact immediately receives or can retrieve the capsule.
- Whether the share sheet is a browser/OS-native surface that Playwright cannot observe directly.

## Harness Update

The diagnostic helper now waits for a real contact list and requires selected count to become `1` before clicking the Step 2 final action.

This prevents future runs from finalizing while the contact list is still in the transient `No saved contacts yet` / `Loading connections...` state.

## Cleanup Target

Development should manually inspect and delete the possible staging capsule created by this diagnostic:

- Run ID: `0d877454785d-496a94e325`
- Subject: `QA_LIVE_CAPSULE_0d877454785d-496a94e325_20260605T113322Z`
- Message marker: `qa_live_capsule`
- Created at: `2026-06-05T11:33:22.941Z`

No capsule ID or share token was captured, so cleanup should search staging by exact subject/run ID.

## Recommended Cross-User Campaign Update

Do not use the old `Skip contacts & share link with others` assumption.

Next controlled cross-user validation should:

1. Reach `Send or save`.
2. Wait until `0 of N contacts selected` is visible.
3. Select exactly one known QA secondary contact.
4. Assert selected count becomes `1`.
5. Click `Bury, then choose who to share with` once.
6. Capture share/success controls, URL, token, capsule ID, and screenshots.
7. Use the secondary QA user to verify direct, tokenized, tokenless, feed, search, profile/history, and messages visibility.

Do not rerun contact-share finalization until the possible capsule above is reviewed or cleanup is coordinated.

## Phase 6B Cross-User Delivery Result

Phase 6B used the corrected one-contact flow and targeted the configured secondary QA account.

Observed one-contact flow:

```text
Send or save
0 selected · Step 2 of 2
select secondary QA contact
1 selected · Step 2 of 2
Bury, send to 1 contact, then share more
success/share surface
```

Latest Phase 6B artifact:

- Cross-user summary: `security-campaigns/cross-user/latest-cross-user-verification.json`
- Cross-user report: `reports/security/cross-user-security.html`
- Creation artifact: `lifecycle-artifacts/0d877454785d-c98ca92b0e-contact-share-state-machine.json`
- Run ID: `0d877454785d-c98ca92b0e`
- Subject: `QA_LIVE_CAPSULE_0d877454785d-c98ca92b0e_20260605T114055Z`
- Selected contact target: secondary QA account, masked in artifacts
- Selected count before: `0`
- Selected count after: `1`
- Final button: `Bury, send to 1 contact, then share more`

User B verification:

- Messages: subject and message visible
- Feed: not visible
- Search: not visible
- Profile/history: not visible
- Direct capsule route: not available because no capsule ID was captured
- Tokenized route: not available because no tokenized URL was captured
- Tokenless route: not available because no capsule ID/share URL was captured
- Media: not applicable for text-only capsule

Classification:

- Isolation: `expected-share-access`
- Surface access: `targeted-contact-surface-visible`
- Route access: `isolated`
- Media: `media-not-observed`
- Risk: `Informational`

Cleanup target:

- Development should manually delete the staging capsule by exact subject/run ID:
  `QA_LIVE_CAPSULE_0d877454785d-c98ca92b0e_20260605T114055Z`
