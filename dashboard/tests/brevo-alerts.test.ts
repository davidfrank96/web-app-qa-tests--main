import assert from "node:assert/strict";
import test from "node:test";
import { alertConfiguration, authAlertMessage, BrevoNotificationDispatcher, nextProductionCheck } from "../lib/inssa-ops/brevo-provider";
import { dispatchNotificationBatch } from "../lib/inssa-ops/notification-delivery";
import { productionAuthAlertDecision } from "../lib/monitoring/production-auth-alerts";
import type { NotificationOutboxRecord } from "../lib/inssa-ops/types";
import type { AuthenticationMonitoringSummary } from "../lib/monitoring/authentication-result";
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", QA_ALERT_EMAIL_ENABLED: "1", QA_ALERT_EMAIL_SENDER: "sender@example.com", QA_ALERT_EMAIL_RECIPIENTS: "dfrank@kbean.com,jboyaca@kbean", BREVO_API_KEY: "test-only-key", INSSA_OPS_METADATA_STORE: "supabase" };
const record = { id: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", campaignId: "monitor_inssa_auth_production", environment: "production", eventType: "production_auth_failed", createdAt: "2026-09-27T11:16:00Z", payload: { classification: "TIMEOUT", password: "must-never-appear", error: "private log" } } as unknown as NotificationOutboxRecord;
test("Brevo config isolates malformed recipient and never returns key", () => {
  const config = alertConfiguration(env);
  assert.deepEqual(config.recipients, ["dfrank@kbean.com"]);
  assert.deepEqual(config.invalidRecipients, ["jboyaca@kbean"]);
  assert.equal(config.configured, true);
  assert.ok(!JSON.stringify(config).includes(env.BREVO_API_KEY!));
  assert.equal(alertConfiguration({ ...env, BREVO_API_KEY: "" }).configured, false);
});
test("alert body is bounded safe data with authenticated evidence link and DST schedule", () => {
  const body = authAlertMessage(record);
  assert.match(body.subject, /CRITICAL/); assert.match(body.textContent, /TIMEOUT/);
  assert.match(body.textContent, /\/api\/runs\/[a-f0-9-]+\/evidence/);
  assert.doesNotMatch(body.textContent, /must-never-appear|private log/);
  assert.match(nextProductionCheck(new Date("2026-12-14T11:00Z")), /2026-12-14T12:15/);
  assert.match(nextProductionCheck(new Date("2026-08-14T10:00Z")), /2026-08-14T11:15/);
  assert.throws(() => authAlertMessage({ ...record, environment: "staging" }));
  assert.throws(() => authAlertMessage({ ...record, eventType: "run_completed" }));
});
test("Brevo uses verified sender, stable idempotency key and exact valid recipients", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.endsWith("senders") ? { senders: [{ email: env.QA_ALERT_EMAIL_SENDER, active: true }] } : { messageIds: ["<synthetic@example.com>"] }), { status: url.endsWith("senders") ? 200 : 201 });
  }) as typeof fetch;
  const result = await new BrevoNotificationDispatcher(env, fake).deliver(record);
  assert.equal(result.providerMessageId, "<synthetic@example.com>");
  const body = JSON.parse(String(calls[1].init.body));
  assert.equal(body.headers.idempotencyKey, record.id);
  assert.deepEqual(body.messageVersions, [{ to: [{ email: "dfrank@kbean.com" }] }]);
  assert.equal(calls[1].init.redirect, "error");
});
test("unverified sender stops delivery; transient provider failure is sanitized", async () => {
  let calls = 0;
  await assert.rejects(new BrevoNotificationDispatcher(env, (async () => { calls++; return new Response('{"senders":[]}'); }) as typeof fetch).deliver(record), /VERIFIED SENDER REQUIRED/);
  assert.equal(calls, 1);
  let available = true, failed = "";
  const lifecycle = { claimPending: async () => { const result = available ? [record] : []; available = false; return result; }, markFailed: async (_id: string, error: string) => { failed = error; }, markDeadLetter: async () => assert.fail(), markDelivered: async () => assert.fail() };
  const result = await dispatchNotificationBatch(lifecycle, { provider: "brevo", deliver: async () => { throw new Error("secret key and private logs"); } });
  assert.equal(result.failed, 1); assert.equal(failed, "Notification provider failed");
});
test("production failures are classified independently of disabled OAuth and delivery", () => {
  const summary = { environment: "production", targetHost: "inssa.us", checks: { "username-password": { status: "passed" }, "google-oauth": { status: "disabled" }, "apple-sign-in": { status: "disabled" } } } as AuthenticationMonitoringSummary;
  assert.equal(productionAuthAlertDecision("passed", summary).passed, true);
  assert.equal(productionAuthAlertDecision("timed_out", summary).classification, "TIMEOUT");
  assert.equal(productionAuthAlertDecision("failed", null).classification, "MONITOR_INFRASTRUCTURE_FAILURE");
  summary.checks["username-password"].status = "failed";
  summary.checks["username-password"].error = "Invalid credential";
  assert.equal(productionAuthAlertDecision("failed", summary).classification, "AUTHENTICATION_REJECTED");
});
