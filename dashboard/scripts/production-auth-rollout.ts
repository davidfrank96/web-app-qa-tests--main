import { loadEnvConfig } from "@next/env";
import { alertConfiguration } from "../lib/inssa-ops/brevo-provider";
import { getNotificationOutboxStore } from "../lib/inssa-ops/notification-outbox";
import { BrevoNotificationDispatcher } from "../lib/inssa-ops/brevo-provider";
import { SupabaseNotificationDelivery, dispatchNotificationBatch, notificationRpc } from "../lib/inssa-ops/notification-delivery";
import { loadAuthenticationMonitoringResult } from "../lib/monitoring/authentication-result-store";
import { getInssaRunStore } from "../lib/inssa-ops/run-store";
loadEnvConfig(process.cwd(), true);

async function main() {
  const command = process.argv[2];
  if (command === "test-alert") {
    if (!process.argv.includes("--confirm-send-test")) throw new Error("Explicit --confirm-send-test required");
    const config = alertConfiguration();
    if (!config.enabled || !config.configured) throw new Error("Alert configuration incomplete or disabled");
    // Stable rollout key makes rerunning the command safe; a delivered test is never re-enqueued.
    const result = await getNotificationOutboxStore().create({ campaignId: "monitor_inssa_auth_production", correlationId: "production-auth-brevo-rollout-test-v1",
      deduplicationKey: "production-auth-brevo-rollout-test-v1", environment: "production", eventType: "production_auth_test",
      message: "Synthetic alert pipeline verification; no production authentication failure.", payload: {}, product: "INSSA",
      runId: null, severity: "informational", title: "TEST: Production authentication alert pipeline" });
    await dispatchNotificationBatch(new SupabaseNotificationDelivery(), new BrevoNotificationDispatcher());
    const record = await getNotificationOutboxStore().get(result.notification.id);
    console.log(JSON.stringify({ notificationId: record?.id, status: record?.status, providerMessageId: record?.providerMessageId,
      pendingRecipientCount: config.invalidRecipients.length }));
    if (record?.status !== "delivered") process.exitCode = 1;
  } else if (command === "enable-schedules") {
    const runId = process.argv[3];
    if (!runId || !process.argv.includes("--confirm-enable")) throw new Error("Manual passing run ID and --confirm-enable required");
    const store = getInssaRunStore(), run = await store.getRun(runId);
    const result = await loadAuthenticationMonitoringResult(store, runId);
    if (!run || !result || run.campaignKey !== "monitor_inssa_auth_production" || run.status !== "passed" || run.requestedBy.startsWith("scheduler:") ||
      result.evidence.uploadStatus !== "uploaded" || result.result?.checks["username-password"].status !== "passed" ||
      result.result.checks["google-oauth"].status !== "disabled" || result.result.checks["apple-sign-in"].status !== "disabled") {
      throw new Error("Schedule activation requires a manual production password PASS with uploaded evidence and disabled OAuth providers");
    }
    const updated = await notificationRpc("activate_production_auth_schedules", { p_run: runId });
    console.log(JSON.stringify({ schedules: updated }));
  } else throw new Error("Usage: production-auth-rollout.ts test-alert --confirm-send-test | enable-schedules RUN_ID --confirm-enable");
}
main().catch(() => { console.error("Production authentication rollout command failed; inspect sanitized outbox/run status."); process.exitCode = 1; });
