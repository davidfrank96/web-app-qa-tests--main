import type { NotificationDispatcher } from "./notification-dispatcher";
import type { NotificationOutboxRecord } from "./types";

export const AUTH_ALERT_EVENTS = new Set(["production_auth_failed", "production_auth_recovered", "production_auth_test"]);
export const AUTH_FAILURE_CLASSES = new Set(["PRODUCTION_UNREACHABLE", "LOGIN_PAGE_UNAVAILABLE", "AUTHENTICATION_REJECTED",
  "SESSION_NOT_ESTABLISHED", "AUTHENTICATED_STATE_NOT_REACHED", "TIMEOUT", "MONITOR_INFRASTRUCTURE_FAILURE", "UNKNOWN_AUTH_FAILURE"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validAlertEmail(value: string) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value) && value.length <= 254;
}
export function alertConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const requested = [...new Set((env.QA_ALERT_EMAIL_RECIPIENTS ?? "").split(",").map(v => v.trim()).filter(Boolean))];
  const recipients = requested.filter(validAlertEmail);
  const invalidRecipients = requested.filter(v => !validAlertEmail(v));
  const sender = env.QA_ALERT_EMAIL_SENDER?.trim() ?? "";
  return { enabled: env.QA_ALERT_EMAIL_ENABLED === "1", sender, recipients, invalidRecipients,
    configured: Boolean(env.BREVO_API_KEY?.trim() && validAlertEmail(sender) && recipients.length &&
      env.INSSA_OPS_METADATA_STORE === "supabase"),
    // Never return the API key from this configuration/status object.
  };
}

export function authAlertMessage(notification: NotificationOutboxRecord) {
  if (!AUTH_ALERT_EVENTS.has(notification.eventType) || notification.environment !== "production" ||
      notification.campaignId !== "monitor_inssa_auth_production" || !UUID.test(notification.id)) throw new Error("Unsupported alert notification");
  const test = notification.eventType === "production_auth_test", recovered = notification.eventType === "production_auth_recovered";
  const classification = AUTH_FAILURE_CLASSES.has(String(notification.payload.classification)) ? String(notification.payload.classification) : "UNKNOWN_AUTH_FAILURE";
  const detected = new Date(typeof notification.payload.detectedAt === "string" ? notification.payload.detectedAt : notification.createdAt);
  if (!Number.isFinite(detected.getTime())) throw new Error("Invalid alert timestamp");
  const detectedAt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", dateStyle: "medium", timeStyle: "long" }).format(detected);
  const runId = notification.runId && UUID.test(notification.runId) ? notification.runId : null;
  const duration = typeof notification.payload.durationMs === "number" && Number.isFinite(notification.payload.durationMs)
    ? `${Math.max(0, notification.payload.durationMs) / 1000}s` : "Unavailable";
  const subject = test ? "[TEST] INSSA Production Authentication Alert Pipeline" : recovered
    ? "[RECOVERED] INSSA Production Authentication Restored" : "[CRITICAL] INSSA Production Authentication Failure";
  const summary = test ? "Synthetic pipeline test. This message does not represent a production authentication failure."
    : recovered ? "Production username/password authentication and session verification have recovered."
    : "Production authentication monitoring detected that the approved QA account could not complete the expected login/session verification flow.";
  // Only typed, bounded fields are included. Never serialize provider errors, test logs or arbitrary payload text.
  const textContent = [`Environment: Production`, `Target: https://inssa.us`, `Provider: Username & Password`,
    `Status: ${test ? "TEST" : recovered ? "RECOVERED" : classification === "TIMEOUT" ? "TIMEOUT" : "FAILED"}`,
    `Failure classification: ${test || recovered ? "NONE" : classification}`, `Detected at: ${detectedAt} (Europe/Dublin)`,
    `Run ID: ${runId ?? "Synthetic test — no production run"}`, `Duration: ${duration}`, `Summary: ${summary}`,
    `Evidence: ${runId ? `https://kbean-qa-webapp-2ok9x.ondigitalocean.app/api/runs/${runId}/evidence` : "Not applicable"}`,
    `Next scheduled check: ${nextProductionCheck(detected)}`].join("\n");
  return { subject, textContent };
}

export function nextProductionCheck(after: Date) {
  // Scan UTC minutes so Dublin DST transitions are handled without a fixed offset.
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let minute = 1; minute <= 26 * 60; minute++) {
    const candidate = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + minute * 60_000);
    if (["12:15", "18:15"].includes(formatter.format(candidate))) return `${candidate.toISOString()} (12:15/18:15 Europe/Dublin schedule; subject to enablement)`;
  }
  throw new Error("Unable to resolve next production check");
}

export class BrevoDeliveryError extends Error {
  constructor(message: string, readonly permanent = false) { super(message); }
}
export class BrevoNotificationDispatcher implements NotificationDispatcher {
  readonly provider = "brevo";
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly fetcher: typeof fetch = fetch) {}
  async deliver(notification: NotificationOutboxRecord) {
    const config = alertConfiguration(this.env);
    if (!config.enabled || !config.configured) throw new BrevoDeliveryError("Brevo delivery configuration unavailable", true);
    const message = authAlertMessage(notification);
    const headers = { "api-key": this.env.BREVO_API_KEY!, "content-type": "application/json", accept: "application/json" };
    let response: Response;
    try {
      const senders = await this.fetcher("https://api.brevo.com/v3/senders", { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!senders.ok) throw new BrevoDeliveryError(`Brevo sender verification HTTP ${senders.status}`, senders.status >= 400 && senders.status < 500 && senders.status !== 429);
      const data = await senders.json() as { senders?: Array<{ email: string; active: boolean }> };
      if (!data.senders?.some(sender => sender.email === config.sender && sender.active === true)) throw new BrevoDeliveryError("BREVO VERIFIED SENDER REQUIRED", true);
      response = await this.fetcher("https://api.brevo.com/v3/smtp/email", { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ ...message, sender: { email: config.sender, name: "KBean QA Operations" },
          messageVersions: [{ to: config.recipients.map(email => ({ email })) }], headers: { idempotencyKey: notification.id }, tags: ["inssa-production-auth"] }) });
    } catch (error) {
      if (error instanceof BrevoDeliveryError) throw error;
      throw new BrevoDeliveryError("Brevo network request failed or timed out");
    }
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string; messageId?: string; messageIds?: string[] };
    if (!response.ok) {
      if (body.code === "duplicate_parameter" && /idempoten/i.test(body.message ?? "")) {
        return { deliveredAt: new Date().toISOString(), providerMessageId: `idempotency-confirmed:${notification.id}` };
      }
      throw new BrevoDeliveryError(`Brevo delivery HTTP ${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 429);
    }
    const messageId = body.messageId ?? body.messageIds?.[0];
    if (typeof messageId !== "string" || !/^<?[A-Za-z0-9@._+-]{1,250}>?$/.test(messageId)) throw new BrevoDeliveryError("Brevo acceptance ID unavailable");
    return { deliveredAt: new Date().toISOString(), providerMessageId: messageId };
  }
}
