import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { redactInssaLogLine } from "./redaction";
import type { InssaCleanupManifest, InssaRunRecord } from "./types";

const FORBIDDEN_KEY = /token|password|cookie|authorization|sharelink|signedurl/i;
const ARTIFACT_ID_KEY = /^(artifactId|runId)$/i;
const CAPSULE_ID_KEY = /capsuleId$/i;
const MEDIA_ID_KEY = /mediaId$/i;

export async function writeCleanupManifest(run: InssaRunRecord, outputRoot: string) {
  if (!run.commandSnapshot.cleanupRequired) return null;

  const values = await collectSanitizedLifecycleValues(outputRoot);
  const recordedAt = new Date().toISOString();
  const policy = run.executionContext?.cleanupPolicy;
  const objectCount = values.capsuleIds.length + values.mediaIds.length;
  const expectedMediaCount = /(?:media|video)/i.test(run.campaignKey) ? 1 : 0;
  const unexpectedData =
    values.capsuleIds.length > 1 ||
    values.mediaIds.length > expectedMediaCount ||
    objectCount > 1 + expectedMediaCount;
  const dedicatedQaAccount = policy?.dedicatedQaAccountsConfirmed === true;
  const safelyAccounted =
    objectCount > 0 &&
    values.affectedUsers.length > 0 &&
    dedicatedQaAccount &&
    !unexpectedData;
  const deferredCleanup = safelyAccounted && policy?.deferredModeEnabled === true;
  const manifest: InssaCleanupManifest = {
    affectedUsers: values.affectedUsers,
    automaticCleanupAvailable: false,
    cleanupMethod: "Deferred cleanup ledger; no approved direct INSSA staging database deletion is available.",
    cleanupResult: deferredCleanup ? "cleanup_unavailable_object_tracked" : "cleanup_identity_or_accounting_required",
    cleanupTimestamp: recordedAt,
    confirmedAt: null,
    confirmedBy: null,
    createdArtifactIds: values.artifactIds,
    createdCapsuleIds: values.capsuleIds,
    createdMediaIds: values.mediaIds,
    dedicatedQaAccount,
    evidencePaths: [
      `run-output/${run.id}/cleanup-manifest.json`,
      `run-output/${run.id}/evidence-manifest.json`,
      ...(await listPlaywrightReportPaths(outputRoot, run.id))
    ],
    finalActionPerformed: values.finalActionPerformed,
    instructions: values.instructions.length
      ? values.instructions
      : ["Review the immutable run evidence and remove every QA-tagged staging object created by this run."],
    lifecycleState: values.lifecycleState,
    mediaType: values.mediaType,
    ownerAccount: values.affectedUsers[0] ?? null,
    reasonCode: deferredCleanup ? "INSSA-CLEANUP-UNAVAILABLE" : "INSSA-CLEANUP-IDENTITY-REQUIRED",
    recordedAt,
    retentionUntil: addDays(recordedAt, policy?.retentionDays ?? 90),
    runId: run.id,
    safelyAccounted,
    schemaVersion: 2,
    sensitiveValuesExcluded: true,
    selectedRecipient: values.selectedRecipient,
    status: deferredCleanup ? "cleanup_unavailable" : "pending",
    unexpectedData,
    verificationMethods: ["Run-owned lifecycle artifact review", "Cleanup-ledger identity and ownership validation"]
  };
  await fs.writeFile(path.join(outputRoot, "cleanup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function listPlaywrightReportPaths(outputRoot: string, runId: string) {
  const files = await listFiles(path.join(outputRoot, "playwright-report"));
  return files
    .map((filePath) => path.relative(outputRoot, filePath).split(path.sep).join("/"))
    .filter((relativePath) => /^playwright-report\/(?:index\.html|(?!trace\/)[^/]+\/index\.html)$/.test(relativePath))
    .map((relativePath) => `run-output/${runId}/${relativePath}`)
    .sort();
}

async function collectSanitizedLifecycleValues(outputRoot: string) {
  const result = {
    affectedUsers: new Set<string>(),
    artifactIds: new Set<string>(),
    capsuleIds: new Set<string>(),
    finalActionPerformed: false,
    instructions: new Set<string>(),
    lifecycleState: null as string | null,
    mediaType: null as "image" | "video" | null,
    mediaIds: new Set<string>(),
    selectedRecipient: null as string | null
  };
  for (const filePath of await listJsonFiles(outputRoot)) {
    if (path.basename(filePath) === "cleanup-manifest.json" || path.basename(filePath) === "evidence-manifest.json") continue;
    const relativePath = path.relative(outputRoot, filePath).split(path.sep).join("/");
    if (!isAuthoritativeCleanupEvidence(relativePath)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    const finalActionPerformed = containsSuccessfulFinalAction(parsed);
    walk(parsed, (key, value) => {
      if (typeof value !== "string" || !value.trim()) return;
      const normalized = value.trim();
      const mediaObjectId = mediaObjectIdFromStorageUrl(normalized);
      if (mediaObjectId) result.mediaIds.add(mediaObjectId);
      if (FORBIDDEN_KEY.test(key)) return;
      if (CAPSULE_ID_KEY.test(key) && (key !== "possibleFinalCapsuleId" || finalActionPerformed)) {
        result.capsuleIds.add(normalized);
      }
      else if (MEDIA_ID_KEY.test(key)) result.mediaIds.add(normalized);
      else if (ARTIFACT_ID_KEY.test(key)) result.artifactIds.add(normalized);
      else if (/masked.*email|primaryUser|secondaryUser|selectedContactTarget/i.test(key)) {
        result.affectedUsers.add(normalized);
        if (/selectedContactTarget/i.test(key)) result.selectedRecipient = normalized;
      }
      else if (/cleanupInstruction/i.test(key)) result.instructions.add(redactInssaLogLine(normalized));
      else if (/lifecycleClassification|lifecycleState|lifecycleStatus|resultingObjectState/i.test(key) && !result.lifecycleState) result.lifecycleState = normalized;
      else if (/^(?:fixtureType|mediaType)$/i.test(key) && /^(?:image|video)$/i.test(normalized)) {
        result.mediaType = normalized.toLowerCase() as "image" | "video";
      }
    });
    if (finalActionPerformed) result.finalActionPerformed = true;
  }
  return {
    affectedUsers: [...result.affectedUsers],
    artifactIds: [...result.artifactIds],
    capsuleIds: [...result.capsuleIds],
    finalActionPerformed: result.finalActionPerformed,
    instructions: [...result.instructions],
    lifecycleState: result.lifecycleState,
    mediaIds: [...result.mediaIds],
    mediaType: result.mediaType,
    selectedRecipient: result.selectedRecipient
  };
}

function mediaObjectIdFromStorageUrl(value: string) {
  if (!/^https:\/\/firebasestorage\.googleapis\.com\//i.test(value)) return null;
  const encodedObject = value.match(/\/o\/([^?]+)/i)?.[1];
  if (!encodedObject) return null;
  try {
    const objectPath = decodeURIComponent(encodedObject);
    if (!objectPath.toLowerCase().startsWith("timecapsules/")) return null;
    return objectPath.slice("timecapsules/".length) || null;
  } catch {
    return null;
  }
}

function isAuthoritativeCleanupEvidence(relativePath: string) {
  if (path.posix.basename(relativePath).startsWith("latest-")) return false;
  return relativePath.startsWith("lifecycle-artifacts/") || relativePath.startsWith("security-campaigns/");
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function walk(value: unknown, visit: (key: string, value: unknown) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    visit(key, item);
    walk(item, visit);
  }
}

function containsSuccessfulFinalAction(value: unknown) {
  let performed = false;
  walk(value, (key, item) => {
    if (/finalShareActionClicked|finalBuryThenChooseClicked|sendToContactsClicked/i.test(key) && item === true) {
      performed = true;
    }
  });
  return performed;
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listJsonFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
  }
  return files;
}


async function listFiles(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}
