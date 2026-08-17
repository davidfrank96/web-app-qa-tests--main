import fs from "node:fs/promises";
import path from "node:path";
import { downloadEvidenceItemFromDurableStorage, verifyEvidenceItemBytes } from "../inssa-ops/evidence-storage";
import { getRepoRoot } from "../inssa-ops/paths";
import { redactInssaLogLine } from "../inssa-ops/redaction";
import type { InssaRunStore } from "../inssa-ops/run-store";
import type { InssaArtifactRecord, InssaEvidenceItemRecord, InssaRunRecord } from "../inssa-ops/types";
import {
  isAuthenticationMonitoringCampaign,
  isTerminalAuthenticationMonitoringRun,
  parseAuthenticationMonitoringSummary,
  type AuthenticationMonitoringResultResponse
} from "./authentication-result";

type LoadOptions = {
  loadDurableItem?: (item: InssaEvidenceItemRecord) => Promise<Buffer>;
  persistRecoveredMetadata?: boolean;
};

export async function loadAuthenticationMonitoringResult(
  store: InssaRunStore,
  runId: string,
  options: LoadOptions = {}
): Promise<AuthenticationMonitoringResultResponse | null> {
  const run = await store.getRun(runId);
  if (!run) return null;
  if (!isAuthenticationMonitoringCampaign(run.campaignKey)) {
    throw new Error(`Run ${runId} is not an Authentication Monitoring run.`);
  }
  const [artifacts, evidence] = await Promise.all([store.getArtifacts(runId), store.getEvidence(runId)]);
  const resolved = await resolveAuthenticationMonitoringResult(
    run,
    artifacts,
    evidence.items,
    evidence.bundles[0] ?? null,
    options.loadDurableItem
  );
  if (
    options.persistRecoveredMetadata &&
    resolved.state === "available" &&
    resolved.source === "evidence_file" &&
    resolved.result &&
    resolved.evidence.summaryEvidenceItemId
  ) {
    const item = evidence.items.find((candidate) => candidate.id === resolved.evidence.summaryEvidenceItemId);
    if (item) {
      await store.updateEvidenceItemMetadata(item.id, {
        ...item.metadata,
        authenticationMonitoringResult: resolved.result,
        authenticationMonitoringResultState: "available",
        authenticationMonitoringResultUpdatedAt: new Date().toISOString()
      });
    }
  }
  return resolved;
}

export async function resolveAuthenticationMonitoringResult(
  run: InssaRunRecord,
  artifacts: InssaArtifactRecord[],
  items: InssaEvidenceItemRecord[],
  bundle: { id: string; uploadError: string | null; uploadStatus: string } | null,
  loadDurableItem = downloadEvidenceItemFromDurableStorage
): Promise<AuthenticationMonitoringResultResponse> {
  const reportArtifact = artifacts.find((artifact) => artifact.artifactType === "Playwright Report") ?? null;
  const summaryItem = selectSummaryItem(items);
  const evidence = {
    bundleId: bundle?.id ?? null,
    reportArtifactId: reportArtifact?.id ?? null,
    summaryEvidenceItemId: summaryItem?.id ?? null,
    uploadStatus: normalizeUploadStatus(bundle?.uploadStatus)
  };

  if (summaryItem?.metadata.authenticationMonitoringResult) {
    try {
      return availableResult(
        validateForRun(parseAuthenticationMonitoringSummary(summaryItem.metadata.authenticationMonitoringResult), run),
        evidence,
        "evidence_metadata"
      );
    } catch {
      // A malformed metadata projection is never trusted; the checksummed evidence file is authoritative.
    }
  }

  if (summaryItem) {
    try {
      const bytes = await readEvidenceItem(summaryItem, loadDurableItem);
      return availableResult(
        validateForRun(parseAuthenticationMonitoringSummary(JSON.parse(bytes.toString("utf8"))), run),
        evidence,
        "evidence_file"
      );
    } catch (error) {
      if (bundle?.uploadStatus === "failed") {
        return unavailableResult(
          "evidence_upload_failed",
          `Evidence upload failed and the structured result could not be recovered. ${safeError(error, bundle.uploadError)}`,
          evidence
        );
      }
      if (isTerminalAuthenticationMonitoringRun(run.status)) {
        return unavailableResult(
          "result_metadata_missing",
          `RESULT_METADATA_MISSING: Structured result evidence failed validation or retrieval. ${safeError(error)}`,
          evidence
        );
      }
    }
  }

  if (!isTerminalAuthenticationMonitoringRun(run.status)) {
    return unavailableResult("processing", "Authentication provider results are still processing.", evidence);
  }
  if (bundle?.uploadStatus === "failed") {
    return unavailableResult(
      "evidence_upload_failed",
      `Evidence Upload Failed: ${bundle.uploadError ?? "No durable evidence error was recorded."}`,
      evidence
    );
  }
  return unavailableResult(
    "result_metadata_missing",
    "RESULT_METADATA_MISSING: The terminal run has no trustworthy structured Authentication Monitoring summary.",
    evidence
  );
}

function selectSummaryItem(items: InssaEvidenceItemRecord[]) {
  const summaries = items.filter((item) => item.relativePath.replaceAll("\\", "/").endsWith("authentication-monitoring-summary.json"));
  return summaries.find((item) => item.relativePath.replaceAll("\\", "/").includes("/playwright-report/")) ?? summaries[0] ?? null;
}

async function readEvidenceItem(
  item: InssaEvidenceItemRecord,
  loadDurableItem: (item: InssaEvidenceItemRecord) => Promise<Buffer>
) {
  if (item.storageBackend === "supabase-storage" && item.uploadStatus === "uploaded") {
    return loadDurableItem(item);
  }
  const repoRoot = path.resolve(getRepoRoot());
  const absolutePath = path.resolve(repoRoot, item.relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Authentication monitoring summary path escapes the repository.");
  }
  return verifyEvidenceItemBytes(item, await fs.readFile(absolutePath));
}

function validateForRun(result: ReturnType<typeof parseAuthenticationMonitoringSummary>, run: InssaRunRecord) {
  if (result.runId !== run.id) throw new Error("Authentication monitoring summary run ID does not match its owning run.");
  const expectedEnvironment = run.campaignKey.endsWith("_production") ? "production" : "staging";
  if (result.environment !== expectedEnvironment) {
    throw new Error("Authentication monitoring summary environment does not match its owning run.");
  }
  return result;
}

function availableResult(
  result: ReturnType<typeof parseAuthenticationMonitoringSummary>,
  evidence: AuthenticationMonitoringResultResponse["evidence"],
  source: "evidence_file" | "evidence_metadata"
): AuthenticationMonitoringResultResponse {
  return { evidence, reason: null, result, source, state: "available" };
}

function unavailableResult(
  state: Exclude<AuthenticationMonitoringResultResponse["state"], "available">,
  reason: string,
  evidence: AuthenticationMonitoringResultResponse["evidence"]
): AuthenticationMonitoringResultResponse {
  return { evidence, reason, result: null, source: null, state };
}

function normalizeUploadStatus(status: string | undefined): AuthenticationMonitoringResultResponse["evidence"]["uploadStatus"] {
  return status === "uploaded" || status === "failed" || status === "local_only" ? status : "missing";
}

function safeError(error: unknown, fallback?: string | null) {
  const message = error instanceof Error ? error.message : fallback || "No additional diagnostic was recorded.";
  return redactInssaLogLine(message).replace(/[\r\n]+/g, " ").slice(0, 500);
}
