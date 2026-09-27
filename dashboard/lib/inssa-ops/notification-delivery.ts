import { alertConfiguration, BrevoDeliveryError, BrevoNotificationDispatcher } from "./brevo-provider";
import type { NotificationDispatcher, NotificationDispatcherLifecycle, NotificationDispatchResult } from "./notification-dispatcher";
import { notificationFromSupabaseRecord } from "./notification-outbox";

export const NOTIFICATION_RETRY_POLL_MS = 5 * 60_000;
export async function notificationRpc<T>(name: string, input: Record<string, unknown>): Promise<T> {
  if (process.env.INSSA_OPS_METADATA_STORE !== "supabase" || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) {
    throw new Error("Durable alert delivery requires the configured Supabase service backend");
  }
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(10_000), headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(`Notification persistence HTTP ${response.status}`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export class SupabaseNotificationDelivery implements NotificationDispatcherLifecycle {
  private readonly tokens = new Map<string, string>();
  async claimPending(_limit: number) {
    const token = crypto.randomUUID();
    const row = await notificationRpc<Record<string, unknown> | null>("claim_brevo_notification", { p_token: token });
    if (!row) return [];
    const notification = notificationFromSupabaseRecord(row);
    this.tokens.set(notification.id, token);
    return [notification];
  }
  async markDelivered(id: string, result: NotificationDispatchResult) { await this.finish(id, result.providerMessageId, null, false); }
  async markFailed(id: string, message: string) { await this.finish(id, null, message, false); }
  async markDeadLetter(id: string, message: string) { await this.finish(id, null, message, true); }
  private async finish(id: string, messageId: string | null, error: string | null, permanent: boolean) {
    const token = this.tokens.get(id);
    if (!token) throw new Error("Notification claim token missing");
    await notificationRpc("finish_brevo_notification", { p_id: id, p_token: token, p_message_id: messageId, p_error: error, p_permanent: permanent });
    this.tokens.delete(id);
  }
}

export async function dispatchNotificationBatch(lifecycle: NotificationDispatcherLifecycle, dispatcher: NotificationDispatcher) {
  let delivered = 0, failed = 0;
  for (let count = 0; count < 5; count++) {
    const [notification] = await lifecycle.claimPending(1);
    if (!notification) break;
    if (notification.eventType === "production_auth_observation") {
      if (!notification.runId) throw new Error("Authentication observation requires a run");
      const { getInssaRunStore } = await import("./run-store");
      const { recordProductionAuthAlert } = await import("../monitoring/production-auth-alerts");
      const run = await getInssaRunStore().getRun(notification.runId);
      if (!run) throw new Error("Authentication observation run unavailable");
      await recordProductionAuthAlert(run.id, run.status);
      await lifecycle.markDelivered(notification.id, { deliveredAt: new Date().toISOString(), providerMessageId: "internal:incident-evaluated" });
      continue;
    }
    let result: NotificationDispatchResult;
    try { result = await dispatcher.deliver(notification); }
    catch (error) {
      // Raw fetch/provider exception text must never reach the outbox or process logs.
      const safe = error instanceof BrevoDeliveryError ? error.message : "Notification provider failed";
      if (error instanceof BrevoDeliveryError && error.permanent) await lifecycle.markDeadLetter(notification.id, safe);
      else await lifecycle.markFailed(notification.id, safe);
      failed++;
      continue;
    }
    // If acknowledgement persistence fails, retain the lease and the same provider idempotency key.
    await lifecycle.markDelivered(notification.id, result);
    delivered++;
  }
  return { delivered, failed };
}

let requestDispatch: (() => void) | null = null;
export function requestNotificationDispatch() { requestDispatch?.(); }
export function startNotificationDelivery() {
  const config = alertConfiguration();
  if (!config.enabled || !config.configured) return () => {};
  const lifecycle = new SupabaseNotificationDelivery(), dispatcher = new BrevoNotificationDispatcher();
  let running = false, stopped = false;
  const pump = () => {
    if (running || stopped) return;
    running = true;
    void dispatchNotificationBatch(lifecycle, dispatcher).catch(() => {
      process.stderr.write("Notification delivery unavailable; durable retry state retained.\n");
    }).finally(() => { running = false; });
  };
  requestDispatch = pump;
  const timer = setInterval(pump, NOTIFICATION_RETRY_POLL_MS);
  timer.unref();
  pump();
  return () => { stopped = true; clearInterval(timer); requestDispatch = null; };
}
