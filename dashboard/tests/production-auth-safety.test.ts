import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthenticationTarget, productionAuthRequestAllowed } from "../../scripts/inssa/production-auth-safety";
import { resolveAuthenticationMonitorCredentials } from "../../scripts/inssa/authentication-monitoring-config";
test("production exact origin and credential namespace fail closed", () => {
  assert.doesNotThrow(() => assertAuthenticationTarget("production", "https://inssa.us"));
  for (const url of ["https://staging.inssa.us", "https://www.inssa.us", "http://inssa.us", "https://inssa.us:8443", "https://user:secret@inssa.us", "https://inssa.us.evil.test", "https://inssa.us/settings"]) assert.throws(() => assertAuthenticationTarget("production", url));
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", AUTH_MONITOR_STAGING_EMAIL: "staging@example.test", AUTH_MONITOR_STAGING_PASSWORD: "fixture", INSSA_TEST_EMAIL: "fallback@example.test", INSSA_TEST_PASSWORD: "fixture" };
  assert.equal(resolveAuthenticationMonitorCredentials(env, "production", "password"), null);
  assert.throws(() => resolveAuthenticationMonitorCredentials(env, "unknown", "password"));
  assert.deepEqual(resolveAuthenticationMonitorCredentials({ ...env, AUTH_MONITOR_PRODUCTION_EMAIL: "prod@example.test", AUTH_MONITOR_PRODUCTION_PASSWORD: "prod-fixture" }, "production", "password"), { email: "prod@example.test", password: "prod-fixture" });
});
test("production network guard permits login/read session and blocks application, account and data mutations", () => {
  for (const endpoint of ["signInWithPassword", "lookup"]) assert.equal(productionAuthRequestAllowed(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=fixture`, "POST"), true);
  assert.equal(productionAuthRequestAllowed("https://inssa.us/me", "GET"), true);
  for (const endpoint of ["update", "delete", "signUp", "sendOobCode", "resetPassword"]) assert.equal(productionAuthRequestAllowed(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}`, "POST"), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) for (const pathname of ["/api/capsules", "/api/profile", "/settings/password"]) assert.equal(productionAuthRequestAllowed(`https://inssa.us${pathname}`, method), false);
  assert.equal(productionAuthRequestAllowed("https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel", "POST"), false);
  assert.equal(productionAuthRequestAllowed("https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel", "POST"), true);
  assert.equal(productionAuthRequestAllowed("https://staging.inssa.us/signin", "GET"), false);
});
