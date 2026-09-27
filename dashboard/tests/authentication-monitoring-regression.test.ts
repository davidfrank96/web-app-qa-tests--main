import assert from "node:assert/strict";
import test from "node:test";
import { getInssaPhase1Command } from "../lib/inssa-ops/command-registry";
import { determineExecutionFinalStatus, executionLineHasWarning } from "../lib/inssa-ops/runner";
import { describeAuthenticationMonitorIncompleteRun } from "../lib/monitoring/authentication-failure";
import { DEFAULT_MONITORING_DEFINITIONS } from "../lib/monitoring/catalog";

test("authentication monitoring keeps its command contract and a safe execution envelope", () => {
  const staging = getInssaPhase1Command("monitor_inssa_auth_staging");
  const production = getInssaPhase1Command("monitor_inssa_auth_production");
  assert.equal(staging?.npmScript, "test:inssa:monitor:auth:staging");
  assert.equal(production?.npmScript, "test:inssa:monitor:auth:production");
  assert.equal(staging?.timeoutMs, 360_000);
  assert.equal(production?.timeoutMs, 360_000);

  const definitions = DEFAULT_MONITORING_DEFINITIONS.filter((definition) =>
    definition.campaignId.startsWith("monitor_inssa_auth_")
  );
  assert.equal(definitions.length, 4);
  assert.equal(definitions.every((definition) => definition.timeout === 360_000), true);
  assert.equal(
    definitions.filter((definition) => definition.environment === "production").every((definition) => !definition.enabled),
    true
  );
});

test("failed startup UI explains a campaign timeout from sanitized logs", () => {
  const reason = describeAuthenticationMonitorIncompleteRun([
    { message: "Campaign process ownership established: pid=100, processGroup=100, timeoutMs=120000, terminationGraceMs=10000.", sequence: 1, stream: "system" },
    { message: "Campaign process-tree termination requested: reason=timeout.", sequence: 2, stream: "system" },
    { message: "Worker execution failure: Owned campaign process tree 100 survived SIGKILL.", sequence: 3, stream: "system" }
  ]);
  assert.equal(
    reason,
    "Campaign exceeded its 120-second execution timeout before all provider results completed. Worker cleanup reported: Owned campaign process tree 100 survived SIGKILL."
  );
});

test("incomplete-run UI preserves a sanitized startup exception", () => {
  const reason = describeAuthenticationMonitorIncompleteRun([
    { message: "Startup failure: spawn npm ENOENT", sequence: 1, stream: "system" }
  ]);
  assert.equal(reason, "spawn npm ENOENT");
});

test("a started campaign timeout cannot be overwritten as failed startup by cleanup failure", () => {
  assert.equal(
    determineExecutionFinalStatus({
      exitCode: null,
      exitSignal: "SIGKILL",
      leaseLost: false,
      startupError: false,
      terminationFailure: true,
      timedOut: true,
      warningSeen: false
    }),
    "timed_out"
  );
  assert.equal(
    determineExecutionFinalStatus({
      exitCode: null,
      exitSignal: null,
      leaseLost: false,
      startupError: true,
      terminationFailure: false,
      timedOut: false,
      warningSeen: false
    }),
    "failed_startup"
  );
});


test("production runtime notice classification preserves real warnings and failure precedence", () => {
  const notice = "npm warn config production Use `--omit=dev` instead.";
  const production = "monitor_inssa_auth_production";
  for (const stream of ["stdout", "stderr"] as const) {
    assert.equal(executionLineHasWarning(production, stream, notice), false);
    assert.equal(executionLineHasWarning("monitor_inssa_auth_staging", stream, notice), true);
    assert.equal(executionLineHasWarning("test_inssa_safe", stream, notice), true);
    assert.equal(executionLineHasWarning(production, stream, notice + " unexpected"), true);
    assert.equal(executionLineHasWarning(production, stream, "WARNING: authentication degraded"), true);
  }
  assert.equal(executionLineHasWarning(production, "stderr", "upload failed"), true);
  assert.equal(executionLineHasWarning(production, "stdout", "3 passed"), false);
  const outcome = { exitCode: 0, exitSignal: null, leaseLost: false, startupError: false, terminationFailure: false, timedOut: false };
  const classify = (lines: string[]) => lines.some((line) => executionLineHasWarning(production, "stderr", line));
  assert.equal(determineExecutionFinalStatus({ ...outcome, warningSeen: classify([notice]) }), "passed");
  assert.equal(determineExecutionFinalStatus({ ...outcome, warningSeen: classify([notice, "unexpected stderr"]) }), "passed_with_warnings");
  assert.equal(determineExecutionFinalStatus({ ...outcome, exitCode: 1, warningSeen: classify([notice]) }), "failed");
  assert.equal(determineExecutionFinalStatus({ ...outcome, timedOut: true, warningSeen: false }), "timed_out");
  assert.equal(determineExecutionFinalStatus({ ...outcome, leaseLost: true, warningSeen: false }), "failed");
  assert.equal(determineExecutionFinalStatus({ ...outcome, terminationFailure: true, warningSeen: false }), "failed");
});
