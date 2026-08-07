import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getInssaPhase1Command } from "../lib/inssa-ops/command-registry";
import { writeCleanupManifest } from "../lib/inssa-ops/cleanup-manifest";
import {
  findPendingCleanupBlocker,
  IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT,
  LIVE_MUTATION_ACKNOWLEDGEMENTS,
  LIVE_MUTATION_CONFIRMATION_PHRASE,
  validateLiveCampaignPreflight
} from "../lib/inssa-ops/live-campaigns";
import { getInssaCommandAuthorization } from "../lib/inssa-ops/security";

const admin = { email: "admin@example.test", id: "admin-id", role: "admin" as const };
const completeApproval = {
  acknowledgements: [...LIVE_MUTATION_ACKNOWLEDGEMENTS, IRREVERSIBLE_ACTION_ACKNOWLEDGEMENT],
  confirmationPhrase: LIVE_MUTATION_CONFIRMATION_PHRASE
};

test("governed mutation wrappers are admin-only while safe commands remain operator-accessible", () => {
  const liveKeys = [
    "test_inssa_campaign_text",
    "test_inssa_campaign_media",
    "test_inssa_campaign_video",
    "test_inssa_campaign_reveal_later",
    "test_inssa_campaign_cross_user",
    "test_inssa_campaign_reveal_later_security"
  ];
  for (const key of liveKeys) {
    assert.equal(getInssaCommandAuthorization("viewer", key).allowed, false);
    assert.equal(getInssaCommandAuthorization("operator", key).allowed, false);
    assert.equal(getInssaCommandAuthorization("admin", key).allowed, true);
  }
  assert.equal(getInssaCommandAuthorization("operator", "test_inssa_safe").allowed, true);
});

test("all six governed wrappers pass admin preflight with complete staging prerequisites", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-all-campaigns-"));
  await fs.mkdir(path.join(repoRoot, "tests", "fixtures", "media"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "tests", "fixtures", "media", "sample-video.mp4"), "approved-test-video");
  const environment = {
    ...baseEnvironment(),
    INSSA_ENABLE_MEDIA_CAPSULE_TESTS: "1",
    INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS: "1",
    INSSA_ENABLE_VIDEO_CAPSULE_TESTS: "1",
    INSSA_SECONDARY_TEST_EMAIL: "secondary@example.test",
    INSSA_SECONDARY_TEST_PASSWORD: "secret",
    INSSA_US_MARKET_LOCATION: "nyc"
  };
  for (const key of [
    "test_inssa_campaign_text",
    "test_inssa_campaign_media",
    "test_inssa_campaign_video",
    "test_inssa_campaign_reveal_later",
    "test_inssa_campaign_cross_user",
    "test_inssa_campaign_reveal_later_security"
  ]) {
    const command = requiredCommand(key);
    const result = await validateLiveCampaignPreflight(
      command,
      command.supportsExecutionModes ? { ...completeApproval, executionMode: "create" } : completeApproval,
      admin,
      { activeRunId: null, environment, repoRoot, workerHealthy: true }
    );
    assert.equal(result.ok, true, key);
  }
});

test("approval requires every acknowledgement and the exact phrase", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-approval-"));
  const command = requiredCommand("test_inssa_campaign_text");
  const missing = await validateLiveCampaignPreflight(command, { acknowledgements: [], confirmationPhrase: "wrong" }, admin, {
    activeRunId: null,
    environment: baseEnvironment(),
    repoRoot,
    workerHealthy: true
  });
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.error, /acknowledgement/i);

  const wrongPhrase = await validateLiveCampaignPreflight(command, { ...completeApproval, confirmationPhrase: "RUN PROD" }, admin, {
    activeRunId: null,
    environment: baseEnvironment(),
    repoRoot,
    workerHealthy: true
  });
  assert.equal(wrongPhrase.ok, false);
  assert.match(wrongPhrase.ok ? "" : wrongPhrase.error, /RUN STAGING MUTATION/);
});

test("staging is allowed while production, arbitrary hosts, missing prerequisites, worker outage, and active runs fail preflight", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-target-"));
  const command = requiredCommand("test_inssa_campaign_text");
  const allowed = await validateLiveCampaignPreflight(command, completeApproval, admin, {
    activeRunId: null,
    environment: baseEnvironment(),
    repoRoot,
    workerHealthy: true
  });
  assert.equal(allowed.ok, true);

  for (const target of ["https://inssa.us", "https://www.inssa.us", "https://example.test", "http://localhost:3000"]) {
    const blocked = await validateLiveCampaignPreflight(command, completeApproval, admin, {
      activeRunId: null,
      environment: { ...baseEnvironment(), INSSA_URL: target },
      repoRoot,
      workerHealthy: true
    });
    assert.equal(blocked.ok, false, target);
  }

  const missingAccount = await validateLiveCampaignPreflight(command, completeApproval, admin, {
    activeRunId: null,
    environment: { ...baseEnvironment(), INSSA_TEST_EMAIL: "" },
    repoRoot,
    workerHealthy: true
  });
  assert.equal(missingAccount.ok, false);
  const workerDown = await validateLiveCampaignPreflight(command, completeApproval, admin, {
    activeRunId: null,
    environment: baseEnvironment(),
    repoRoot,
    workerHealthy: false
  });
  assert.equal(workerDown.ok, false);
  const active = await validateLiveCampaignPreflight(command, completeApproval, admin, {
    activeRunId: "active-run",
    environment: baseEnvironment(),
    repoRoot,
    workerHealthy: true
  });
  assert.equal(active.ok, false);
});

test("reveal-later mode is explicit and resume rejects invalid or non-staging artifacts", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-reveal-"));
  await fs.mkdir(path.join(repoRoot, "lifecycle-artifacts"));
  const command = requiredCommand("test_inssa_campaign_reveal_later_security");
  const env = { ...baseEnvironment(), INSSA_ENABLE_REVEAL_LATER_CAPSULE_TESTS: "1", INSSA_SECONDARY_TEST_EMAIL: "secondary@example.test", INSSA_SECONDARY_TEST_PASSWORD: "secret" };
  const missingMode = await validateLiveCampaignPreflight(command, completeApproval, admin, { activeRunId: null, environment: env, repoRoot, workerHealthy: true });
  assert.equal(missingMode.ok, false);

  await fs.writeFile(path.join(repoRoot, "lifecycle-artifacts", "invalid.json"), JSON.stringify({ environment: "production", observedCreateSuccess: true, revealTiming: "reveal-later" }));
  const invalid = await validateLiveCampaignPreflight(command, { ...completeApproval, executionMode: "resume", resumeArtifactPath: "lifecycle-artifacts/invalid.json" }, admin, { activeRunId: null, environment: env, repoRoot, workerHealthy: true });
  assert.equal(invalid.ok, false);

  await fs.writeFile(path.join(repoRoot, "lifecycle-artifacts", "valid.json"), JSON.stringify({
    buryClicked: true,
    createdAt: new Date().toISOString(),
    draftIdBeforeCreate: "draft-123",
    environment: "staging",
    maskedTestEmail: "p***@example.test",
    observedCreateSuccess: true,
    revealLaterFlowClassification: "scheduled-before-reveal",
    revealLaterSchedule: { scheduledAtIso: "2026-08-03T12:00:00.000Z" },
    revealTiming: "reveal-later"
  }));
  const valid = await validateLiveCampaignPreflight(command, { ...completeApproval, executionMode: "resume", resumeArtifactPath: "lifecycle-artifacts/valid.json" }, admin, { activeRunId: null, environment: env, repoRoot, workerHealthy: true });
  assert.equal(valid.ok, true);
  assert.equal(valid.ok ? valid.context.resumeArtifact?.filePath : null, "lifecycle-artifacts/valid.json");
});

test("media preflight rejects a configured missing fixture", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-media-"));
  const command = requiredCommand("test_inssa_campaign_media");
  const result = await validateLiveCampaignPreflight(command, completeApproval, admin, {
    activeRunId: null,
    environment: {
      ...baseEnvironment(),
      INSSA_ENABLE_MEDIA_CAPSULE_TESTS: "1",
      INSSA_TEST_MEDIA_FIXTURE_PATH: "fixtures/missing.png",
      INSSA_US_MARKET_LOCATION: "nyc"
    },
    repoRoot,
    workerHealthy: true
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /fixture is unavailable/i);
});

test("preflight fails closed when the live staging env file contains shell content", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-env-syntax-"));
  await fs.writeFile(path.join(repoRoot, ".env.inssa.live-staging"), "INSSA_URL=https://staging.inssa.us\nnot-an-assignment\n");
  const result = await validateLiveCampaignPreflight(requiredCommand("test_inssa_campaign_text"), completeApproval, admin, {
    activeRunId: null,
    environment: baseEnvironment(),
    repoRoot,
    workerHealthy: true
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /line\(s\): 2/);
});

test("cleanup manifest records targets without persisting credentials or share tokens", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-cleanup-manifest-"));
  const artifactRoot = path.join(outputRoot, "lifecycle-artifacts");
  await fs.mkdir(artifactRoot);
  await fs.writeFile(path.join(artifactRoot, "lifecycle.json"), JSON.stringify({
    cleanupInstruction: "Delete QA capsule capsule-123 from staging.",
    finalBuryThenChooseClicked: true,
    lifecycleClassification: "finalized",
    maskedTestEmail: "p***@example.test",
    observedCreateSuccess: true,
    password: "must-not-persist",
    possibleFinalCapsuleId: "capsule-123",
    possibleShareToken: "must-not-persist",
    runId: "artifact-run-123"
  }));
  const command = requiredCommand("test_inssa_campaign_text");
  const manifest = await writeCleanupManifest({
    campaignKey: command.key,
    cleanup: null,
    commandSnapshot: command,
    completedAt: null,
    createdAt: new Date().toISOString(),
    durationMs: null,
    executionContext: null,
    exitCode: null,
    id: "run-123",
    requestedBy: "admin@example.test",
    startedAt: null,
    status: "running",
    updatedAt: new Date().toISOString()
  }, outputRoot);
  assert.ok(manifest);
  assert.deepEqual(manifest.createdCapsuleIds, ["capsule-123"]);
  assert.deepEqual(manifest.affectedUsers, ["p***@example.test"]);
  const persisted = await fs.readFile(path.join(outputRoot, "cleanup-manifest.json"), "utf8");
  assert.doesNotMatch(persisted, /must-not-persist/);
});

test("initial Bury does not count as the irreversible contact-share final action", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-cleanup-initial-bury-"));
  const artifactRoot = path.join(outputRoot, "lifecycle-artifacts");
  await fs.mkdir(artifactRoot);
  await fs.writeFile(path.join(artifactRoot, "lifecycle.json"), JSON.stringify({
    buryClicked: true,
    cleanupInstruction: "Review draft cleanup.",
    environment: "staging",
    observedCreateSuccess: false,
    runId: "artifact-run-initial-bury"
  }));
  const command = requiredCommand("test_inssa_campaign_text");
  const manifest = await writeCleanupManifest({
    campaignKey: command.key,
    cleanup: null,
    commandSnapshot: command,
    completedAt: null,
    createdAt: new Date().toISOString(),
    durationMs: null,
    executionContext: null,
    exitCode: 1,
    id: "run-initial-bury",
    requestedBy: "admin@example.test",
    startedAt: null,
    status: "failed",
    updatedAt: new Date().toISOString()
  }, outputRoot);
  assert.equal(manifest?.finalActionPerformed, false);
});

test("pre-finalization upload evidence records media without claiming a capsule document id", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-cleanup-media-"));
  const artifactRoot = path.join(outputRoot, "lifecycle-artifacts");
  await fs.mkdir(artifactRoot);
  await fs.writeFile(path.join(artifactRoot, "media.json"), JSON.stringify({
    cleanupInstruction: "Delete the QA media object.",
    maskedTestEmail: "p***@example.test",
    observedCreateSuccess: true,
    possibleFinalCapsuleId: "unverified-capsule-id",
    requestUrl: "https://firebasestorage.googleapis.com/v0/b/example/o/timecapsules%2Fqa-media.webp?alt=media",
    runId: "artifact-media"
  }));
  const command = requiredCommand("test_inssa_campaign_media");
  const manifest = await writeCleanupManifest({
    campaignKey: command.key,
    cleanup: null,
    commandSnapshot: command,
    completedAt: null,
    createdAt: new Date().toISOString(),
    durationMs: null,
    executionContext: {
      approvalAcknowledgements: [],
      approvalConfirmedAt: new Date().toISOString(),
      approvedBy: "admin@example.test",
      cleanupPolicy: {
        dedicatedQaAccountsConfirmed: true,
        deferredModeEnabled: true,
        maxMutationRunsPerDay: 10,
        maxUnresolvedAgeDays: 90,
        maxUnresolvedObjects: 10,
        retentionDays: 90
      },
      executionMode: null,
      irreversibleFinalAction: true,
      resumeArtifact: null,
      schemaVersion: 1,
      targetHost: "staging.inssa.us"
    },
    exitCode: null,
    id: "run-media",
    requestedBy: "admin@example.test",
    startedAt: null,
    status: "running",
    updatedAt: new Date().toISOString()
  }, outputRoot);
  assert.ok(manifest);
  assert.deepEqual(manifest.createdCapsuleIds, []);
  assert.deepEqual(manifest.createdMediaIds, ["qa-media.webp"]);
  assert.equal(manifest.status, "cleanup_unavailable");
});

test("finalized media lifecycle records the capsule, media object, recipient, type, and state without false unexpected-data blocking", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-cleanup-finalized-media-"));
  const artifactRoot = path.join(outputRoot, "lifecycle-artifacts");
  await fs.mkdir(artifactRoot);
  await fs.writeFile(path.join(artifactRoot, "media.json"), JSON.stringify({
    cleanupInstruction: "Delete the exact media capsule and associated image.",
    finalShareActionClicked: true,
    maskedTestEmail: "p***@example.test",
    mediaType: "image",
    possibleFinalCapsuleId: "capsule-media-123",
    requestUrl: "https://firebasestorage.googleapis.com/v0/b/example/o/timecapsules%2Fqa-media.webp?alt=media",
    resultingObjectState: "shared-contact-finalized",
    selectedContactTarget: "s***@example.test"
  }));
  const command = requiredCommand("test_inssa_campaign_media");
  const manifest = await writeCleanupManifest({
    campaignKey: command.key,
    cleanup: null,
    commandSnapshot: command,
    completedAt: null,
    createdAt: new Date().toISOString(),
    durationMs: null,
    executionContext: {
      approvalAcknowledgements: [],
      approvalConfirmedAt: new Date().toISOString(),
      approvedBy: "admin@example.test",
      cleanupPolicy: {
        dedicatedQaAccountsConfirmed: true,
        deferredModeEnabled: true,
        maxMutationRunsPerDay: 10,
        maxUnresolvedAgeDays: 90,
        maxUnresolvedObjects: 10,
        retentionDays: 90
      },
      executionMode: null,
      irreversibleFinalAction: true,
      resumeArtifact: null,
      schemaVersion: 1,
      targetHost: "staging.inssa.us"
    },
    exitCode: null,
    id: "run-finalized-media",
    requestedBy: "admin@example.test",
    startedAt: null,
    status: "running",
    updatedAt: new Date().toISOString()
  }, outputRoot);

  assert.ok(manifest);
  assert.deepEqual(manifest.createdCapsuleIds, ["capsule-media-123"]);
  assert.deepEqual(manifest.createdMediaIds, ["qa-media.webp"]);
  assert.equal(manifest.selectedRecipient, "s***@example.test");
  assert.equal(manifest.mediaType, "image");
  assert.equal(manifest.lifecycleState, "shared-contact-finalized");
  assert.equal(manifest.unexpectedData, false);
  assert.equal(manifest.safelyAccounted, true);
  assert.equal(manifest.status, "cleanup_unavailable");
});

test("finalized video lifecycle records MP4 metadata and the selected recipient", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-cleanup-finalized-video-"));
  const artifactRoot = path.join(outputRoot, "lifecycle-artifacts");
  await fs.mkdir(artifactRoot);
  await fs.writeFile(path.join(artifactRoot, "video.json"), JSON.stringify({
    cleanupInstruction: "Delete the exact video capsule and associated MP4.",
    finalShareActionClicked: true,
    maskedTestEmail: "p***@example.test",
    mediaType: "video",
    possibleFinalCapsuleId: "capsule-video-123",
    requestUrl: "https://firebasestorage.googleapis.com/v0/b/example/o/timecapsules%2Fsample-video.mp4?alt=media",
    resultingObjectState: "shared-contact-finalized",
    selectedContactTarget: "s***@example.test"
  }));
  const command = requiredCommand("test_inssa_campaign_video");
  const manifest = await writeCleanupManifest({
    campaignKey: command.key,
    cleanup: null,
    commandSnapshot: command,
    completedAt: null,
    createdAt: new Date().toISOString(),
    durationMs: null,
    executionContext: {
      approvalAcknowledgements: [],
      approvalConfirmedAt: new Date().toISOString(),
      approvedBy: "admin@example.test",
      cleanupPolicy: {
        dedicatedQaAccountsConfirmed: true,
        deferredModeEnabled: true,
        maxMutationRunsPerDay: 10,
        maxUnresolvedAgeDays: 90,
        maxUnresolvedObjects: 10,
        retentionDays: 90
      },
      executionMode: null,
      irreversibleFinalAction: true,
      resumeArtifact: null,
      schemaVersion: 1,
      targetHost: "staging.inssa.us"
    },
    exitCode: null,
    id: "run-finalized-video",
    requestedBy: "admin@example.test",
    startedAt: null,
    status: "running",
    updatedAt: new Date().toISOString()
  }, outputRoot);

  assert.ok(manifest);
  assert.deepEqual(manifest.createdCapsuleIds, ["capsule-video-123"]);
  assert.deepEqual(manifest.createdMediaIds, ["sample-video.mp4"]);
  assert.equal(manifest.selectedRecipient, "s***@example.test");
  assert.equal(manifest.mediaType, "video");
  assert.equal(manifest.lifecycleState, "shared-contact-finalized");
  assert.equal(manifest.unexpectedData, false);
  assert.equal(manifest.safelyAccounted, true);
  assert.equal(manifest.status, "cleanup_unavailable");
});

test("pending cleanup blocks every governed mutation before approval", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-pending-cleanup-"));
  const outputRoot = path.join(repoRoot, "run-output", "blocked-run");
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, "cleanup-manifest.json"), JSON.stringify({
    createdCapsuleIds: ["capsule-blocker-123"],
    runId: "blocked-run",
    status: "pending"
  }));

  const blocker = await findPendingCleanupBlocker(repoRoot);
  assert.equal(blocker?.runId, "blocked-run");
  const result = await validateLiveCampaignPreflight(
    requiredCommand("test_inssa_campaign_text"),
    completeApproval,
    admin,
    { activeRunId: null, environment: baseEnvironment(), repoRoot, workerHealthy: true }
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /remains pending/i);
});

test("identified QA-owned cleanup_unavailable records allow the next mutation within configured limits", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-deferred-cleanup-"));
  const runId = "deferred-run";
  const objectId = "deferred-capsule-123";
  const createdAt = new Date().toISOString();
  await fs.mkdir(path.join(repoRoot, "run-output", runId), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "dashboard", "config"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "run-output", runId, "cleanup-manifest.json"), JSON.stringify({
    affectedUsers: ["q***@example.test"],
    createdCapsuleIds: [objectId],
    createdMediaIds: [],
    runId,
    status: "cleanup_unavailable"
  }));
  await fs.writeFile(path.join(repoRoot, "dashboard", "config", "cleanup-ledger-seed.json"), JSON.stringify({ records: [{
    affectedUsers: ["q***@example.test"],
    campaignKey: "test_inssa_campaign_text",
    createdAt,
    dedicatedQaAccount: true,
    deferredAt: createdAt,
    environment: "staging",
    evidencePaths: [`run-output/${runId}/cleanup-manifest.json`],
    id: `${runId}:time_capsule:${objectId}`,
    notes: "Tracked deferred test object.",
    objectId,
    objectPath: `timeCapsules/${objectId}`,
    objectType: "time_capsule",
    originatingRunId: runId,
    ownerAccount: "q***@example.test",
    product: "INSSA",
    reasonCode: "INSSA-CLEANUP-UNAVAILABLE",
    resolvedAt: null,
    retentionUntil: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    safelyAccounted: true,
    schemaVersion: 1,
    securitySensitive: false,
    sensitiveValuesExcluded: true,
    status: "cleanup_unavailable",
    unexpectedData: false,
    updatedAt: createdAt,
    verificationMethods: ["Run-owned evidence"]
  }] }));

  const result = await validateLiveCampaignPreflight(
    requiredCommand("test_inssa_campaign_text"),
    completeApproval,
    admin,
    { activeRunId: null, environment: baseEnvironment(), repoRoot, workerHealthy: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.context.cleanupPolicy?.deferredModeEnabled : false, true);
});

test("cross-user preflight requires distinct primary and secondary accounts", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inssa-live-cross-user-"));
  const command = requiredCommand("test_inssa_campaign_cross_user");
  const result = await validateLiveCampaignPreflight(command, completeApproval, admin, {
    activeRunId: null,
    environment: { ...baseEnvironment(), INSSA_SECONDARY_TEST_EMAIL: "primary@example.test", INSSA_SECONDARY_TEST_PASSWORD: "secret" },
    repoRoot,
    workerHealthy: true
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /distinct/i);
});

function requiredCommand(key: string) {
  const command = getInssaPhase1Command(key);
  assert.ok(command);
  return command;
}

function baseEnvironment() {
  return {
    INSSA_ENABLE_LIVE_CAPSULE_TESTS: "1",
    INSSA_DEFERRED_CLEANUP_MODE: "1",
    INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED: "1",
    INSSA_MAX_MUTATION_RUNS_PER_DAY: "10",
    INSSA_MAX_UNRESOLVED_AGE_DAYS: "90",
    INSSA_MAX_UNRESOLVED_OBJECTS: "10",
    INSSA_SECONDARY_TEST_ACCOUNT_IS_DEDICATED_QA: "1",
    INSSA_TEST_ACCOUNT_IS_DEDICATED_QA: "1",
    INSSA_TEST_EMAIL: "primary@example.test",
    INSSA_TEST_PASSWORD: "secret",
    INSSA_SECONDARY_TEST_EMAIL: "secondary@example.test",
    INSSA_URL: "https://staging.inssa.us"
  };
}
