import assert from "node:assert/strict";
import test from "node:test";
import { redactInssaLogLine } from "../lib/inssa-ops/redaction";

test("dashboard output redaction removes credential formats", () => {
  const input = [
    "Authorization: Bearer secret-token-value-123456789",
    "Cookie: sessionId=private-session-value",
    "https://staging.inssa.us/capsule?id=1&token=private-share-token",
    '"refreshToken":"private-refresh-token"',
    "eyJaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbb.cccccccccc"
  ].join("\n");
  const output = redactInssaLogLine(input);
  for (const secret of [
    "secret-token-value-123456789",
    "private-session-value",
    "private-share-token",
    "private-refresh-token",
    "eyJaaaaaaaaaaaaaaaaaaaaa"
  ]) {
    assert.equal(output.includes(secret), false);
  }
});
