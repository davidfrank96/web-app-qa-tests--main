import { loadAuthenticationMonitoringResult } from "./authentication-result-store";
import type { AuthenticationMonitoringSummary } from "./authentication-result";
import { getInssaRunStore } from "../inssa-ops/run-store";
import { notificationRpc } from "../inssa-ops/notification-delivery";
import type { InssaRunStatus } from "../inssa-ops/types";

export function productionAuthAlertDecision(status: InssaRunStatus, summary: AuthenticationMonitoringSummary | null) {
  if (status === "timed_out") return { passed: false, classification: "TIMEOUT" };
  if (!summary || summary.environment !== "production" || summary.targetHost !== "inssa.us") {
    return { passed: false, classification: "MONITOR_INFRASTRUCTURE_FAILURE" };
  }
  const password = summary.checks["username-password"];
  if (password.status === "passed" && ["passed", "passed_with_warnings"].includes(status)) return { passed: true, classification: "NONE" };
  if (password.status === "timed_out") return { passed: false, classification: "TIMEOUT" };
  if (["disabled", "missing_configuration"].includes(password.status) || status === "failed_startup" || password.status === "passed") {
    return { passed: false, classification: "MONITOR_INFRASTRUCTURE_FAILURE" };
  }
  const error = password.error ?? "";
  const classification = /timeout|timed out/i.test(error) ? "TIMEOUT"
    : /5\d\d|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|unreachable/i.test(error) ? "PRODUCTION_UNREACHABLE"
    : /invalid.?(?:credential|password)|wrong.password|user.not.found|credential.*reject/i.test(error) ? "AUTHENTICATION_REJECTED"
    : /session/i.test(error) ? "SESSION_NOT_ESTABLISHED"
    : /authenticated|landing/i.test(error) ? "AUTHENTICATED_STATE_NOT_REACHED"
    : /sign.in|login.page/i.test(error) ? "LOGIN_PAGE_UNAVAILABLE" : "UNKNOWN_AUTH_FAILURE";
  return { passed: false, classification };
}

export async function recordProductionAuthAlert(runId: string, status: InssaRunStatus) {
    const resolved = await loadAuthenticationMonitoringResult(getInssaRunStore(), runId).catch(() => null);
    const decision = productionAuthAlertDecision(status, resolved?.result ?? null);
    await notificationRpc("record_production_auth_result", { p_run: runId, p_passed: decision.passed, p_classification: decision.classification });
}
