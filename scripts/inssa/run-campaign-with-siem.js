#!/usr/bin/env node

const { spawnSync } = require("child_process");

const CAMPAIGNS = {
  security: {
    description: "INSSA OWASP/security campaign",
    command: ["node", "scripts/inssa/run-security-campaign.js"]
  },
  "cross-user": {
    description: "INSSA cross-user access-control campaign",
    command: ["node", "scripts/inssa/run-cross-user-campaign.js"]
  },
  "reveal-later": {
    description: "INSSA reveal-later security campaign",
    command: ["node", "scripts/inssa/run-reveal-later-security-campaign.js"]
  }
};

main();

function main() {
  const campaignName = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!campaignName || campaignName === "--help" || campaignName === "-h") {
    printUsage();
    process.exitCode = campaignName ? 0 : 1;
    return;
  }

  const campaign = CAMPAIGNS[campaignName];
  if (!campaign) {
    console.error(`Unknown INSSA campaign: ${campaignName}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const steps = [
    {
      label: `Run ${campaign.description}`,
      command: campaign.command,
      env: {}
    },
    {
      label: "Generate SIEM export",
      command: ["npm", "run", "siem:export"],
      env: {}
    },
    {
      label: "Send SIEM export to Wazuh",
      command: ["npm", "run", "siem:send"],
      env: { SIEM_SEND_BATCH: "1" }
    }
  ];

  console.log(`INSSA campaign with SIEM: ${campaignName}`);
  for (const step of steps) {
    console.log(`- ${step.label}: ${formatCommand(step.command, step.env)}`);
  }

  if (dryRun) {
    console.log("Dry run complete. No campaign or SIEM send executed.");
    return;
  }

  for (const step of steps) {
    runStep(step);
  }

  console.log(`INSSA ${campaignName} campaign, SIEM export, and Wazuh send completed.`);
}

function runStep(step) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(step.command[0], step.command.slice(1), {
    env: {
      ...process.env,
      ...step.env
    },
    shell: false,
    stdio: "inherit"
  });

  if (result.error) {
    console.error(`${step.label} failed: ${result.error.message}`);
    process.exit(result.status || 1);
  }

  if (result.status !== 0) {
    console.error(`${step.label} failed with exit code ${result.status}.`);
    process.exit(result.status);
  }
}

function formatCommand(command, env) {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `${envPrefix ? `${envPrefix} ` : ""}${command.join(" ")}`;
}

function printUsage() {
  console.log("Usage: node scripts/inssa/run-campaign-with-siem.js <campaign> [--dry-run]");
  console.log("");
  console.log("Campaigns:");
  for (const [name, campaign] of Object.entries(CAMPAIGNS)) {
    console.log(`- ${name}: ${campaign.description}`);
  }
}
