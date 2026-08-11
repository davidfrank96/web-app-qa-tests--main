const assert = require("node:assert/strict");
const test = require("node:test");
const { overallStatusFor } = require("./authentication-monitoring-policy");

function result(method, status) {
  return { method, status };
}

test("passes when enabled checks pass and disabled providers are excluded", () => {
  assert.equal(
    overallStatusFor([
      result("username-password", "passed"),
      result("google-oauth", "disabled"),
      result("apple-sign-in", "disabled")
    ]),
    "passed"
  );
});

test("degrades when username/password passes and a provider is externally blocked", () => {
  assert.equal(
    overallStatusFor([
      result("username-password", "passed"),
      result("google-oauth", "blocked_external"),
      result("apple-sign-in", "missing_configuration")
    ]),
    "degraded"
  );
});

test("fails when username/password or an application check fails", () => {
  assert.equal(overallStatusFor([result("username-password", "failed")]), "failed");
  assert.equal(
    overallStatusFor([result("username-password", "passed"), result("google-oauth", "failed")]),
    "failed"
  );
  assert.equal(
    overallStatusFor([result("username-password", "passed"), result("apple-sign-in", "timed_out")]),
    "failed"
  );
});
