# INSSA SIEM Finding Runbook

This runbook defines response procedures for INSSA QA findings emitted into Wazuh.

Severity handling:

| Severity | Operational Action |
| --- | --- |
| Critical | Immediate security escalation. |
| High | Create security or engineering ticket the same business day. |
| Medium | Track on dashboard and review during weekly security triage. |
| Informational | Retain as expected behavior evidence. |

## `public-by-id`

Description:

```text
A capsule can be accessed through a tokenless capsule route that contains only the capsule document identifier.
```

Risk:

```text
High when capsule IDs expose user-authored content without token or authorization.
```

Validation steps:

```bash
npm run test:inssa:campaign:security:verify
```

Manual validation:

```text
Open the tokenized capsule URL in a clean browser.
Open the same URL with the token query removed.
Compare subject, message, media, and visibility.
```

Escalation path:

```text
Security lead -> INSSA engineering owner -> Product owner for lifecycle visibility.
```

Resolution guidance:

```text
Require token, authenticated authorization, or intentional public visibility policy before returning capsule content by ID.
```

## `media-publicly-accessible`

Description:

```text
Uploaded media or video URLs are retrievable without expected token or authentication controls.
```

Risk:

```text
High when private or targeted capsule media can be fetched directly from storage/CDN URLs.
```

Validation steps:

```bash
npm run test:inssa:campaign:security:verify
```

Manual validation:

```text
Use a known QA media artifact.
Open media URL in authenticated browser.
Open media URL in logged-out browser.
Open media URL in clean browser.
Record whether bytes are returned and whether content is visible.
```

Escalation path:

```text
Security lead -> Backend/storage owner -> INSSA engineering owner.
```

Resolution guidance:

```text
Use signed URLs with expiry, authenticated proxy retrieval, or storage rules aligned to capsule visibility policy.
```

## `unauthorized-visible`

Description:

```text
Content is visible to a user who should not have access under the expected lifecycle or sharing policy.
```

Risk:

```text
Critical when cross-user isolation is violated or private lifecycle content is exposed.
```

Validation steps:

```bash
npm run test:inssa:campaign:cross-user
```

Manual validation:

```text
User A creates a QA-tagged capsule.
User B attempts tokenized, tokenless, direct, feed, search, messages, and profile/history access.
Record exact visibility and route.
```

Escalation path:

```text
Security incident channel -> Security lead -> INSSA engineering owner -> Backend authorization owner.
```

Resolution guidance:

```text
Enforce owner, recipient, token, and reveal-state checks server-side for every retrieval route and media URL.
```

## `authentication-bypass`

Description:

```text
An authenticated-only route or action is accessible without a valid authenticated session.
```

Risk:

```text
Critical when protected account, settings, message, or lifecycle surfaces are available logged out.
```

Validation steps:

```bash
npm run test:inssa:campaign:security
```

Manual validation:

```text
Use clean browser context.
Navigate to /me, /settings, /messages, /profile/connections, and known direct capsule routes.
Confirm redirect, block, or partial access behavior.
```

Escalation path:

```text
Security incident channel -> Authentication owner -> INSSA engineering owner.
```

Resolution guidance:

```text
Add route guards and server-side authorization checks. Client-side redirects alone are not sufficient.
```

## `reveal-protected`

Description:

```text
Reveal-later content remains inaccessible before its scheduled reveal time.
```

Risk:

```text
Informational. This is expected positive evidence unless paired with an access bypass finding.
```

Validation steps:

```bash
npm run test:inssa:campaign:reveal-later
```

Manual validation:

```text
Use a reveal-later artifact with scheduledAtIso populated.
Probe authenticated, tokenized, tokenless, feed, search, messages, and profile/history routes before reveal time.
Repeat after reveal time.
```

Escalation path:

```text
QA owner -> Product owner for lifecycle semantics.
```

Resolution guidance:

```text
Retain evidence. If the classification changes to reveal-accessible-early, escalate as high or critical depending on content exposure.
```

## `share-link-only-visibility`

Description:

```text
A capsule is retrievable by direct share link but is not indexed in feed, search, messages, or profile/history.
```

Risk:

```text
Medium as a product visibility finding. It is not automatically a security failure when direct retrieval works and indexing is intentionally limited.
```

Validation steps:

```bash
npm run test:inssa:campaign:text
```

Manual validation:

```text
Open the final share link.
Open authenticated direct route.
Check home feed, search, messages, and profile/history.
Record whether subject and message are visible.
```

Escalation path:

```text
QA owner -> Product owner -> INSSA engineering owner.
```

Resolution guidance:

```text
Confirm intended product semantics. If feed indexing is required, create a product bug. If share-link-only visibility is intended, document policy.
```

## `token-optional`

Description:

```text
A capsule route remains accessible after removing the token query value.
```

Risk:

```text
Medium by default. Increase to high if tokenless access exposes private, targeted, reveal-later, or media content.
```

Validation steps:

```bash
npm run test:inssa:campaign:security:verify
```

Manual validation:

```text
Open tokenized route.
Remove token query.
Open tokenless route in authenticated, logged-out, and clean contexts.
Compare content visibility.
```

Escalation path:

```text
Security lead -> INSSA engineering owner -> Backend authorization owner.
```

Resolution guidance:

```text
Clarify whether capsule IDs are intended public identifiers. If tokens are meant to gate access, enforce token checks server-side.
```

## Evidence Required For Any Escalation

Include:

- Wazuh event timestamp.
- Classification.
- Severity.
- Campaign name.
- Run ID.
- Artifact path.
- Report path.
- Affected route.
- Screenshot or report evidence from the QA artifact bundle, not uploaded to SIEM.
- Manual cleanup target when a staging capsule was created.
