#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const trackedFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  cwd: repoRoot,
  encoding: "utf8"
}).split("\0").filter(Boolean);

const secretFilePattern = /(^|\/)(?:\.env(?:\..+)?|users\.json|[^/]+\.(?:key|p12|pfx|pem))$/i;
const allowedSecretTemplates = new Set([
  ".env.example",
  ".env.inssa.live-staging.example",
  "dashboard/.env.example",
  "dashboard/.env.production.example",
  "performance/k6/.env.example"
]);
const contentRules = [
  ["private-key", /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/],
  ["google-api-key", /AIza[0-9A-Za-z_-]{35}/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ["supabase-secret-key", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/]
];
const assignmentPattern = /^\s*(?:SUPABASE_SERVICE_ROLE_KEY|INSSA_AUTH_RATE_LIMIT_SECRET|SIEM_WAZUH_TOKEN|INSSA_INGEST_SHARED_TOKEN|AUTH_MONITOR_[A-Z0-9_]*(?:PASSWORD|SECRET)|INSSA_(?:TEST|SECONDARY_TEST)_PASSWORD)\s*=\s*(.+?)\s*$/;
const findings = [];

for (const relativePath of trackedFiles) {
  if (secretFilePattern.test(relativePath) && !allowedSecretTemplates.has(relativePath)) {
    findings.push({ line: 1, path: relativePath, rule: "secret-bearing-file" });
  }

  const absolutePath = path.join(repoRoot, relativePath);
  let content;
  try {
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile() || stats.size > 5 * 1024 * 1024) continue;
    content = fs.readFileSync(absolutePath, "utf8");
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const [rule, pattern] of contentRules) {
      if (pattern.test(line)) findings.push({ line: index + 1, path: relativePath, rule });
    }

    if (!allowedSecretTemplates.has(relativePath) && !relativePath.endsWith(".md")) {
      const assignment = line.match(assignmentPattern)?.[1]?.trim();
      if (assignment && !/^<[^>]+>$/.test(assignment) && !/^(?:example|placeholder|replace-me|changeme)$/i.test(assignment)) {
        findings.push({ line: index + 1, path: relativePath, rule: "credential-assignment" });
      }
    }
  }
}

if (findings.length > 0) {
  process.stderr.write("Tracked secret scan FAIL\n");
  for (const finding of findings) {
    process.stderr.write(`${finding.path}:${finding.line} ${finding.rule}\n`);
  }
  process.exit(1);
}

process.stdout.write(`Tracked secret scan PASS (${trackedFiles.length} files checked).\n`);
