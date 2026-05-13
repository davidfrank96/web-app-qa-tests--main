import type { Page, TestInfo } from "@playwright/test";
import { DraftsPage } from "../pages/inssa/drafts.page";
import { TimeCapsulePage } from "../pages/inssa/time-capsule.page";
import {
  getInssaCleanupCapabilities,
  getInssaMutationReadiness,
  type InssaCleanupCapabilities,
  type InssaMutationReadiness,
  type InssaMutationRunContext
} from "./inssa-mutation";

export type InssaTrackedArtifactKind = "capsule" | "draft";
export type InssaTrackedArtifactStatus =
  | "cleanup-skipped"
  | "created"
  | "detected-stale"
  | "discarded"
  | "opened"
  | "published";

export type InssaTrackedArtifact = {
  cleanupVerified: boolean;
  id?: string;
  kind: InssaTrackedArtifactKind;
  logicalKey: string;
  notes: string[];
  status: InssaTrackedArtifactStatus;
  subject: string;
};

export type InssaCleanupReport = {
  blockers: string[];
  cleanupCapabilities: InssaCleanupCapabilities;
  deletedCapsules: number;
  discardedDrafts: number;
  lifecycleReady: boolean;
  pendingArtifacts: number;
  preferredCleanupPath: InssaMutationReadiness["preferredCleanupPath"];
  runId: string;
  staleArtifacts: number;
  trackedArtifacts: InssaTrackedArtifact[];
};

export function createInssaCleanupTracker(
  runContext: InssaMutationRunContext,
  capabilities: InssaCleanupCapabilities = getInssaCleanupCapabilities()
) {
  const artifacts: InssaTrackedArtifact[] = [];

  const upsertArtifact = (artifact: InssaTrackedArtifact) => {
    const existingIndex = artifacts.findIndex(
      (candidate) => candidate.logicalKey === artifact.logicalKey && candidate.kind === artifact.kind
    );

    if (existingIndex >= 0) {
      artifacts[existingIndex] = artifact;
      return;
    }

    artifacts.push(artifact);
  };

  return {
    markCapsuleCreated(subject: string, input: { id?: string; logicalKey?: string; note?: string } = {}) {
      upsertArtifact({
        cleanupVerified: false,
        id: input.id,
        kind: "capsule",
        logicalKey: input.logicalKey ?? runContext.logicalKey,
        notes: input.note ? [input.note] : [],
        status: "created",
        subject
      });
    },
    markCleanupSkipped(subject: string, input: { kind: InssaTrackedArtifactKind; logicalKey?: string; note?: string }) {
      upsertArtifact({
        cleanupVerified: false,
        kind: input.kind,
        logicalKey: input.logicalKey ?? runContext.logicalKey,
        notes: input.note ? [input.note] : [],
        status: "cleanup-skipped",
        subject
      });
    },
    markDraftDiscarded(subject: string, input: { logicalKey?: string; note?: string } = {}) {
      upsertArtifact({
        cleanupVerified: true,
        kind: "draft",
        logicalKey: input.logicalKey ?? runContext.logicalKey,
        notes: input.note ? [input.note] : [],
        status: "discarded",
        subject
      });
    },
    markDraftOpened(subject: string, input: { logicalKey?: string; note?: string } = {}) {
      upsertArtifact({
        cleanupVerified: false,
        kind: "draft",
        logicalKey: input.logicalKey ?? runContext.logicalKey,
        notes: input.note ? [input.note] : [],
        status: "opened",
        subject
      });
    },
    markPublishedCapsule(subject: string, input: { id?: string; logicalKey?: string; note?: string } = {}) {
      upsertArtifact({
        cleanupVerified: false,
        id: input.id,
        kind: "capsule",
        logicalKey: input.logicalKey ?? runContext.logicalKey,
        notes: input.note ? [input.note] : [],
        status: "published",
        subject
      });
    },
    recordStaleArtifact(subject: string, input: { id?: string; kind?: InssaTrackedArtifactKind; note?: string } = {}) {
      upsertArtifact({
        cleanupVerified: false,
        id: input.id,
        kind: input.kind ?? "capsule",
        logicalKey: runContext.logicalKey,
        notes: input.note ? [input.note] : [],
        status: "detected-stale",
        subject
      });
    },
    summarize(): InssaCleanupReport {
      const readiness = getInssaMutationReadiness(capabilities);
      const discardedDrafts = artifacts.filter(
        (artifact) => artifact.kind === "draft" && artifact.status === "discarded"
      ).length;
      const deletedCapsules = artifacts.filter(
        (artifact) => artifact.kind === "capsule" && artifact.cleanupVerified
      ).length;
      const staleArtifacts = artifacts.filter((artifact) => artifact.status === "detected-stale").length;
      const pendingArtifacts = artifacts.filter(
        (artifact) =>
          (artifact.kind === "capsule" && !artifact.cleanupVerified) ||
          (artifact.kind === "draft" && artifact.status === "opened" && !artifact.cleanupVerified)
      ).length;

      return {
        blockers: readiness.blockers,
        cleanupCapabilities: capabilities,
        deletedCapsules,
        discardedDrafts,
        lifecycleReady: readiness.lifecycleReady,
        pendingArtifacts,
        preferredCleanupPath: readiness.preferredCleanupPath,
        runId: runContext.runId,
        staleArtifacts,
        trackedArtifacts: artifacts.map((artifact) => ({
          ...artifact,
          notes: [...artifact.notes]
        }))
      };
    }
  };
}

export async function attachInssaCleanupReport(testInfo: TestInfo, report: InssaCleanupReport): Promise<void> {
  console.log(`INSSA_CLEANUP_REPORT ${JSON.stringify(report)}`);
  await testInfo.attach("inssa-cleanup-report.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json"
  });
}

export async function discardQaDraftsFromDraftsList(
  page: Page,
  input: {
    maxIterations?: number;
    subject?: string;
  } = {}
): Promise<{
  deletedSubjects: string[];
  remainingSubjects: string[];
}> {
  const drafts = new DraftsPage(page);
  const compose = new TimeCapsulePage(page);
  const deletedSubjects: string[] = [];
  const maxIterations = input.maxIterations ?? 10;

  await drafts.goToDrafts();

  for (let index = 0; index < maxIterations; index += 1) {
    const subjects = await drafts.listQaDraftSubjects();
    const nextSubject = input.subject ? subjects.find((subject) => subject === input.subject) : subjects[0];

    if (!nextSubject) {
      break;
    }

    await drafts.openDraftBySubject(nextSubject);
    await compose.expectComposeSurface();
    await compose.discardDraft();
    deletedSubjects.push(nextSubject);
    await drafts.goToDrafts();

    if (input.subject) {
      break;
    }
  }

  const remainingSubjects = await drafts.listQaDraftSubjects();
  return { deletedSubjects, remainingSubjects };
}
