#!/usr/bin/env node

const { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const path = require("path");

const ROOT = process.cwd();
const LIFECYCLE_CAMPAIGN_DIR = path.resolve(ROOT, "lifecycle-campaigns");
const SECURITY_CAMPAIGN_DIR = path.resolve(ROOT, "security-campaigns");
const REPORT_DIR = path.resolve(ROOT, "reports");
const PLAYWRIGHT_REPORT = path.resolve(ROOT, "playwright-report", "index.html");
const TEST_RESULTS_DIR = path.resolve(ROOT, "test-results");

if (require.main === module) {
  const mode = process.argv[2] ?? "all";
  if (!["all", "lifecycle", "security"].includes(mode)) {
    console.error("Usage: node scripts/inssa/render-campaign-report.js [all|lifecycle|security]");
    process.exitCode = 1;
  } else {
    const outputs = [];
    if (mode === "all" || mode === "security") {
      const output = renderLatestSecurityReport();
      if (output) outputs.push(...output);
    }
    if (mode === "all" || mode === "lifecycle") {
      const output = renderLatestLifecycleReport();
      if (output) outputs.push(...output);
    }

    for (const output of outputs) {
      console.log(`Generated report: ${output}`);
    }
  }
}

module.exports = {
  renderLifecycleReport,
  renderLatestLifecycleReport,
  renderLatestSecurityReport,
  renderSecurityReport
};

function renderLatestSecurityReport() {
  const latest = latestJsonFile(
    SECURITY_CAMPAIGN_DIR,
    (fileName) => /-security\.json$/.test(fileName) && fileName !== "lifecycle-security.json"
  );
  if (!latest) {
    console.warn(`No security campaign summary found in ${SECURITY_CAMPAIGN_DIR}.`);
    return null;
  }

  return renderSecurityReport(latest);
}

function renderLatestLifecycleReport() {
  const latest = latestJsonFile(LIFECYCLE_CAMPAIGN_DIR, (fileName) => /-campaign-[^.]+\.json$/.test(fileName));
  if (!latest) {
    console.warn(`No lifecycle campaign summary found in ${LIFECYCLE_CAMPAIGN_DIR}.`);
    return null;
  }

  return renderLifecycleReport(latest);
}

function renderSecurityReport(summaryPath) {
  const summary = readJson(summaryPath);
  if (!summary) {
    throw new Error(`Unable to read security summary JSON: ${summaryPath}`);
  }

  const reportDir = path.join(REPORT_DIR, "security");
  mkdirSync(reportDir, { recursive: true });
  const runId = summary.findings?.find((finding) => finding.runId)?.runId ?? `security-${Date.now()}`;
  const outputPath = path.join(reportDir, `security-campaign-${runId}.html`);
  const latestPath = path.join(reportDir, "latest-security-summary.html");
  const html = buildSecurityHtml(summary, summaryPath, outputPath);
  writeFileSync(outputPath, html, "utf8");
  writeFileSync(latestPath, html, "utf8");
  return [outputPath, latestPath];
}

function renderLifecycleReport(summaryPath) {
  const summary = readJson(summaryPath);
  if (!summary) {
    throw new Error(`Unable to read lifecycle summary JSON: ${summaryPath}`);
  }

  const reportDir = path.join(REPORT_DIR, "lifecycle");
  mkdirSync(reportDir, { recursive: true });
  const runId = summary.runId ?? `${summary.campaign}-${Date.now()}`;
  const outputPath = path.join(reportDir, `lifecycle-campaign-${runId}.html`);
  const latestPath = path.join(reportDir, "latest-lifecycle-summary.html");
  const html = buildLifecycleHtml(summary, summaryPath, outputPath);
  writeFileSync(outputPath, html, "utf8");
  writeFileSync(latestPath, html, "utf8");
  return [outputPath, latestPath];
}

function buildSecurityHtml(summary, summaryPath, outputPath) {
  const phaseArtifacts = [
    path.join(SECURITY_CAMPAIGN_DIR, "access-control.json"),
    path.join(SECURITY_CAMPAIGN_DIR, "authentication.json"),
    path.join(SECURITY_CAMPAIGN_DIR, "injection.json"),
    path.join(SECURITY_CAMPAIGN_DIR, "lifecycle-security.json"),
    path.join(SECURITY_CAMPAIGN_DIR, "misconfiguration.json"),
    path.join(SECURITY_CAMPAIGN_DIR, "security-headers.json"),
    summaryPath
  ].filter((filePath, index, values) => existsSync(filePath) && values.indexOf(filePath) === index);
  const relatedArtifacts = collectSecurityRelatedArtifacts(summary);
  const screenshots = collectImagesFromJsonPaths([...phaseArtifacts, ...relatedArtifacts]).slice(0, 24);
  const runIds = summary.findings?.map((finding) => finding.runId).filter(Boolean) ?? [];
  const evidenceFiles = findEvidenceFiles(runIds).slice(0, 40);

  return pageShell({
    title: "INSSA Security Campaign Report",
    subtitle: `Status: ${summary.status ?? "unknown"} | Generated: ${summary.validatedAt ?? new Date().toISOString()}`,
    body: [
      section("Executive Summary", [
        statGrid([
          ["Status", summary.status ?? "unknown"],
          ["OWASP Baseline", summary.owaspTop10Command?.status ?? "unknown"],
          ["Critical", summary.riskCounts?.critical ?? 0],
          ["High", summary.riskCounts?.["high-risk"] ?? 0],
          ["Warnings", summary.riskCounts?.warning ?? 0],
          ["Info", summary.riskCounts?.info ?? 0]
        ]),
        paragraph("This report is generated from black-box staging evidence only. The campaign does not create capsules, attack infrastructure, brute-force credentials, or run against production.")
      ]),
      section("Findings By Risk", [riskList(summary.findings ?? [])]),
      section("Findings By Area", [securityAreaGroups(summary.findings ?? [])]),
      section("Evidence", [
        linkList("Artifact JSON", [...phaseArtifacts, ...relatedArtifacts], outputPath),
        linkList("Playwright Evidence", [PLAYWRIGHT_REPORT, ...evidenceFiles], outputPath),
        screenshotGallery(screenshots, outputPath)
      ]),
      section("Reproduction And Recommendations", [(summary.findings ?? []).map(formatSecurityFinding).join("\n") || "<p>No lifecycle findings were recorded.</p>"])
    ]
  });
}

function buildLifecycleHtml(summary, summaryPath, outputPath) {
  const artifacts = [
    summaryPath,
    summary.creationArtifactPath,
    summary.discoveryArtifactPath,
    summary.publicShareArtifactPath
  ].filter(Boolean).filter((filePath) => existsSync(filePath));
  const screenshots = collectImagesFromJsonPaths(artifacts).slice(0, 16);
  const evidenceFiles = findEvidenceFiles([summary.runId].filter(Boolean)).slice(0, 30);

  return pageShell({
    title: "INSSA Lifecycle Campaign Report",
    subtitle: `Campaign: ${summary.campaign ?? "unknown"} | Status: ${summary.status ?? "unknown"} | Run: ${summary.runId ?? "unknown"}`,
    body: [
      section("Executive Summary", [
        statGrid([
          ["Campaign", summary.campaign ?? "unknown"],
          ["Status", summary.status ?? "unknown"],
          ["Create", summary.creation?.status ?? "not-run"],
          ["Discovery", summary.discovery?.status ?? "not-run"],
          ["Public Share", summary.publicShare?.status ?? "not-run"],
          ["Visibility", summary.lifecycleVisibilityClassification ?? "unknown"]
        ]),
        paragraph(summary.cleanupInstruction ?? "Cleanup instruction was not recorded.")
      ]),
      section("Lifecycle Stages", [
        lifecycleStageTable(summary),
        warningList(summary.warnings ?? [])
      ]),
      section("Evidence", [
        linkList("Artifact JSON", artifacts, outputPath),
        linkList("Playwright Evidence", [PLAYWRIGHT_REPORT, ...evidenceFiles], outputPath),
        screenshotGallery(screenshots, outputPath)
      ]),
      section("Reproduction And Recommendations", [
        `<p><strong>Reproduction:</strong> run <code>npm run test:inssa:campaign:${escapeHtml(summary.campaign ?? "text")}</code> with staging live flags configured.</p>`,
        `<p><strong>Recommendation:</strong> preserve the lifecycle artifact and request manual cleanup for exact subject <code>${escapeHtml(summary.subject ?? "unknown")}</code>.</p>`
      ])
    ]
  });
}

function collectSecurityRelatedArtifacts(summary) {
  const paths = [];
  for (const finding of summary.findings ?? []) {
    for (const key of ["artifactPath", "discoveryArtifactPath", "publicShareArtifactPath"]) {
      if (finding[key] && existsSync(finding[key])) {
        paths.push(finding[key]);
      }
    }
  }
  return [...new Set(paths)];
}

function collectImagesFromJsonPaths(jsonPaths) {
  const images = [];
  for (const jsonPath of jsonPaths) {
    const json = readJson(jsonPath);
    if (!json) continue;
    for (const candidate of collectStringValues(json)) {
      if (isImagePath(candidate) && existsSync(candidate)) {
        images.push(candidate);
      }
    }
  }

  return [...new Set(images)];
}

function findEvidenceFiles(runIds) {
  if (!existsSync(TEST_RESULTS_DIR) || runIds.length === 0) {
    return [];
  }

  return walk(TEST_RESULTS_DIR)
    .filter((filePath) => /\.(?:png|webm|zip)$/i.test(filePath))
    .filter((filePath) => runIds.some((runId) => filePath.includes(runId)) || /inssa.*(?:security|lifecycle|capsule)/i.test(filePath));
}

function latestJsonFile(directory, predicate) {
  if (!existsSync(directory)) {
    return null;
  }

  const matches = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json") && predicate(fileName))
    .map((fileName) => path.join(directory, fileName))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  return matches[0] ?? null;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectStringValues(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectStringValues(entry, output));
    return output;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectStringValues(entry, output));
  }

  return output;
}

function walk(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(filePath));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

function isImagePath(value) {
  return /\.(?:png|jpe?g|webp)$/i.test(value);
}

function pageShell({ body, subtitle, title }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink:#17211b; --muted:#637067; --line:#d9e1da; --bg:#f7f4ed; --card:#fffdf8; --accent:#245b45; --high:#9a3412; --critical:#991b1b; }
    body { margin:0; font:14px/1.55 "Avenir Next", "Segoe UI", sans-serif; color:var(--ink); background:var(--bg); }
    header { padding:32px 40px 24px; background:linear-gradient(120deg,#173f32,#386b52); color:white; }
    h1 { margin:0 0 6px; font-size:32px; letter-spacing:-0.02em; }
    h2 { margin:0 0 16px; font-size:22px; }
    h3 { margin:18px 0 8px; }
    main { padding:28px 40px 56px; max-width:1180px; margin:auto; }
    section { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:22px; margin:0 0 18px; box-shadow:0 10px 28px rgba(23,33,27,.06); }
    code { background:#eef3ee; padding:2px 5px; border-radius:5px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th,td { text-align:left; vertical-align:top; border-bottom:1px solid var(--line); padding:9px; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
    a { color:var(--accent); }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
    .stat { border:1px solid var(--line); border-radius:14px; padding:12px; background:#faf8f2; }
    .stat b { display:block; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
    .finding { border-left:4px solid var(--accent); padding:10px 12px; margin:10px 0; background:#faf8f2; border-radius:10px; }
    .risk-critical { border-left-color:var(--critical); }
    .risk-high-risk, .risk-high { border-left-color:var(--high); }
    .gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px; }
    .shot { border:1px solid var(--line); border-radius:12px; padding:10px; background:white; }
    .shot img { width:100%; max-height:320px; object-fit:contain; display:block; background:#f2f2f2; }
    .muted { color:var(--muted); }
    pre { white-space:pre-wrap; background:#0f1b16; color:#e8f5ec; padding:14px; border-radius:12px; overflow:auto; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div>${escapeHtml(subtitle)}</div>
  </header>
  <main>${body.join("\n")}</main>
</body>
</html>
`;
}

function section(title, content) {
  return `<section><h2>${escapeHtml(title)}</h2>${content.join("\n")}</section>`;
}

function statGrid(rows) {
  return `<div class="stats">${rows
    .map(([label, value]) => `<div class="stat"><b>${escapeHtml(label)}</b>${escapeHtml(String(value))}</div>`)
    .join("")}</div>`;
}

function paragraph(value) {
  return `<p>${escapeHtml(value)}</p>`;
}

function riskList(findings) {
  const order = ["critical", "high-risk", "High", "Medium", "Low", "Informational", "warning", "info"];
  const normalized = findings.slice().sort((left, right) => order.indexOf(left.riskLevel ?? left.risk ?? "info") - order.indexOf(right.riskLevel ?? right.risk ?? "info"));
  return normalized.map(formatSecurityFinding).join("\n") || "<p>No findings recorded.</p>";
}

function securityAreaGroups(findings) {
  const groups = {
    "Access Control": [],
    Visibility: [],
    Authentication: [],
    "Media Access": [],
    "Token Behavior": [],
    "Lifecycle Security": []
  };
  for (const finding of findings) {
    const text = JSON.stringify(finding).toLowerCase();
    if (text.includes("media")) groups["Media Access"].push(finding);
    if (text.includes("token")) groups["Token Behavior"].push(finding);
    if (text.includes("visibility") || text.includes("indexed")) groups.Visibility.push(finding);
    if (text.includes("auth")) groups.Authentication.push(finding);
    if (text.includes("access") || text.includes("capsule")) groups["Access Control"].push(finding);
    groups["Lifecycle Security"].push(finding);
  }
  return Object.entries(groups)
    .map(([name, values]) => `<h3>${escapeHtml(name)}</h3>${values.map(formatSecurityFinding).join("\n") || "<p class=\"muted\">No findings in this group.</p>"}`)
    .join("\n");
}

function formatSecurityFinding(finding) {
  const risk = finding.riskLevel ?? finding.risk ?? "info";
  const summary = finding.summary ?? finding.finding ?? "No summary";
  return `<div class="finding risk-${escapeHtml(String(risk).toLowerCase())}">
    <h3>${escapeHtml(finding.lifecycleType ?? finding.owaspCategory ?? "Finding")} - ${escapeHtml(String(risk))}</h3>
    <p><strong>Finding:</strong> ${escapeHtml(summary)}</p>
    <p><strong>Evidence:</strong> ${escapeHtml(JSON.stringify({
      classifications: finding.securityClassifications,
      finalShareLink: redactToken(finding.finalShareLink),
      possibleFinalCapsuleId: finding.possibleFinalCapsuleId,
      status: finding.status,
      subject: finding.subject
    }))}</p>
    <p><strong>Reproduction:</strong> ${escapeHtml(finding.reproduction ?? "Run the security campaign against existing lifecycle artifacts on staging.")}</p>
    <p><strong>Affected Route:</strong> <code>${escapeHtml(finding.affectedRoute ?? "/capsule/<id> / share-link lifecycle")}</code></p>
    <p><strong>Classification:</strong> ${escapeHtml((finding.securityClassifications ?? [finding.classification]).filter(Boolean).join(", ") || "not-classified")}</p>
    <p><strong>Recommendation:</strong> ${escapeHtml(finding.recommendation ?? "Confirm intended product semantics with engineering/product and adjust pass/fail gates accordingly.")}</p>
  </div>`;
}

function lifecycleStageTable(summary) {
  const rows = [
    ["Create", summary.creation?.status ?? "not-run", summary.creationArtifactPath],
    ["Discovery", summary.discovery?.status ?? "not-run", summary.discoveryArtifactPath],
    ["Public Share", summary.publicShare?.status ?? "not-run", summary.publicShareArtifactPath],
    ["Visibility Classification", summary.lifecycleVisibilityClassification ?? "unknown", ""],
    ["Cleanup Requirements", summary.cleanupInstruction ?? "unknown", ""]
  ];

  return `<table><thead><tr><th>Stage</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows
    .map(([stage, status, evidence]) => `<tr><td>${escapeHtml(stage)}</td><td>${escapeHtml(status)}</td><td>${evidence ? `<code>${escapeHtml(evidence)}</code>` : ""}</td></tr>`)
    .join("")}</tbody></table>`;
}

function warningList(warnings) {
  if (warnings.length === 0) {
    return "<p>No warnings recorded.</p>";
  }

  return `<h3>Warnings</h3><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`;
}

function linkList(title, files, outputPath) {
  const unique = [...new Set(files.filter(Boolean).filter((filePath) => existsSync(filePath)))];
  if (unique.length === 0) {
    return `<h3>${escapeHtml(title)}</h3><p class="muted">No files found.</p>`;
  }

  return `<h3>${escapeHtml(title)}</h3><ul>${unique
    .map((filePath) => `<li><a href="${escapeHtml(relativeHref(outputPath, filePath))}">${escapeHtml(path.relative(ROOT, filePath))}</a></li>`)
    .join("")}</ul>`;
}

function screenshotGallery(files, outputPath) {
  const unique = [...new Set(files.filter(Boolean).filter((filePath) => existsSync(filePath)))];
  if (unique.length === 0) {
    return "<h3>Screenshots</h3><p class=\"muted\">No screenshots found in linked artifacts.</p>";
  }

  return `<h3>Screenshots</h3><div class="gallery">${unique
    .map((filePath) => {
      const dataUri = imageDataUri(filePath);
      const href = relativeHref(outputPath, filePath);
      return `<figure class="shot"><a href="${escapeHtml(href)}"><img src="${dataUri}" alt="${escapeHtml(path.basename(filePath))}"></a><figcaption>${escapeHtml(path.relative(ROOT, filePath))}</figcaption></figure>`;
    })
    .join("")}</div>`;
}

function imageDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

function relativeHref(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).replaceAll(path.sep, "/");
}

function redactToken(value) {
  if (!value) return value;
  return String(value).replace(/([?&]token=)[^&]+/i, "$1<redacted>");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
