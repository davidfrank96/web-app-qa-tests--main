#!/usr/bin/env node

const { createHash } = require("crypto");
const { existsSync, mkdirSync, readdirSync, readFileSync, statSync } = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DEFAULT_OUTPUT_PATH = path.resolve(ROOT, "reports", "siem", "latest-siem-export.json");
const EVENT_SCHEMA_VERSION = "inssa-qa-siem.v1";
const EVENT_TYPES = new Set([
  "release_gate",
  "lifecycle_campaign",
  "security_campaign",
  "discovery_campaign",
  "cleanup_audit",
  "campaign_summary"
]);

const SEVERITY_TO_WAZUH_LEVEL = {
  informational: 3,
  low: 5,
  medium: 7,
  high: 10,
  critical: 14
};

const RISK_TO_SEVERITY = {
  info: "informational",
  informational: "informational",
  low: "low",
  warning: "medium",
  medium: "medium",
  "high-risk": "high",
  high: "high",
  critical: "critical"
};

const DISALLOWED_REFERENCE_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".png",
  ".trace",
  ".webm",
  ".zip"
]);

if (require.main === module) {
  const outputPath = getArgValue("--output") ?? null;
  const pretty = process.argv.includes("--pretty");
  const exportPayload = normalizeAllCampaignOutputs();
  const json = JSON.stringify(exportPayload, null, pretty ? 2 : 0);
  if (outputPath) {
    mkdirSync(path.dirname(path.resolve(ROOT, outputPath)), { recursive: true });
    require("fs").writeFileSync(path.resolve(ROOT, outputPath), `${json}\n`, "utf8");
    console.log(`SIEM normalized export written: ${path.resolve(ROOT, outputPath)}`);
  } else {
    console.log(json);
  }
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  SEVERITY_TO_WAZUH_LEVEL,
  normalizeAllCampaignOutputs,
  normalizeCleanupAuditEvents,
  normalizeDiscoveryCampaignEvents,
  normalizeLifecycleArtifactEvents,
  normalizeLifecycleCampaignEvents,
  normalizeCampaignSummaryEvents,
  normalizeReleaseGateEvents,
  normalizeSecurityCampaignEvents,
  redactSensitiveString,
  toWazuhCompatibleEvent
};

function normalizeAllCampaignOutputs(options = {}) {
  const generatedAt = new Date().toISOString();
  const events = [
    ...normalizeReleaseGateEvents(generatedAt),
    ...normalizeLifecycleCampaignEvents(generatedAt),
    ...normalizeLifecycleArtifactEvents(generatedAt),
    ...normalizeSecurityCampaignEvents(generatedAt),
    ...normalizeDiscoveryCampaignEvents(generatedAt),
    ...normalizeCleanupAuditEvents(generatedAt),
    ...normalizeCampaignSummaryEvents(generatedAt)
  ].map(toWazuhCompatibleEvent);

  const payload = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    generatedAt,
    source: "web-app-qa-tests",
    product: "INSSA",
    metadataOnly: true,
    mediaUploadPolicy: "screenshots-videos-traces-excluded",
    eventTypes: [...EVENT_TYPES],
    eventCount: events.length,
    severityCounts: countBy(events, (event) => event.severity),
    statusCounts: countBy(events, (event) => event.status),
    events
  };

  if (options.includeDashboardFields === false) {
    for (const event of payload.events) {
      delete event.dashboardFields;
    }
  }

  return payload;
}

function normalizeReleaseGateEvents(timestamp) {
  const candidates = [
    path.resolve(ROOT, "docs", "release-gate-gitignore-audit.md")
  ].filter(existsSync);

  return candidates.map((reportPath) => {
    const text = readText(reportPath);
    const verdict = extractVerdict(text);
    const severity = verdict === "BLOCKED" ? "critical" : verdict === "PASS WITH WARNINGS" ? "medium" : "informational";
    const status = verdict === "BLOCKED" ? "failed" : verdict === "PASS WITH WARNINGS" ? "passed-with-warnings" : "passed";
    return createEvent({
      artifactPath: null,
      campaign: "release-gate",
      classification: "gitignore-secrets-audit",
      environment: "repository",
      eventType: "release_gate",
      findings: [
        finding({
          classification: "gitignore-secrets-audit",
          description: summarizeTextLine(text, "The audit found") ?? "Release-gate gitignore and secrets audit completed.",
          severity,
          status
        })
      ],
      reportPath,
      severity,
      status,
      timestamp
    });
  });
}

function normalizeLifecycleCampaignEvents(timestamp) {
  return jsonFiles(path.resolve(ROOT, "lifecycle-campaigns"))
    .filter((filePath) => /-campaign-[^.]+\.json$/i.test(path.basename(filePath)))
    .map((filePath) => {
      const summary = readJson(filePath);
      if (!summary) return null;
      const severity = lifecycleSeverity(summary);
      const classification =
        summary.lifecycleVisibilityClassification ||
        summary.lifecycleNetworkClassification ||
        summary.creationLifecycleClassification ||
        summary.status ||
        "unknown";

      const findings = [];
      for (const warning of summary.warnings ?? []) {
        findings.push(finding({
          classification: classifyWarningText(warning),
          description: warning,
          severity: warningSeverity(warning),
          status: "warning"
        }));
      }

      if (summary.failurePhase) {
        findings.push(finding({
          classification: `failure:${summary.failurePhase}`,
          description: `Lifecycle campaign failed in phase: ${summary.failurePhase}.`,
          severity: "critical",
          status: "failed"
        }));
      }

      const reportPath = findLifecycleReport(summary);
      const event = createEvent({
        artifactPath: filePath,
        campaign: summary.campaign ?? inferCampaignFromFile(filePath),
        classification,
        environment: "staging",
        eventType: "lifecycle_campaign",
        findings,
        reportPath,
        runId: summary.runId,
        severity,
        status: normalizeStatus(summary.status),
        timestamp
      });

      event.lifecycle = compactObject({
        authenticatedSurfaceIndexed: summary.authenticatedSurfaceIndexed,
        authenticatedSurfaceUndiscoverable: summary.authenticatedSurfaceUndiscoverable,
        cleanAccessVisible: summary.cleanAccessVisible,
        directShareAccessible: summary.directShareAccessible,
        lifecycleNetworkClassification: summary.lifecycleNetworkClassification,
        loggedOutAccessVisible: summary.loggedOutAccessVisible,
        publicShareLifecycleStatus: summary.publicShareLifecycleStatus,
        tokenlessAccessClassification: summary.tokenlessAccessClassification,
        tokenizedAccess: summary.tokenizedAccess
      });

      return event;
    })
    .filter(Boolean);
}

function normalizeLifecycleArtifactEvents(timestamp) {
  const campaignRunIds = new Set(
    jsonFiles(path.resolve(ROOT, "lifecycle-campaigns"))
      .map(readJson)
      .filter(Boolean)
      .map((summary) => summary.runId)
      .filter(Boolean)
  );

  return jsonFiles(path.resolve(ROOT, "lifecycle-artifacts"))
    .map((filePath) => {
      const artifact = readJson(filePath);
      if (!artifact || !artifact.runId || campaignRunIds.has(artifact.runId)) {
        return null;
      }

      const campaign = inferCampaignFromArtifact(artifact);
      const status = artifact.observedCreateSuccess === true ? "passed" : "failed";
      const severity = artifact.observedCreateSuccess === true ? networkSeverity(artifact) : "critical";
      const classification =
        artifact.lifecycleClassification ||
        artifact.lifecycleNetworkClassification ||
        (artifact.observedCreateSuccess ? "finalized" : "finalization-failed");

      return createEvent({
        artifactPath: filePath,
        campaign,
        classification,
        environment: artifact.environment ?? "staging",
        eventType: "lifecycle_campaign",
        findings: networkFindings(artifact),
        reportPath: null,
        runId: artifact.runId,
        severity,
        status,
        timestamp: artifact.createdAt ?? timestamp
      });
    })
    .filter(Boolean);
}

function normalizeSecurityCampaignEvents(timestamp) {
  return jsonFiles(path.resolve(ROOT, "security-campaigns"))
    .map((filePath) => {
      const summary = readJson(filePath);
      if (!summary) return null;

      if (Array.isArray(summary.findings)) {
        return normalizeSecuritySummary(filePath, summary, timestamp);
      }

      return normalizeSecurityPhase(filePath, summary, timestamp);
    })
    .filter(Boolean);
}

function normalizeDiscoveryCampaignEvents(timestamp) {
  const phaseDir = path.resolve(ROOT, "test-results", "inssa-live-capsule-artifacts");
  return jsonFiles(phaseDir)
    .filter((filePath) => /authenticated-discovery\.json$/i.test(path.basename(filePath)))
    .map((filePath) => {
      const summary = readJson(filePath);
      if (!summary) return null;

      const hardFailure = Boolean(summary.hardFailure);
      const directShareAccessible = Boolean(summary.directShareAccessible || summary.authenticatedDirectRetrieval);
      const severity = hardFailure ? "critical" : directShareAccessible ? "informational" : "high";
      const classification =
        summary.lifecycleVisibilityClassification ||
        summary.outcomeClassification ||
        (hardFailure ? "discovery-hard-failure" : "discovery-classified");

      return createEvent({
        artifactPath: filePath,
        campaign: "authenticated-discovery",
        classification,
        environment: "staging",
        eventType: "discovery_campaign",
        findings: [
          finding({
            classification,
            description: summary.outcomeClassification || summary.lifecycleVisibilityClassification || "Discovery campaign completed.",
            severity,
            status: hardFailure ? "failed" : "classified"
          })
        ],
        reportPath: null,
        runId: summary.runId,
        severity,
        status: hardFailure ? "failed" : "passed",
        timestamp: summary.checkedAt ?? timestamp
      });
    })
    .filter(Boolean);
}

function normalizeCleanupAuditEvents(timestamp) {
  const phaseDir = path.resolve(ROOT, "test-results", "inssa-live-capsule-artifacts");
  const files = [
    ...jsonFiles(phaseDir).filter((filePath) => /cleanup.*audit|cleanup-capability/i.test(path.basename(filePath))),
    ...jsonFiles(path.resolve(ROOT, "lifecycle-investigations")).filter((filePath) => /cleanup-capability\.json$/i.test(path.basename(filePath)))
  ];

  return files.map((filePath) => {
    const summary = readJson(filePath);
    if (!summary) return null;

    const cleanupPossible = Boolean(summary.cleanupPossible || summary.uiCleanupPossible || summary.automationCandidate);
    const severity = cleanupPossible ? "informational" : "medium";
    const classification =
      summary.cleanupFeasibility ||
      summary.cleanupClassification ||
      (cleanupPossible ? "ui-cleanup-possible" : "manual-dev-cleanup-required");

    return createEvent({
      artifactPath: filePath,
      campaign: "cleanup-audit",
      classification,
      environment: "staging",
      eventType: "cleanup_audit",
      findings: [
        finding({
          classification,
          description: summary.cleanupInstruction || "Cleanup audit completed; destructive cleanup was not performed.",
          severity,
          status: cleanupPossible ? "available" : "manual-action-required"
        })
      ],
      reportPath: null,
      runId: summary.runId,
      severity,
      status: summary.status ?? "classified",
      timestamp: summary.checkedAt ?? summary.generatedAt ?? timestamp
    });
  }).filter(Boolean);
}

function normalizeCampaignSummaryEvents(timestamp) {
  return [
    ...normalizeSecurityCampaignSummaryEvents(timestamp),
    ...normalizeCrossUserCampaignSummaryEvents(timestamp),
    ...normalizeRevealLaterCampaignSummaryEvents(timestamp),
    ...normalizeReleaseGateSummaryEvents(timestamp)
  ].filter(Boolean);
}

function normalizeSecurityCampaignSummaryEvents(timestamp) {
  return jsonFiles(path.resolve(ROOT, "security-campaigns"))
    .filter((filePath) => {
      const fileName = path.basename(filePath);
      return fileName === "lifecycle-security.json" || /-security\.json$/i.test(fileName);
    })
    .map((filePath) => {
      const summary = readJson(filePath);
      if (!summary) return null;

      const counts = severityCountsFromSecuritySummary(summary);
      return createCampaignSummaryEvent({
        artifactPath: filePath,
        campaign: "security",
        classification: "security-campaign-summary",
        completedAt: summary.generatedAt ?? summary.validatedAt ?? timestamp,
        counts,
        environment: "staging",
        reportPath: findSecurityReport(summary) ?? findLatestSecurityReport(),
        runId: summary.findings?.find((entry) => entry.runId)?.runId ?? extractRunId(filePath),
        startedAt: summary.startedAt ?? summary.createdAt ?? null,
        status: normalizeStatus(summary.status ?? "classified"),
        timestamp
      });
    });
}

function normalizeCrossUserCampaignSummaryEvents(timestamp) {
  const filePath = path.resolve(ROOT, "security-campaigns", "cross-user", "latest-cross-user-verification.json");
  const summary = readJson(filePath);
  if (!summary) return [];

  const severity = riskToSeverity(summary.riskLevel);
  return [
    createCampaignSummaryEvent({
      artifactPath: filePath,
      campaign: "cross-user",
      classification: summary.classifications?.isolation ?? "cross-user-summary",
      completedAt: summary.completedAt ?? summary.generatedAt ?? summary.createdAt ?? timestamp,
      counts: severityCountObject(severity),
      environment: summary.environment ?? "staging",
      reportPath: path.resolve(ROOT, "reports", "security", "cross-user-security.html"),
      runId: summary.runId,
      startedAt: summary.startedAt ?? null,
      status: summary.hardFailure ? "failed" : "passed",
      timestamp
    })
  ];
}

function normalizeRevealLaterCampaignSummaryEvents(timestamp) {
  const filePath = path.resolve(ROOT, "security-campaigns", "reveal-later", "latest-reveal-later-security.json");
  const summary = readJson(filePath);
  if (!summary) return [];

  const severity = riskToSeverity(summary.riskLevel);
  return [
    createCampaignSummaryEvent({
      artifactPath: filePath,
      campaign: "reveal-later",
      classification: summary.lifecycle?.revealLaterFlowClassification ?? "reveal-later-summary",
      completedAt: summary.completedAt ?? summary.generatedAt ?? summary.createdAt ?? timestamp,
      counts: severityCountObject(severity),
      environment: summary.environment ?? "staging",
      reportPath: summary.accessControlReportPath ?? path.resolve(ROOT, "reports", "security", "reveal-later-security.html"),
      runId: summary.lifecycle?.runId ?? extractRunId(filePath),
      startedAt: summary.startedAt ?? null,
      status: summary.hardFailure ? "failed" : "passed",
      timestamp
    })
  ];
}

function normalizeReleaseGateSummaryEvents(timestamp) {
  const reportPath = path.resolve(ROOT, "docs", "release-gate-gitignore-audit.md");
  if (!existsSync(reportPath)) return [];

  const text = readText(reportPath);
  const verdict = extractVerdict(text);
  const severity = verdict === "BLOCKED" ? "critical" : verdict === "PASS WITH WARNINGS" ? "medium" : "informational";

  return [
    createCampaignSummaryEvent({
      artifactPath: null,
      campaign: "release-gate",
      classification: "release-gate-summary",
      completedAt: timestamp,
      counts: severityCountObject(severity),
      environment: "repository",
      reportPath,
      runId: "release-gate",
      startedAt: null,
      status: verdict === "BLOCKED" ? "failed" : verdict === "PASS WITH WARNINGS" ? "passed-with-warnings" : "passed",
      timestamp
    })
  ];
}

function createCampaignSummaryEvent({
  artifactPath,
  campaign,
  classification,
  completedAt,
  counts,
  environment,
  reportPath,
  runId,
  startedAt,
  status,
  timestamp
}) {
  const normalizedCounts = normalizeSeverityCounts(counts);
  const severity = highestSeverityFromCounts(normalizedCounts);
  const event = createEvent({
    artifactPath,
    campaign,
    classification,
    environment,
    eventType: "campaign_summary",
    findings: [],
    reportPath: existsSync(String(reportPath ?? "")) ? reportPath : null,
    runId,
    severity,
    status,
    timestamp: completedAt ?? timestamp
  });

  const duration = durationMs(startedAt, completedAt);
  event.campaignSummary = compactObject({
    campaign: redactSensitiveString(campaign),
    runId: redactSensitiveString(runId ?? null),
    status: normalizeStatus(status),
    critical: normalizedCounts.critical,
    high: normalizedCounts.high,
    medium: normalizedCounts.medium,
    low: normalizedCounts.low,
    duration,
    startedAt: startedAt ?? null,
    completedAt: completedAt ?? timestamp
  });
  event.dashboardFields = {
    ...event.dashboardFields,
    ...event.campaignSummary
  };

  return event;
}

function normalizeSecuritySummary(filePath, summary, timestamp) {
  const severity = securitySummarySeverity(summary);
  const classifications = uniqueStrings(
    (summary.findings ?? []).flatMap((entry) => entry.securityClassifications ?? [])
  );
  const classification = classifications.length > 0 ? classifications.join(",") : summary.status ?? "security-campaign";
  const findings = (summary.findings ?? []).map((entry) => finding({
    classification: (entry.securityClassifications ?? [entry.lifecycleType ?? "security-finding"])[0],
    description: entry.summary ?? `${entry.lifecycleType ?? "security"} finding`,
    severity: riskToSeverity(entry.riskLevel),
    status: normalizeStatus(entry.status)
  }));

  return createEvent({
    artifactPath: filePath,
    campaign: "security",
    classification,
    environment: summary.environment ?? "staging",
    eventType: "security_campaign",
    findings,
    reportPath: findSecurityReport(summary),
    runId: summary.findings?.find((entry) => entry.runId)?.runId,
    severity,
    status: normalizeStatus(summary.status),
    timestamp: summary.validatedAt ?? summary.generatedAt ?? timestamp
  });
}

function normalizeSecurityPhase(filePath, summary, timestamp) {
  const fileName = path.basename(filePath, ".json");
  const severity = securityPhaseSeverity(summary);
  const classification =
    summary.owaspCategory ||
    (Array.isArray(summary.owaspCategories) ? summary.owaspCategories.join(",") : null) ||
    fileName;

  const findings = [];
  for (const entry of extractSecurityPhaseFindings(summary, fileName)) {
    findings.push(finding(entry));
  }

  return createEvent({
    artifactPath: filePath,
    campaign: fileName,
    classification,
    environment: "staging",
    eventType: "security_campaign",
    findings,
    reportPath: findLatestSecurityReport(),
    runId: summary.runId,
    severity,
    status: normalizeStatus(summary.status ?? "classified"),
    timestamp: summary.generatedAt ?? timestamp
  });
}

function createEvent({
  artifactPath,
  campaign,
  classification,
  environment,
  eventType,
  findings,
  reportPath,
  runId,
  severity,
  status,
  timestamp
}) {
  if (!EVENT_TYPES.has(eventType)) {
    throw new Error(`Unsupported SIEM event type: ${eventType}`);
  }

  const normalizedSeverity = normalizeSeverity(severity);
  const normalizedStatus = normalizeStatus(status);
  const artifactReference = artifactPath ? fileReference(artifactPath) : null;
  const reportReference = reportPath ? fileReference(reportPath) : null;

  return compactObject({
    schemaVersion: EVENT_SCHEMA_VERSION,
    source: "web-app-qa-tests",
    product: "INSSA",
    eventType,
    timestamp: timestamp ?? new Date().toISOString(),
    campaign: redactSensitiveString(campaign ?? "unknown"),
    environment: redactSensitiveString(environment ?? "unknown"),
    severity: normalizedSeverity,
    classification: redactSensitiveString(classification ?? "unknown"),
    status: normalizedStatus,
    runId: redactSensitiveString(runId ?? artifactReference?.runId ?? null),
    artifactReference,
    reportReference,
    findings: sanitizeValue(findings ?? []),
    dashboardFields: {
      artifact: artifactReference?.path ?? null,
      campaign: redactSensitiveString(campaign ?? "unknown"),
      classification: redactSensitiveString(classification ?? "unknown"),
      environment: redactSensitiveString(environment ?? "unknown"),
      eventType,
      report: reportReference?.path ?? null,
      runId: redactSensitiveString(runId ?? artifactReference?.runId ?? null),
      severity: normalizedSeverity,
      status: normalizedStatus
    }
  });
}

function toWazuhCompatibleEvent(event) {
  const severity = normalizeSeverity(event.severity);
  return {
    ...event,
    wazuh: {
      decoder: "json",
      integration: "inssa_qa_campaigns",
      rule: {
        level: SEVERITY_TO_WAZUH_LEVEL[severity],
        groups: ["inssa", "qa", event.eventType, severity],
        description: `INSSA QA ${event.eventType}: ${event.campaign} ${event.status} (${event.classification})`
      }
    }
  };
}

function fileReference(filePath) {
  if (!filePath) return null;
  const absolutePath = path.resolve(ROOT, filePath);
  const extension = path.extname(absolutePath).toLowerCase();
  if (DISALLOWED_REFERENCE_EXTENSIONS.has(extension)) {
    return null;
  }

  const relativePath = path.relative(ROOT, absolutePath);
  return compactObject({
    exists: existsSync(absolutePath),
    fileName: redactSensitiveString(path.basename(absolutePath)),
    kind: extension.replace(".", "") || "file",
    path: redactSensitiveString(relativePath),
    sha256: existsSync(absolutePath) && statSync(absolutePath).isFile() ? sha256File(absolutePath) : null,
    runId: extractRunId(relativePath)
  });
}

function finding({ classification, description, severity, status }) {
  return compactObject({
    classification: redactSensitiveString(classification ?? "unknown"),
    description: redactSensitiveString(description ?? ""),
    severity: normalizeSeverity(severity),
    status: normalizeStatus(status ?? "classified")
  });
}

function lifecycleSeverity(summary) {
  if (summary.status === "failed" || summary.failurePhase) return "critical";
  if (summary.tokenlessAccessClassification === "content-visible") return "high";
  if (summary.status === "passed-with-warnings" || (summary.warnings ?? []).length > 0) return "medium";
  return "informational";
}

function networkSeverity(artifact) {
  const fatalCount = Array.isArray(artifact.fatalNetworkIssues)
    ? artifact.fatalNetworkIssues.length
    : artifact.requestFailureSummary?.fatal ?? 0;
  if (fatalCount > 0) return "critical";
  const warningCount = Array.isArray(artifact.warningNetworkIssues)
    ? artifact.warningNetworkIssues.length
    : artifact.requestFailureSummary?.warning ?? 0;
  return warningCount > 0 || artifact.lifecycleSucceededDespiteWarnings ? "medium" : "informational";
}

function networkFindings(artifact) {
  const findings = [];
  const fatalCount = Array.isArray(artifact.fatalNetworkIssues)
    ? artifact.fatalNetworkIssues.length
    : artifact.requestFailureSummary?.fatal ?? 0;
  const warningCount = Array.isArray(artifact.warningNetworkIssues)
    ? artifact.warningNetworkIssues.length
    : artifact.requestFailureSummary?.warning ?? 0;

  if (fatalCount > 0) {
    findings.push(finding({
      classification: "fatal-network-issues",
      description: `Lifecycle artifact recorded ${fatalCount} fatal network issue(s).`,
      severity: "critical",
      status: "failed"
    }));
  }
  if (warningCount > 0) {
    findings.push(finding({
      classification: "warning-network-issues",
      description: `Lifecycle artifact recorded ${warningCount} warning network issue(s).`,
      severity: "medium",
      status: "warning"
    }));
  }

  return findings;
}

function securitySummarySeverity(summary) {
  const counts = summary.riskCounts ?? {};
  if ((counts.critical ?? 0) > 0 || summary.status === "failed") return "critical";
  if ((counts["high-risk"] ?? counts.high ?? 0) > 0) return "high";
  if ((counts.warning ?? counts.medium ?? 0) > 0 || summary.status === "passed-with-findings") return "medium";
  return "informational";
}

function securityPhaseSeverity(summary) {
  if (summary.status === "failed") return "critical";
  const text = JSON.stringify(summary).toLowerCase();
  if (/critical|bypass|exposed exact qa content|public-by-id|tokenless.*visible/.test(text)) return "high";
  if (/warning|missing|not configured|false/.test(text)) return "medium";
  return "informational";
}

function extractSecurityPhaseFindings(summary, fileName) {
  const findings = [];
  if (summary.summary && typeof summary.summary === "object") {
    for (const [key, value] of Object.entries(summary.summary)) {
      findings.push({
        classification: `${fileName}:${key}`,
        description: typeof value === "string" ? value : `${key}: ${JSON.stringify(value)}`,
        severity: /high|critical|exposed|bypass/i.test(JSON.stringify(value)) ? "high" : "medium",
        status: "classified"
      });
    }
  }

  if (summary.securityHeaderChecks) {
    for (const [header, present] of Object.entries(summary.securityHeaderChecks)) {
      if (present === false || present === null) {
        findings.push({
          classification: `missing-header:${header}`,
          description: `Security header check did not pass for ${header}.`,
          severity: header === "hsts" ? "high" : "medium",
          status: "warning"
        });
      }
    }
  }

  if (Array.isArray(summary.findings)) {
    for (const entry of summary.findings) {
      findings.push({
        classification: entry.classification ?? fileName,
        description: entry.summary ?? entry.description ?? JSON.stringify(entry).slice(0, 240),
        severity: riskToSeverity(entry.riskLevel),
        status: normalizeStatus(entry.status)
      });
    }
  }

  return findings.slice(0, 50);
}

function warningSeverity(warning) {
  if (/tokenless|public-by-id|exposed/i.test(warning)) return "high";
  if (/failed|fatal/i.test(warning)) return "critical";
  return "medium";
}

function classifyWarningText(warning) {
  if (/tokenless|public-by-id/i.test(warning)) return "tokenless-access";
  if (/network/i.test(warning)) return "network-warning";
  if (/discovery|visibility|indexed/i.test(warning)) return "visibility-warning";
  return "campaign-warning";
}

function riskToSeverity(riskLevel) {
  return RISK_TO_SEVERITY[String(riskLevel ?? "info").toLowerCase()] ?? "medium";
}

function normalizeSeverity(severity) {
  return RISK_TO_SEVERITY[String(severity ?? "informational").toLowerCase()] ?? "medium";
}

function normalizeStatus(status) {
  return redactSensitiveString(String(status ?? "unknown").trim().toLowerCase().replaceAll("_", "-"));
}

function inferCampaignFromFile(filePath) {
  const match = path.basename(filePath).match(/campaign-([^.]+)\.json$/i);
  return match?.[1] ?? "unknown";
}

function inferCampaignFromArtifact(artifact) {
  const subject = artifact.subject ?? "";
  if (subject.startsWith("QA_LIVE_MEDIA_CAPSULE_")) return "media";
  if (subject.startsWith("QA_LIVE_VIDEO_CAPSULE_")) return "video";
  if (subject.startsWith("QA_REVEAL_LATER_CAPSULE_")) return "reveal-later";
  if (subject.startsWith("QA_LIVE_CAPSULE_")) return "text";
  return "lifecycle-artifact";
}

function findLifecycleReport(summary) {
  const reportDir = path.resolve(ROOT, "reports", "lifecycle");
  const candidates = [
    summary.runId ? path.join(reportDir, `lifecycle-campaign-${summary.runId}.html`) : null,
    path.join(reportDir, "latest-lifecycle-summary.html")
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findSecurityReport(summary) {
  const reportDir = path.resolve(ROOT, "reports", "security");
  const runId = summary.findings?.find((entry) => entry.runId)?.runId;
  const candidates = [
    runId ? path.join(reportDir, `security-campaign-${runId}.html`) : null,
    path.join(reportDir, "latest-security-summary.html")
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findLatestSecurityReport() {
  const report = path.resolve(ROOT, "reports", "security", "latest-security-summary.html");
  return existsSync(report) ? report : null;
}

function jsonFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => path.join(directory, fileName))
    .filter((filePath) => statSync(filePath).isFile())
    .sort();
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function extractVerdict(text) {
  if (/\bBLOCKED\b/i.test(text)) return "BLOCKED";
  if (/PASS WITH WARNINGS/i.test(text)) return "PASS WITH WARNINGS";
  if (/\bPASS\b/i.test(text)) return "PASS";
  return "UNKNOWN";
}

function summarizeTextLine(text, prefix) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .find((line) => line.startsWith(prefix));
}

function sanitizeValue(value) {
  if (typeof value === "string") return redactSensitiveString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      sanitized[redactSensitiveString(key)] = isSensitiveFieldName(key) && !isRedactedValue(entry)
        ? "[redacted]"
        : sanitizeValue(entry);
    }
    return sanitized;
  }
  return value;
}

function redactSensitiveString(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/([?&](?:token|access_token|id_token|refresh_token|auth|code|signature|sig|x-amz-signature|x-amz-credential|api_key|apikey|key|password)=)[^&#\s"']+/gi, "$1[redacted]")
    .replace(/\btoken-[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "token-[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/g, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-jwt]")
    .replace(/((?:set-cookie|cookie):\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) => maskEmail(email));
}

function isSensitiveFieldName(key) {
  return /^(?:password|secret|private_?key|service_?role_?key|authorization|cookies?|session_?id|access_?token|refresh_?token|id_?token|share_?token|possible_?share_?tokens?)$/i.test(key);
}

function isRedactedValue(value) {
  return typeof value === "string" && /^(?:\[redacted(?:-jwt)?\]|<redacted>|Bearer \[redacted\])$/i.test(value);
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function extractRunId(value) {
  const match = String(value ?? "").match(/[0-9a-f]{12,}-[0-9a-f]{8,}(?:-[a-z]+)?/i);
  return match?.[0] ?? null;
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[redacted-email]";
  return `${local[0] ?? "*"}***@${domain}`;
}

function countBy(entries, selector) {
  const counts = {};
  for (const entry of entries) {
    const key = selector(entry) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function severityCountsFromSecuritySummary(summary) {
  const riskCounts = summary.riskCounts ?? {};
  if (Object.keys(riskCounts).length > 0) {
    return {
      critical: riskCounts.critical ?? 0,
      high: riskCounts.high ?? riskCounts["high-risk"] ?? 0,
      medium: riskCounts.medium ?? riskCounts.warning ?? 0,
      low: riskCounts.low ?? 0,
      informational: riskCounts.info ?? riskCounts.informational ?? 0
    };
  }

  const findings = Array.isArray(summary.findings) ? summary.findings : [];
  return countBy(findings, (entry) => riskToSeverity(entry.riskLevel ?? entry.severity));
}

function severityCountObject(severity) {
  return {
    [normalizeSeverity(severity)]: 1
  };
}

function normalizeSeverityCounts(counts = {}) {
  return {
    critical: Number(counts.critical ?? 0),
    high: Number(counts.high ?? counts["high-risk"] ?? 0),
    medium: Number(counts.medium ?? counts.warning ?? 0),
    low: Number(counts.low ?? 0),
    informational: Number(counts.informational ?? counts.info ?? 0)
  };
}

function highestSeverityFromCounts(counts) {
  if ((counts.critical ?? 0) > 0) return "critical";
  if ((counts.high ?? 0) > 0) return "high";
  if ((counts.medium ?? 0) > 0) return "medium";
  if ((counts.low ?? 0) > 0) return "low";
  return "informational";
}

function durationMs(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(completed) || completed < start) return null;
  return completed - start;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
