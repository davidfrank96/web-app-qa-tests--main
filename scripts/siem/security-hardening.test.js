const assert = require("node:assert/strict");
const test = require("node:test");
const { assertMetadataOnly, postJson, redactEndpoint } = require("./send-to-wazuh");

test("SIEM sender refuses credential material", () => {
  assert.throws(
    () => assertMetadataOnly({ events: [{ authorization: "Bearer secret-token-value-123456789" }] }),
    /credential material/
  );
});

test("SIEM sender refuses anonymous delivery", async () => {
  await assert.rejects(() => postJson("http://127.0.0.1:1/inssa", {}, ""), /credential is required/);
});

test("SIEM endpoint diagnostics redact URL credentials", () => {
  const redacted = redactEndpoint("https://operator:secret@example.invalid/inssa?token=value");
  assert.equal(redacted.includes("operator"), false);
  assert.equal(redacted.includes("secret"), false);
  assert.equal(redacted.includes("value"), false);
});
