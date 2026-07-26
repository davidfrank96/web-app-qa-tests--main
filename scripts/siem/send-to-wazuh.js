#!/usr/bin/env node

const { existsSync, readFileSync } = require("fs");
const path = require("path");
const {
  DEFAULT_OUTPUT_PATH,
  normalizeAllCampaignOutputs,
  redactSensitiveString
} = require("./normalize-findings");

const ROOT = process.cwd();
const EXAMPLE_WAZUH_INGESTION_URL = "https://wazuh.kbeanprobo.com/inssa";

if (require.main === module) {
  main().catch((error) => {
    console.error(redactSensitiveString(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}

module.exports = {
  assertMetadataOnly,
  postJson,
  redactEndpoint
};

async function main() {
  const inputPath = path.resolve(ROOT, getArgValue("--input") ?? DEFAULT_OUTPUT_PATH);
  const dryRun = process.argv.includes("--dry-run") || process.env.SIEM_DRY_RUN === "1";
  const batchMode = process.argv.includes("--batch") || process.env.SIEM_SEND_BATCH === "1";
  const endpoint = process.env.SIEM_WAZUH_URL || process.env.WAZUH_WEBHOOK_URL || process.env.WAZUH_URL;
  const token = process.env.SIEM_WAZUH_TOKEN || process.env.WAZUH_API_TOKEN || process.env.WAZUH_TOKEN;
  const payload = readExport(inputPath);

  assertMetadataOnly(payload);

  if (dryRun) {
    printDryRun(inputPath, payload);
    return;
  }

  if (!endpoint) {
    throw new Error(
      `No Wazuh endpoint configured. Set SIEM_WAZUH_URL or WAZUH_WEBHOOK_URL, or run with --dry-run. Example: SIEM_WAZUH_URL=${EXAMPLE_WAZUH_INGESTION_URL}`
    );
  }
  if (!token) {
    throw new Error("No Wazuh ingestion credential configured. Set SIEM_WAZUH_TOKEN; anonymous ingestion is prohibited.");
  }

  const target = new URL(endpoint);
  if (!/^https?:$/.test(target.protocol)) {
    throw new Error(`Unsupported Wazuh endpoint protocol: ${target.protocol}`);
  }
  if (target.protocol !== "https:" && !["127.0.0.1", "localhost", "::1"].includes(target.hostname)) {
    throw new Error("Wazuh ingestion requires HTTPS except for loopback development endpoints.");
  }

  const sent = batchMode
    ? await sendBatch(target.toString(), payload, token)
    : await sendEvents(target.toString(), payload.events, token);

  console.log("INSSA SIEM send complete.");
  console.log(`- endpoint: ${redactEndpoint(target.toString())}`);
  console.log(`- mode: ${batchMode ? "batch" : "event"}`);
  console.log(`- events sent: ${sent}`);
}

function readExport(inputPath) {
  if (existsSync(inputPath)) {
    return JSON.parse(readFileSync(inputPath, "utf8"));
  }

  if (inputPath === DEFAULT_OUTPUT_PATH) {
    console.warn(`SIEM export not found at ${inputPath}; generating an in-memory export.`);
    return normalizeAllCampaignOutputs();
  }

  throw new Error(`SIEM export not found: ${inputPath}`);
}

async function sendEvents(endpoint, events, token) {
  let sent = 0;
  for (const event of events ?? []) {
    await postJson(endpoint, event, token);
    sent += 1;
  }
  return sent;
}

async function sendBatch(endpoint, payload, token) {
  await postJson(endpoint, payload, token);
  return payload.events?.length ?? 0;
}

async function postJson(endpoint, body, token) {
  if (!token) {
    throw new Error("Wazuh ingestion credential is required; anonymous ingestion is prohibited.");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Wazuh send failed: HTTP ${response.status} ${response.statusText}${responseText ? `: ${redactSensitiveString(responseText.slice(0, 500))}` : ""}`
    );
  }
}

function assertMetadataOnly(payload) {
  const serialized = JSON.stringify(payload);
  const forbiddenPathPattern = /\.(?:png|jpe?g|gif|webm|mp4|mov|zip)(?:"|\\b|\\?)/i;
  if (forbiddenPathPattern.test(serialized)) {
    throw new Error(
      "SIEM payload contains a screenshot/video/trace reference. Refusing to send non-metadata evidence."
    );
  }

  if (/token=[^&"\s]+/i.test(serialized) || /token-[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(serialized)) {
    throw new Error("SIEM payload contains an unredacted token value. Refusing to send.");
  }
  if (
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i.test(serialized) ||
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/.test(serialized) ||
    /[?&](?:access_token|id_token|refresh_token|signature|sig|x-amz-signature)=[^&#\s"']+/i.test(serialized) ||
    /"(?:password|secret|privateKey|serviceRoleKey|accessToken|refreshToken|idToken|authorization|cookie|sessionId)"\s*:\s*"(?!\[redacted\]|<redacted>)[^"]+"/i.test(serialized)
  ) {
    throw new Error("SIEM payload contains credential material. Refusing to send.");
  }
}

function printDryRun(inputPath, payload) {
  console.log("INSSA SIEM dry run complete.");
  console.log(`- input: ${inputPath}`);
  console.log(`- events: ${payload.eventCount ?? payload.events?.length ?? 0}`);
  console.log(`- severities: ${JSON.stringify(payload.severityCounts ?? {})}`);
  console.log(`- statuses: ${JSON.stringify(payload.statusCounts ?? {})}`);
  console.log(`- example Wazuh ingestion endpoint: ${EXAMPLE_WAZUH_INGESTION_URL}`);
  console.log("- send skipped: --dry-run or SIEM_DRY_RUN=1");
}

function redactEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  parsed.username = parsed.username ? "[redacted]" : "";
  parsed.password = parsed.password ? "[redacted]" : "";
  for (const key of ["token", "access_token", "key", "secret"]) {
    if (parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, "[redacted]");
    }
  }
  return parsed.toString();
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
