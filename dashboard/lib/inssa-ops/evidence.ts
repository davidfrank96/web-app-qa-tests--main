import fs from "node:fs";
import path from "node:path";
import { parseAuthenticationMonitoringSummary } from "../monitoring/authentication-result";
import { getRepoRoot } from "./paths";
import type {
  InssaArtifactRecord,
  InssaEvidenceBundleRecord,
  InssaEvidenceBundleType,
  InssaEvidenceItemRecord,
  InssaEvidenceRetentionClass,
  InssaRunRecord
} from "./types";

export type InssaEvidenceMetadata = {
  bundle: InssaEvidenceBundleRecord | null;
  items: InssaEvidenceItemRecord[];
};

export function buildEvidenceMetadataForRun(run: InssaRunRecord, artifacts: InssaArtifactRecord[]): InssaEvidenceMetadata {
  if (artifacts.length === 0) {
    return {
      bundle: null,
      items: []
    };
  }

  const indexedAt = new Date().toISOString();
  const bundleId = crypto.randomUUID();
  const retentionClass = classifyBundleRetention(run, artifacts);
  const bundle: InssaEvidenceBundleRecord = {
    bundleType: classifyBundleType(run, artifacts),
    campaignKey: run.campaignKey,
    checksumManifest: Object.fromEntries(artifacts.map((artifact) => [artifact.filePath, artifact.sha256])),
    createdAt: run.completedAt ?? indexedAt,
    environment: run.commandSnapshot.targetEnvironment ?? "staging",
    id: bundleId,
    indexedAt,
    itemCount: artifacts.length,
    product: "INSSA",
    retentionClass,
    rootPath: commonEvidenceRoot(artifacts),
    runId: run.id,
    sensitive: artifacts.some((artifact) => artifact.sensitive),
    sourceArtifactId: firstSourceArtifactId(artifacts),
    status: "indexed",
    storageBackend: "local-filesystem",
    storagePrefix: null,
    title: evidenceBundleTitle(run),
    totalBytes: artifacts.reduce((total, artifact) => total + artifact.fileSize, 0),
    uploadError: null,
    uploadStatus: "local_only",
    uploadedAt: null
  };

  return {
    bundle,
    items: artifacts.map((artifact) => evidenceItemFromArtifact(bundle, artifact, run.campaignKey))
  };
}

function evidenceItemFromArtifact(
  bundle: InssaEvidenceBundleRecord,
  artifact: InssaArtifactRecord,
  campaignKey: string
): InssaEvidenceItemRecord {
  return {
    artifactId: artifact.id,
    bundleId: bundle.id,
    campaignKey,
    contentType: artifact.contentType,
    createdAt: artifact.createdAt,
    fileName: path.basename(artifact.filePath),
    id: crypto.randomUUID(),
    itemType: artifact.artifactType,
    metadata: {
      compatibilityArtifactId: artifact.id,
      compatibilityArtifactType: artifact.artifactType,
      originalFilePath: artifact.filePath,
      ...authenticationMonitoringResultMetadata(artifact)
    },
    relativePath: artifact.filePath,
    renderInline: artifact.renderInline,
    retentionClass: classifyItemRetention(artifact, bundle.retentionClass),
    runId: artifact.runId,
    sensitive: artifact.sensitive,
    sha256: artifact.sha256,
    sizeBytes: artifact.fileSize,
    storageBackend: "local-filesystem",
    storageKey: artifact.filePath,
    uploadError: null,
    uploadStatus: "local_only",
    uploadedAt: null
  };
}

function authenticationMonitoringResultMetadata(artifact: InssaArtifactRecord): Record<string, unknown> {
  const normalizedPath = artifact.filePath.replaceAll("\\", "/");
  if (!normalizedPath.endsWith("authentication-monitoring-summary.json")) return {};
  try {
    const repoRoot = path.resolve(getRepoRoot());
    const absolutePath = path.resolve(repoRoot, artifact.filePath);
    const relative = path.relative(repoRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Summary path escapes the repository.");
    }
    return {
      authenticationMonitoringResult: parseAuthenticationMonitoringSummary(
        JSON.parse(fs.readFileSync(absolutePath, "utf8"))
      ),
      authenticationMonitoringResultState: "available"
    };
  } catch (error) {
    return {
      authenticationMonitoringResultError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      authenticationMonitoringResultState: "invalid"
    };
  }
}

function classifyBundleType(run: InssaRunRecord, artifacts: InssaArtifactRecord[]): InssaEvidenceBundleType {
  if (run.commandSnapshot.commandType === "artifact_validation") return "artifact-validation";
  if (run.commandSnapshot.commandType === "healthcheck") return "healthcheck";
  if (run.commandSnapshot.commandType === "report_render") return "report";
  if (run.commandSnapshot.commandType === "export") return "siem";
  if (/security/i.test(run.campaignKey)) return "security";
  if (/lifecycle|live|reveal|media|video|text/i.test(run.campaignKey)) return "lifecycle";
  if (artifacts.some((artifact) => artifact.artifactType === "Playwright Report")) return "playwright";
  return "mixed";
}

function classifyBundleRetention(run: InssaRunRecord, artifacts: InssaArtifactRecord[]): InssaEvidenceRetentionClass {
  if (artifacts.some((artifact) => artifact.artifactType === "SIEM Export")) return "siem-metadata";
  if (/cleanup/i.test(run.campaignKey) || artifacts.some((artifact) => logicalArtifactPath(artifact).startsWith("lifecycle-artifacts/"))) {
    return "cleanup-evidence";
  }
  if (/security|cross-user|reveal-later/i.test(run.campaignKey)) return "security-evidence";
  if (
    artifacts.some((artifact) =>
      ["Screenshot", "Trace", "Video"].includes(artifact.artifactType) || logicalArtifactPath(artifact).startsWith("test-results/")
    )
  ) {
    return "short-lived";
  }
  return "default";
}

function classifyItemRetention(
  artifact: InssaArtifactRecord,
  bundleRetention: InssaEvidenceRetentionClass
): InssaEvidenceRetentionClass {
  if (artifact.artifactType === "SIEM Export") return "siem-metadata";
  const logicalPath = logicalArtifactPath(artifact);
  if (logicalPath.startsWith("lifecycle-artifacts/")) return "cleanup-evidence";
  if (logicalPath.includes("/cross-user/") || logicalPath.includes("/reveal-later/")) return "security-evidence";
  if (["Screenshot", "Trace", "Video"].includes(artifact.artifactType) || logicalPath.startsWith("test-results/")) {
    return "short-lived";
  }
  return bundleRetention;
}

function evidenceBundleTitle(run: InssaRunRecord) {
  return `${run.commandSnapshot.displayName} Evidence`;
}

function firstSourceArtifactId(artifacts: InssaArtifactRecord[]) {
  return (
    artifacts.find((artifact) => artifact.artifactType === "Campaign Summary")?.id ??
    artifacts.find((artifact) => artifact.artifactType === "JSON Artifact")?.id ??
    artifacts.find((artifact) => artifact.artifactType === "Playwright Report")?.id ??
    artifacts[0]?.id ??
    null
  );
}

function commonEvidenceRoot(artifacts: InssaArtifactRecord[]) {
  const runScopedRoot = artifacts[0]?.filePath.split(path.sep).join("/").match(/^(run-output\/[^/]+)/)?.[1];
  if (runScopedRoot && artifacts.every((artifact) => artifact.filePath.split(path.sep).join("/").startsWith(`${runScopedRoot}/`))) {
    return runScopedRoot;
  }
  const roots = new Set(artifacts.map((artifact) => artifact.filePath.split(path.sep).join("/").split("/")[0] ?? ""));
  return roots.size === 1 ? [...roots][0] : "mixed";
}

function logicalArtifactPath(artifact: InssaArtifactRecord) {
  const normalized = artifact.filePath.split(path.sep).join("/");
  const prefix = `run-output/${artifact.runId}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}
