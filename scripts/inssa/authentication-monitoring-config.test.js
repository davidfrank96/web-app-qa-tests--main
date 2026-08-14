const assert = require("node:assert/strict");
const test = require("node:test");
const {
  authenticationMonitorConfiguration,
  parseMethodSelection,
  resolveAuthenticationMonitorCredentials,
  sanitizedConfigurationLines
} = require("./authentication-monitoring-config");

test("resolves the canonical staging password credentials and legacy fallback", () => {
  assert.deepEqual(
    resolveAuthenticationMonitorCredentials(
      { AUTH_MONITOR_STAGING_EMAIL: "qa@example.test", AUTH_MONITOR_STAGING_PASSWORD: "secret" },
      "staging",
      "password"
    ),
    { email: "qa@example.test", password: "secret" }
  );
  assert.deepEqual(
    resolveAuthenticationMonitorCredentials(
      { INSSA_TEST_EMAIL: "fallback@example.test", INSSA_TEST_PASSWORD: "fallback-secret" },
      "staging",
      "password"
    ),
    { email: "fallback@example.test", password: "fallback-secret" }
  );
});

test("keeps provider configuration independent", () => {
  const env = {
    AUTH_MONITOR_STAGING_APPLE_EMAIL: "apple@example.test",
    AUTH_MONITOR_STAGING_EMAIL: "qa@example.test",
    AUTH_MONITOR_STAGING_GOOGLE_EMAIL: "google@example.test",
    AUTH_MONITOR_STAGING_GOOGLE_PASSWORD: "google-secret",
    AUTH_MONITOR_STAGING_PASSWORD: "secret"
  };
  const configuration = authenticationMonitorConfiguration(env, "staging");
  assert.equal(configuration.methods.password, "CONFIGURED");
  assert.equal(configuration.methods.google, "CONFIGURED");
  assert.equal(configuration.methods.apple, "MISSING_CONFIGURATION");
});

test("sanitized diagnostics never contain credentials", () => {
  const env = {
    AUTH_MONITOR_STAGING_EMAIL: "qa@example.test",
    AUTH_MONITOR_STAGING_PASSWORD: "do-not-print"
  };
  const output = sanitizedConfigurationLines(authenticationMonitorConfiguration(env, "staging")).join("\n");
  assert.match(output, /AUTH_MONITOR_STAGING_EMAIL=SET/);
  assert.match(output, /AUTH_MONITOR_STAGING_PASSWORD=SET/);
  assert.doesNotMatch(output, /qa@example\.test|do-not-print/);
});

test("password-only regression selection rejects unknown methods", () => {
  assert.deepEqual(parseMethodSelection(["--methods=username-password"]), ["username-password"]);
  assert.throws(() => parseMethodSelection(["--methods=unknown"]), /Unsupported authentication monitor methods/);
});
