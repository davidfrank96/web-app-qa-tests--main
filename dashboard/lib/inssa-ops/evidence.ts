import path from "node:path";
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
    environment: "staging",
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
      originalFilePath: artifact.filePath
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
  if (/cleanup/i.test(run.campaignKey) || artifacts.some((artifact) => artifact.filePath.startsWith("lifecycle-artifacts/"))) {
    return "cleanup-evidence";
  }
  if (/security|cross-user|reveal-later/i.test(run.campaignKey)) return "security-evidence";
  if (
    artifacts.some((artifact) =>
      ["Screenshot", "Trace", "Video"].includes(artifact.artifactType) || artifact.filePath.startsWith("test-results/")
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
  if (artifact.filePath.startsWith("lifecycle-artifacts/")) return "cleanup-evidence";
  if (artifact.filePath.includes("/cross-user/") || artifact.filePath.includes("/reveal-later/")) return "security-evidence";
  if (["Screenshot", "Trace", "Video"].includes(artifact.artifactType) || artifact.filePath.startsWith("test-results/")) {
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
  const roots = new Set(artifacts.map((artifact) => artifact.filePath.split(path.sep).join("/").split("/")[0] ?? ""));
  return roots.size === 1 ? [...roots][0] : "mixed";
}
