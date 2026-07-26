const fs = require("fs");
const path = require("path");

const resultsDir = path.resolve(__dirname, "../results");
const profiles = [
  { key: "small", label: "10 users", vus: 10 },
  { key: "medium", label: "25 users", vus: 25 },
  { key: "large", label: "50 users", vus: 50 },
  { key: "event", label: "100 users", vus: 100 },
  { key: "stress150", label: "150 users", vus: 150 },
  { key: "stress200", label: "200 users", vus: 200 }
];

const reports = profiles
  .map((profile) => {
    const file = path.join(resultsDir, `${profile.key}-summary.json`);
    if (!fs.existsSync(file)) return null;
    return {
      ...profile,
      file,
      report: JSON.parse(fs.readFileSync(file, "utf8"))
    };
  })
  .filter(Boolean);

const highestPassed = reports.filter((entry) => entry.report.status === "PASS").slice(-1)[0] || null;
const highestCompletedCapacity = reports.filter((entry) => entry.report.status !== "FAIL").slice(-1)[0] || null;
const highestCompleted = reports.slice(-1)[0] || null;
const bottleneck = findBottleneck(highestCompleted?.report);
const degradation = analyzeDegradation(reports);
const firstLatencyDegradation = reports.find((entry) => entry.report.status === "DEGRADED") || null;
const firstErrors = reports.find((entry) => (entry.report.http4xx || 0) > 0 || (entry.report.http5xx || 0) > 0 || (entry.report.failedAuthentications || 0) > 0) || null;
const recommendation = buildRecommendation(highestPassed, highestCompletedCapacity, highestCompleted);
const accountReuseEnabled = reports.some((entry) => entry.report.accountReuseEnabled);
const accountReuseWarning =
  "Account reuse was enabled for this test. Results represent authentication pipeline and infrastructure capacity under concurrent sessions, not unique-user capacity.";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>INSSA Authentication Final Capacity Report</title>
  <style>
    :root { color-scheme: dark; --bg:#07101d; --panel:#111c2e; --line:#263850; --text:#edf4ff; --muted:#9fb0c6; --green:#35d07f; --yellow:#ffd166; --red:#ff5c6c; --cyan:#55d6ff; }
    body { margin:0; background:linear-gradient(135deg,#07101d,#0e1828); color:var(--text); font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:1240px; margin:0 auto; padding:34px; }
    h1,h2 { margin:0 0 10px; }
    .muted { color:var(--muted); }
    .card { background:rgba(17,28,46,.92); border:1px solid var(--line); border-radius:14px; padding:18px; margin:16px 0; box-shadow:0 12px 40px rgba(0,0,0,.24); }
    table { width:100%; border-collapse:collapse; }
    th,td { border-bottom:1px solid var(--line); padding:10px 8px; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.07em; }
    .pill { display:inline-flex; border-radius:999px; padding:4px 10px; font-weight:700; font-size:12px; }
    .PASS { background:rgba(53,208,127,.16); color:var(--green); border:1px solid rgba(53,208,127,.38); }
    .FAIL { background:rgba(255,92,108,.16); color:var(--red); border:1px solid rgba(255,92,108,.38); }
    .DEGRADED { background:rgba(255,209,102,.16); color:var(--yellow); border:1px solid rgba(255,209,102,.38); }
    .WARN { background:rgba(255,209,102,.16); color:var(--yellow); border:1px solid rgba(255,209,102,.38); }
    svg { width:100%; height:auto; background:#0a1424; border:1px solid var(--line); border-radius:12px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  </style>
</head>
<body>
<main>
  <section class="card">
    <h1>INSSA Authentication Final Capacity Report</h1>
    <p class="muted">Generated ${escapeHtml(new Date().toISOString())}. This report only summarizes completed k6 profiles in this run folder.</p>
    <p><span class="pill ${highestCompletedCapacity ? (highestCompletedCapacity.report.status === "PASS" ? "PASS" : "DEGRADED") : "FAIL"}">${highestCompletedCapacity ? `HIGHEST COMPLETED: ${highestCompletedCapacity.vus} VUS` : "NO COMPLETED CAPACITY STAGE"}</span></p>
  </section>

  ${accountReuseEnabled ? `<section class="card"><p><span class="pill WARN">ACCOUNT REUSE ENABLED</span></p><p>${escapeHtml(accountReuseWarning)}</p></section>` : ""}

  <section class="card">
    <h2>Executive Summary</h2>
    <p>${escapeHtml(recommendation)}</p>
    <p><strong>Bottleneck:</strong> ${escapeHtml(bottleneck)}</p>
    <p><strong>Concurrency trend:</strong> ${escapeHtml(degradation)}</p>
    <p><strong>First latency degradation:</strong> ${escapeHtml(firstLatencyDegradation ? firstLatencyDegradation.label : "None observed in completed stages.")}</p>
    <p><strong>First errors:</strong> ${escapeHtml(firstErrors ? firstErrors.label : "No auth, HTTP 4xx, or HTTP 5xx errors observed in completed stages.")}</p>
  </section>

  <section class="card">
    <h2>Comparison Table</h2>
    <table>
      <thead><tr><th>Stage</th><th>Status</th><th>Max VUs</th><th>Success</th><th>Avg</th><th>p95</th><th>p99</th><th>HTTP Fail</th><th>4xx</th><th>5xx</th><th>Report</th></tr></thead>
      <tbody>${reports.map(row).join("")}</tbody>
    </table>
  </section>

  <section class="grid">
    <div class="card"><h2>p95 Trend</h2>${lineChart(reports.map((entry) => entry.report.responseTimes.p95 || 0), reports.map((entry) => entry.label), "ms")}</div>
    <div class="card"><h2>Success Rate Trend</h2>${lineChart(reports.map((entry) => (entry.report.authenticationSuccessRate || 0) * 100), reports.map((entry) => entry.label), "%")}</div>
    <div class="card"><h2>Requests Per Second</h2>${barChart(reports.map((entry) => ({ label: entry.label, value: entry.report.requestsPerSecond || 0, color: "#55d6ff" })))}</div>
    <div class="card"><h2>Authentication Pipeline Timings</h2>${barChart(stageBars(highestCompleted?.report))}</div>
  </section>

  <section class="card">
    <h2>Warnings</h2>
    <ul>${warnings(reports).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("") || "<li>No warnings from completed summaries.</li>"}</ul>
  </section>
</main>
</body>
</html>`;

fs.mkdirSync(resultsDir, { recursive: true });
fs.writeFileSync(path.join(resultsDir, "final-performance-report.html"), html);
fs.writeFileSync(path.join(resultsDir, "final-capacity-report.html"), html);
console.log(JSON.stringify({
  report: path.join(resultsDir, "final-capacity-report.html"),
  legacyReport: path.join(resultsDir, "final-performance-report.html"),
  stages: reports.map((entry) => entry.key),
  highestPassingVus: highestPassed?.vus || 0,
  highestCompletedCapacityVus: highestCompletedCapacity?.vus || 0,
  highestAttemptedVus: highestCompleted?.vus || 0
}));

function row(entry) {
  const report = entry.report;
  return `<tr><td>${escapeHtml(entry.label)}</td><td><span class="pill ${report.status}">${escapeHtml(report.capacityClassification || report.status)}</span></td><td>${entry.vus}</td><td>${pct(report.authenticationSuccessRate)}</td><td>${num(report.responseTimes.avg)}ms</td><td>${num(report.responseTimes.p95)}ms</td><td>${num(report.responseTimes.p99)}ms</td><td>${pct(report.httpFailureRate)}</td><td>${report.http4xx}</td><td>${report.http5xx}</td><td>${escapeHtml(`${entry.key}-summary.html`)}</td></tr>`;
}

function findBottleneck(report) {
  if (!report) return "No completed profile data available.";
  const stages = Object.entries(report.stageTimings || {}).map(([key, timing]) => ({ key, avg: timing.avg || 0 }));
  stages.sort((a, b) => b.avg - a.avg);
  if (!stages[0]) return "No stage timing data available.";
  return `${stageLabel(stages[0].key)} had the highest average latency in the latest completed profile (${num(stages[0].avg)}ms).`;
}

function analyzeDegradation(entries) {
  if (entries.length < 2) return "Only one profile completed, so concurrency degradation cannot be assessed.";
  const first = entries[0].report.responseTimes.p95 || 0;
  const last = entries[entries.length - 1].report.responseTimes.p95 || 0;
  if (!first) return "Baseline p95 was unavailable.";
  const change = ((last - first) / first) * 100;
  if (change > 20) return `p95 increased by ${num(change)}% from first to latest completed profile.`;
  if (change < -10) return `p95 improved by ${num(Math.abs(change))}% from first to latest completed profile.`;
  return `p95 changed by ${num(change)}%, which does not show material degradation.`;
}

function buildRecommendation(highestPassed, highestCompletedCapacity, highestCompleted) {
  if (highestCompletedCapacity) {
    const passingText = highestPassed ? ` The highest latency-clean stage was ${highestPassed.label}.` : " No stage met the latency targets.";
    return `The highest completed capacity characterization stage was ${highestCompletedCapacity.label}. This does not certify support for that concurrency; it characterizes observed staging behavior under account reuse.${passingText}`;
  }
  if (highestCompleted) return `The latest attempted profile ${highestCompleted.label} failed critical capacity safety gates. Stop testing and review failures before increasing load.`;
  return "No completed k6 profile summaries were found.";
}

function warnings(entries) {
  const result = [];
  for (const entry of entries) {
    const report = entry.report;
    if (report.status === "DEGRADED") result.push(`${entry.label} completed with degraded latency performance.`);
    if (report.status === "FAIL") result.push(`${entry.label} failed critical capacity safety gates.`);
    if ((report.http5xx || 0) > 0) result.push(`${entry.label} recorded ${report.http5xx} 5xx responses.`);
    if ((report.http4xx || 0) > 0) result.push(`${entry.label} recorded ${report.http4xx} 4xx responses.`);
    if ((report.authenticationSuccessRate || 0) < 1) result.push(`${entry.label} had authentication success below 100%.`);
  }
  return result;
}

function stageBars(report) {
  if (!report) return [];
  return Object.entries(report.stageTimings || {}).map(([key, timing]) => ({ label: stageLabel(key), value: timing.avg || 0, color: "#55d6ff" }));
}

function lineChart(values, labels, unit) {
  const cleaned = values.map((value) => Number.isFinite(value) ? value : 0);
  const max = Math.max(1, ...cleaned);
  const points = cleaned.map((value, index) => `${35 + index * (520 / Math.max(1, cleaned.length - 1))},${230 - (value / max) * 180}`).join(" ");
  const dots = cleaned.map((value, index) => `<circle cx="${35 + index * (520 / Math.max(1, cleaned.length - 1))}" cy="${230 - (value / max) * 180}" r="4" fill="#55d6ff"><title>${escapeHtml(labels[index])}: ${num(value)}${unit}</title></circle>`).join("");
  const axis = labels.map((label, index) => `<text x="${35 + index * (520 / Math.max(1, labels.length - 1))}" y="260" text-anchor="middle" fill="#9fb0c6" font-size="10">${escapeHtml(label)}</text>`).join("");
  return `<svg viewBox="0 0 590 280"><polyline fill="none" stroke="#55d6ff" stroke-width="3" points="${points}" />${dots}${axis}</svg>`;
}

function barChart(items) {
  const max = Math.max(1, ...items.map((item) => item.value || 0));
  const height = Math.max(90, 38 * Math.max(1, items.length) + 30);
  const bars = items.map((item, index) => {
    const y = 24 + index * 38;
    const width = Math.max(2, ((item.value || 0) / max) * 340);
    return `<text x="18" y="${y + 15}" fill="#edf4ff" font-size="12">${escapeHtml(item.label)}</text><rect x="205" y="${y}" width="${width}" height="20" rx="6" fill="${item.color}" /><text x="${215 + width}" y="${y + 15}" fill="#9fb0c6" font-size="12">${num(item.value)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 590 ${height}">${bars}</svg>`;
}

function stageLabel(value) {
  return {
    firebaseLogin: "Firebase Login",
    firebaseLookup: "Firebase Lookup",
    socialLoginJwt: "SocialLoginJWT",
    socialAuthenticate: "SocialAuthenticate",
    getUserProfileByEmail: "GetUserProfileByEmail"
  }[value] || value;
}

function pct(value) {
  return `${num((value || 0) * 100)}%`;
}

function num(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2).replace(/\.00$/, "") : "0";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
