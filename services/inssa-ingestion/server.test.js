const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  EVENT_SCHEMA_VERSION,
  createInssaIngestionServer
} = require("./server");

const TOKEN = "test-only-ingestion-token-32-chars-minimum";

test("ingestion fails closed when its shared credential is missing", () => {
  assert.throws(() => createInssaIngestionServer({ sharedToken: "" }), /is required/);
});

test("ingestion requires bearer authentication and rejects credential material", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-ingestion-security-"));
  const eventLogPath = path.join(directory, "events.jsonl");
  const server = createInssaIngestionServer({
    eventLogPath,
    failureLogPath: path.join(directory, "failures.jsonl"),
    requestLogPath: path.join(directory, "requests.jsonl"),
    sharedToken: TOKEN
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/inssa`;
  const event = {
    campaign: "security",
    classification: "public-by-id",
    environment: "staging",
    eventType: "security_campaign",
    product: "INSSA",
    schemaVersion: EVENT_SCHEMA_VERSION,
    severity: "high",
    source: "web-app-qa-tests",
    status: "failed",
    timestamp: new Date().toISOString()
  };

  try {
    const anonymous = await requestJson(endpoint, event);
    assert.equal(anonymous.status, 401);

    const secretBearing = await requestJson(
      endpoint,
      { ...event, details: { authorization: "Bearer secret-token-value-123456789" } },
      TOKEN
    );
    assert.equal(secretBearing.status, 400);

    const accepted = await requestJson(endpoint, event, TOKEN);
    assert.equal(accepted.status, 202);
    const persisted = await fs.readFile(eventLogPath, "utf8");
    assert.deepEqual(JSON.parse(persisted.trim()), event);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { force: true, recursive: true });
  }
});

function requestJson(endpoint, payload, token) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request(endpoint, {
      headers: {
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      method: "POST"
    }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode }));
    });
    request.on("error", reject);
    request.end(body);
  });
}
