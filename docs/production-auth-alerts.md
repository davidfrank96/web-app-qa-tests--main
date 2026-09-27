# Production authentication and Brevo alerts

Production checks use only the dedicated password account at `https://inssa.us`.
Google and Apple remain disabled. Staging retains its existing credentials, providers,
and 12:00/18:00 Europe/Dublin schedules. Production uses the existing definition IDs
at 12:15/18:15 and stays disabled until a manual production PASS is certified.

Production logout uses the application's existing offline UI path: load the profile
online, temporarily take only the isolated monitor browser offline, click Sign Out,
verify Firebase persisted authentication is cleared, reconnect, and load the sign-in
form in a fresh document. INSSA's online logout waits for an FCM-token Firestore write;
that write is outside this monitor's no-mutation scope and remains blocked. The monitor
does not clear storage or call Firebase signOut itself. This certifies login/session
and offline UI logout cleanup, not the application's online notification-token cleanup.

Blocked automatic background requests remain blocked and are recorded as isolation
evidence rather than authentication failures. Compact PASS evidence retains the logout
mode and blocked-request count. Staging's existing provider and logout behavior is unchanged.

## Configuration

All local processes load `dashboard/.env.local` through the existing `@next/env`
configuration. Keep that file ignored and mode 0600. Configure the same variables in
the authorized QA app; credential values must be encrypted DigitalOcean secrets.

- `AUTH_MONITOR_PRODUCTION_EMAIL`, `AUTH_MONITOR_PRODUCTION_PASSWORD`
- `AUTH_MONITOR_ALLOW_PRODUCTION=1` only after the target safety gate passes
- `AUTH_MONITOR_PRODUCTION_CONFIRMATION=inssa.us`
- `AUTH_MONITOR_PRODUCTION_METHODS=username-password`
- `BREVO_API_KEY`
- `QA_ALERT_EMAIL_SENDER`: an existing verified Brevo sender
- `QA_ALERT_EMAIL_RECIPIENTS`: comma-separated exact approved addresses
- `QA_ALERT_EMAIL_ENABLED=1` when delivery is ready

Invalid recipients remain visible as pending correction and are excluded from sends.
Never infer a missing domain. Use the Brevo transactional API; no contact lists or
marketing campaigns are required. The provider rechecks sender verification before sending.

## Durable delivery

A database trigger writes one internal observation alongside each terminal production
result. The existing worker evaluates the trusted structured result and opens or closes
the incident. The first failure queues an email; repeated manual failures are suppressed.
A later scheduled failure can queue one reminder. A recovery after a confirmed alert
queues exactly one recovery message. Success and disabled providers do not send email.

The dispatcher uses one global 60-second delivery lease, claim-token fencing, and the
notification UUID as Brevo's idempotency key. It retries at five and ten minutes, at most
three attempts and within 25 minutes, below Brevo's 30-minute idempotency lifetime.
Permanent failures and exhausted retries become dead letters. A provider acceptance whose
acknowledgment is lost retains the same idempotency key. Recovery does not cancel an
ambiguous previously attempted delivery. Authentication results never depend on Brevo.

The worker dispatches immediately after completion and checks durable retries every five
minutes. There is no additional service or hot poll. Email health is reported separately
in the authenticated Notification Outbox workspace. Secrets and raw provider errors are
never included in the outbox or email bodies.

## Rollout

Apply `20260927095626_production_auth_brevo_alerts.sql` to the QA project only after
review and required CI. Deploy main to `kbean-qa-webapp` after QA Enforcement and
Playwright QA pass. The migration changes only the existing production schedules and
leaves them disabled.

From `dashboard`, with approved credentials configured:

```sh
node --import tsx scripts/production-auth-rollout.ts test-alert --confirm-send-test
```

This creates a synthetic outbox event with a stable rollout deduplication key. Repeating
the command does not resend an already delivered test. Verify Brevo acceptance and the
outbox message ID, then perform exactly one manual production authentication run.
Never submit incorrect passwords to test alerting.

After its password check passes, OAuth providers are disabled, and uploaded evidence
is retrievable:

```sh
node --import tsx scripts/production-auth-rollout.ts enable-schedules RUN_ID --confirm-enable
```

The CLI checks structured provider evidence and the service RPC independently requires
a manual passing production run with uploaded evidence. Activation sets a timestamp
boundary; historical occurrences cannot launch. Repeated activation does not reset it.

Clean passes retain compact investigation evidence. Production failures retain sanitized
JSON/HTML, network metadata, console diagnostics and masked screenshots. Raw Playwright
traces and video are disabled for production to prevent credential input capture. Existing
30/60/90-day retention policies are unchanged.
