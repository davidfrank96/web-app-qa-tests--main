#!/usr/bin/env node

const { mkdirSync, writeFileSync } = require("fs");
const path = require("path");
const {
  DEFAULT_OUTPUT_PATH,
  normalizeAllCampaignOutputs
} = require("./normalize-findings");

const ROOT = process.cwd();

main();

function main() {
  const outputPath = path.resolve(ROOT, getArgValue("--output") ?? DEFAULT_OUTPUT_PATH);
  const pretty = !process.argv.includes("--compact");
  const payload = normalizeAllCampaignOutputs();

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(payload, null, pretty ? 2 : 0)}\n`, "utf8");

  console.log("INSSA SIEM export complete.");
  console.log(`- output: ${outputPath}`);
  console.log(`- events: ${payload.eventCount}`);
  console.log(`- severities: ${JSON.stringify(payload.severityCounts)}`);
  console.log(`- statuses: ${JSON.stringify(payload.statusCounts)}`);
  console.log("- media policy: screenshots/videos/traces excluded; metadata and report/artifact references only");
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
