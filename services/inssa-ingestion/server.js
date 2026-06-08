#!/usr/bin/env node

const { timingSafeEqual } = require("crypto");
const { appendFile, mkdir } = require("fs/promises");
const http = require("http");
const path = require("path");

const EVENT_SCHEMA_VERSION = "inssa-qa-siem.v1";
const SERVICE_NAME = "inssa-ingestion";

const DEFAULT_HOST = process.env.INSSA_INGEST_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.INSSA_INGEST_PORT || 8088);
const DEFAULT_PATH = process.env.INSSA_INGEST_PATH || "/inssa";
const DEFAULT_EVENT_LOG_PATH = process.env.INSSA_INGEST_EVENT_LOG_PATH || "/var/ossec/logs/inssa-qa.log";
const DEFAULT_REQUEST_LOG_PATH =
  process.env.INSSA_INGEST_REQUEST_LOG_PATH || "/var/ossec/logs/inssa-qa-ingestion-requests.log";
const DEFAULT_FAILURE_LOG_PATH =
  process.env.INSSA_INGEST_FAILURE_LOG_PATH || "/var/ossec/logs/inssa-qa-ingestion-errors.log";
const DEFAULT_MAX_BODY_BYTES = Number(process.env.INSSA_INGEST_MAX_BODY_BYTES || 1024 * 1024);
const SHARED_TOKEN = process.env.INSSA_INGEST_SHARED_TOKEN || "";

if (require.main === module) {
  const server = createInssaIngestionServer();
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    console.log(`${SERVICE_NAME} listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}${DEFAULT_PATH}`);
    console.log(`INSSA event log: ${DEFAULT_EVENT_LOG_PATH}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

module.exports = {
  EVENT_SCHEMA_VERSION,
  createInssaIngestionServer,
  extractEvents,
  validateInssaEvent
};

function createInssaIngestionServer(options = {}) {
  const config = {
    ingestPath: options.ingestPath || DEFAULT_PATH,
    eventLogPath: options.eventLogPath || DEFAULT_EVENT_LOG_PATH,
    requestLogPath: options.requestLogPath || DEFAULT_REQUEST_LOG_PATH,
    failureLogPath: options.failureLogPath || DEFAULT_FAILURE_LOG_PATH,
    maxBodyBytes: options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES,
    sharedToken: options.sharedToken ?? SHARED_TOKEN
  };

  return http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestPath = getRequestPath(request);

    try {
      if (request.method === "GET" && requestPath === "/healthz") {
        await logRequest(config, request, startedAt, 200, "health_check");
        return sendJson(response, 200, {
          ok: true,
          service: SERVICE_NAME,
          schemaVersion: EVENT_SCHEMA_VERSION
        });
      }

      if (requestPath !== config.ingestPath) {
        await logFailure(config, request, 404, "not_found");
        await logRequest(config, request, startedAt, 404, "not_found");
        return sendJson(response, 404, { ok: false, error: "not_found" });
      }

      if (request.method !== "POST") {
        await logFailure(config, request, 405, "method_not_allowed");
        await logRequest(config, request, startedAt, 405, "method_not_allowed");
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }

      if (!isAuthorized(request, config.sharedToken)) {
        await logFailure(config, request, 401, "unauthorized");
        await logRequest(config, request, startedAt, 401, "unauthorized");
        return sendJson(response, 401, { ok: false, error: "unauthorized" });
      }

      const contentType = request.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        await logFailure(config, request, 415, "unsupported_media_type", { contentType });
        await logRequest(config, request, startedAt, 415, "unsupported_media_type");
        return sendJson(response, 415, { ok: false, error: "unsupported_media_type" });
      }

      const bodyResult = await readRequestBody(request, config.maxBodyBytes);
      if (bodyResult.tooLarge) {
        await logFailure(config, request, 413, "payload_too_large", {
          bytesReceived: bodyResult.bytesReceived,
          maxBodyBytes: config.maxBodyBytes
        });
        await logRequest(config, request, startedAt, 413, "payload_too_large", {
          bytesReceived: bodyResult.bytesReceived
        });
        return sendJson(response, 413, {
          ok: false,
          error: "payload_too_large",
          maxBodyBytes: config.maxBodyBytes
        });
      }

      let payload;
      try {
        payload = JSON.parse(bodyResult.body);
      } catch (error) {
        await logFailure(config, request, 400, "invalid_json", {
          message: error instanceof Error ? error.message : String(error)
        });
        await logRequest(config, request, startedAt, 400, "invalid_json", {
          bytesReceived: bodyResult.bytesReceived
        });
        return sendJson(response, 400, { ok: false, error: "invalid_json" });
      }

      let events;
      try {
        events = extractEvents(payload);
      } catch (error) {
        await logFailure(config, request, 400, "schema_validation_failed", {
          message: error instanceof Error ? error.message : String(error)
        });
        await logRequest(config, request, startedAt, 400, "schema_validation_failed", {
          bytesReceived: bodyResult.bytesReceived
        });
        return sendJson(response, 400, {
          ok: false,
          error: "schema_validation_failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }

      await writeEvents(config.eventLogPath, events);
      await logRequest(config, request, startedAt, 202, "accepted", {
        bytesReceived: bodyResult.bytesReceived,
        acceptedEvents: events.length,
        batch: Array.isArray(payload.events)
      });

      return sendJson(response, 202, {
        ok: true,
        accepted: events.length,
        schemaVersion: EVENT_SCHEMA_VERSION
      });
    } catch (error) {
      await logFailure(config, request, 500, "internal_error", {
        message: error instanceof Error ? error.message : String(error)
      });
      await logRequest(config, request, startedAt, 500, "internal_error");
      return sendJson(response, 500, { ok: false, error: "internal_error" });
    }
  });
}

function extractEvents(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload must be a JSON object.");
  }

  if (Array.isArray(payload.events)) {
    if (payload.schemaVersion !== EVENT_SCHEMA_VERSION) {
      throw new Error(
        `Batch schemaVersion must be ${EVENT_SCHEMA_VERSION}; received ${String(payload.schemaVersion)}.`
      );
    }

    if (payload.events.length === 0) {
      throw new Error("Batch payload must include at least one event.");
    }

    for (const [index, event] of payload.events.entries()) {
      validateInssaEvent(event, `events[${index}]`);
    }
    return payload.events;
  }

  validateInssaEvent(payload, "event");
  return [payload];
}

function validateInssaEvent(event, label = "event") {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  const exactFields = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    source: "web-app-qa-tests",
    product: "INSSA"
  };

  for (const [field, expected] of Object.entries(exactFields)) {
    if (event[field] !== expected) {
      throw new Error(`${label}.${field} must be ${expected}; received ${String(event[field])}.`);
    }
  }

  for (const field of ["eventType", "timestamp", "campaign", "environment", "severity", "classification", "status"]) {
    if (typeof event[field] !== "string" || event[field].trim() === "") {
      throw new Error(`${label}.${field} must be a non-empty string.`);
    }
  }
}

async function readRequestBody(request, maxBodyBytes) {
  const chunks = [];
  let bytesReceived = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    bytesReceived += chunk.length;
    if (bytesReceived > maxBodyBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  return {
    body: Buffer.concat(chunks).toString("utf8"),
    bytesReceived,
    tooLarge
  };
}

async function writeEvents(eventLogPath, events) {
  await mkdir(path.dirname(eventLogPath), { recursive: true });
  const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  await appendFile(eventLogPath, lines, "utf8");
}

async function logRequest(config, request, startedAt, statusCode, result, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    method: request.method,
    path: getRequestPath(request),
    statusCode,
    result,
    durationMs: Date.now() - startedAt,
    remoteAddress: request.socket.remoteAddress,
    userAgent: request.headers["user-agent"] || null,
    details
  };
  await appendJsonLine(config.requestLogPath, entry).catch((error) => {
    console.error("Failed to write INSSA ingestion request log:", entry, error);
  });
}

async function logFailure(config, request, statusCode, reason, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    statusCode,
    reason,
    method: request.method,
    path: getRequestPath(request),
    remoteAddress: request.socket.remoteAddress,
    details
  };
  await appendJsonLine(config.failureLogPath, entry).catch((error) => {
    console.error("Failed to write INSSA ingestion failure log:", entry, error);
  });
}

async function appendJsonLine(filePath, entry) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function isAuthorized(request, sharedToken) {
  if (!sharedToken) return true;
  const expected = `Bearer ${sharedToken}`;
  const actual = request.headers.authorization || "";
  return safeEqual(actual, expected);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getRequestPath(request) {
  try {
    return new URL(request.url || "/", "http://localhost").pathname;
  } catch (_error) {
    return "/";
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}
