import { expect, type Page } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials, login, logout } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import {
  assertInssaMutationFlagEnabled,
  buildInssaQaCapsuleSeed,
  getInssaCleanupCapabilities,
  getInssaMutationReadiness,
  INSSA_MUTATION_ENV_FLAG,
  isInssaQaArtifact
} from "../../utils/inssa-mutation";
import { withInssaStabilityMonitor } from "../../utils/monitor";
import { createConsoleSecurityMonitor } from "../../utils/security";
import { INSSA_DEFAULT_COMPOSE_ROUTE } from "../../utils/inssa-test-data";
import { test } from "./mutation-fixtures";

const AUTH_NETWORK_ALLOWLIST = [
  /securetoken\.googleapis\.com\/v1\/token/i,
  /identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/i
] as const;

const MUTATION_OPT_IN_ENABLED = process.env[INSSA_MUTATION_ENV_FLAG] === "1";

type RequestRecord = {
  bodyBytes: number;
  bodyKeys: string[];
  contentType: string | null;
  containsAuthorizationHeader: boolean;
  firestoreMutations: FirestoreMutationRecord[];
  hasQaMarker: boolean;
  method: string;
  resourceType: string;
  url: string;
};

type ResponseRecord = {
  contentType: string | null;
  method: string;
  ok: boolean;
  status: number;
  url: string;
};

type FailureRecord = {
  errorText: string;
  method: string;
  resourceType: string;
  url: string;
};

type TrafficCapture = {
  failures: FailureRecord[];
  requests: RequestRecord[];
  responses: ResponseRecord[];
};

type FirestoreMutationRecord = {
  channel: "listen" | "write";
  collection?: string;
  containsQaMarker: boolean;
  documentId?: string;
  draftStep?: string;
  expectedCount?: number;
  isDraft?: boolean;
  kind: "addTarget" | "delete" | "removeTarget" | "update";
  lifecycleStatus?: string;
  messageBody?: string;
  messageTitle?: string;
  status?: string;
  targetId?: number;
};

type RestoreClassification =
  | "deterministic-restore"
  | "failed-persistence"
  | "partial-restore"
  | "race-condition-overwrite"
  | "stale-overwrite"
  | "template-overwrite";

test.describe("INSSA cleanup capability audit", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!MUTATION_OPT_IN_ENABLED, `Requires ${INSSA_MUTATION_ENV_FLAG}=1 for opt-in draft lifecycle auditing.`);
  test.setTimeout(240_000);

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
    assertInssaMutationFlagEnabled();
  });

  test("qa draft can be recovered and discarded without leaving stale lifecycle state", async (
    { mutationCleanupTracker, mutationRunContext, page },
    testInfo
  ) => {
    test.fixme(
      true,
      "Superseded by draft-restore-hydration.spec.ts. This older direct-reopen audit clears compose cache and can bootstrap untagged default drafts after Save & exit."
    );
    test.slow();

    const landing = new LandingPage(page);
    const compose = new TimeCapsulePage(page);
    const errorMonitor = createInssaErrorMonitor(page);
    const securityMonitor = createConsoleSecurityMonitor(page);
    const capabilities = getInssaCleanupCapabilities();
    const readiness = getInssaMutationReadiness(capabilities);
    const seed = buildInssaQaCapsuleSeed(mutationRunContext, {
      bodySuffix: "cleanup-audit",
      subjectSuffix: "cleanup-audit"
    });

    let discardVerified = false;
    let draftSaved = false;
    let reopenedAfterSave = false;
    let recoveredAfterRefresh = false;
    let recoveredAfterRelogin = false;
    let staleArtifactDetected = false;

    let initialValues: { message: string; subject: string } | null = null;
    let reopenedValues: { message: string; subject: string } | null = null;
    let refreshedValues: { message: string; subject: string } | null = null;
    let reloginValues: { message: string; subject: string } | null = null;
    let afterDiscardValues: { message: string; subject: string } | null = null;
    let issueSummary: ReturnType<ReturnType<typeof createInssaErrorMonitor>["summarizeCategories"]> | null = null;
    let criticalIssueMessages: string[] = [];
    let initialControls = null;
    let reopenedControls = null;
    let typingTraffic: TrafficCapture | null = null;
    let saveTraffic: TrafficCapture | null = null;
    let discardTraffic: TrafficCapture | null = null;
    mutationCleanupTracker.markDraftOpened(seed.subject, {
      note: `run=${mutationRunContext.runId}`
    });

    try {
      await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
        await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
          phase: "navigation",
          route: "/"
        });
        await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
          phase: "assertion"
        });
        await monitor.step("open authenticated compose route directly", async () => {
          const response = await page.goto(INSSA_DEFAULT_COMPOSE_ROUTE, { waitUntil: "domcontentloaded" });
          if (response && response.status() >= 400) {
            throw new Error(`INSSA compose route returned HTTP ${response.status()}.`);
          }
        }, { phase: "navigation", route: "/timecapsule" });
        await monitor.step("assert compose surface", () => compose.expectComposeSurface(), {
          phase: "assertion",
          route: "/timecapsule"
        });

        initialControls = await monitor.step("snapshot initial lifecycle controls", () => compose.snapshotLifecycleControls(), {
          phase: "assertion"
        });
        initialValues = await monitor.step("read initial compose values", () => compose.readComposeValues(), {
          phase: "assertion"
        });

        await monitor.step("assert no stale qa artifact is already present", async () => {
          const existing = await compose.readComposeValues();
          const existingQaArtifact =
            isInssaQaArtifact(existing.subject) ||
            isInssaQaArtifact(existing.message) ||
            existing.subject.includes(seed.subject) ||
            existing.message.includes(seed.message);

          if (existingQaArtifact) {
            staleArtifactDetected = true;
            mutationCleanupTracker.recordStaleArtifact(existing.subject || seed.subject, {
              kind: "draft",
              note: "Compose opened with a pre-existing QA-tagged draft before the audit seeded new data."
            });
          }

          expect(existingQaArtifact, "Expected compose to open without a stale QA-tagged draft already present.").toBe(
            false
          );
        }, { phase: "assertion" });

        typingTraffic = await monitor.step("fill qa draft fields and observe background persistence traffic", async () => {
          return captureLifecycleTraffic(page, async () => {
            await compose.fillComposeFields(seed);
            await waitForSettledSurface(page, 8_000);
          });
        }, { phase: "interaction" });

        await monitor.step("assert qa draft fields are visible in compose", () => compose.expectComposeValues(seed), {
          phase: "assertion"
        });

        saveTraffic = await monitor.step("save qa draft and exit compose", async () => {
          return captureLifecycleTraffic(page, async () => {
            await compose.saveAndExit();
            await waitForSettledSurface(page, 12_000);
          });
        }, { phase: "interaction" });
        draftSaved = hasMutationWrites(saveTraffic);

        await monitor.step("reopen compose and inspect saved draft recovery", async () => {
          await reopenComposeFromAuthenticatedSurface(page, landing, compose);
          reopenedValues = await compose.readComposeValues();
          reopenedAfterSave = reopenedValues.subject === seed.subject && reopenedValues.message === seed.message;
        }, { phase: "interaction" });

        reopenedControls = await monitor.step(
          "snapshot lifecycle controls after reopening the draft",
          () => compose.snapshotLifecycleControls(),
          { phase: "assertion" }
        );

        await monitor.step("refresh compose and inspect persisted draft state", async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
          await waitForSettledSurface(page, 15_000);
          await compose.expectComposeSurface();
          refreshedValues = await compose.readComposeValues();
          recoveredAfterRefresh = refreshedValues.subject === seed.subject && refreshedValues.message === seed.message;
        }, { phase: "navigation" });

        await monitor.step("logout and login before inspecting saved draft recovery", async () => {
          await logout(page);
          await login(page);
          await landing.goToHome();
          await landing.expectAuthenticatedLandingSurface();
          const response = await page.goto(INSSA_DEFAULT_COMPOSE_ROUTE, { waitUntil: "domcontentloaded" });
          if (response && response.status() >= 400) {
            throw new Error(`INSSA compose route returned HTTP ${response.status()} after re-login.`);
          }
          await compose.expectComposeSurface();
          reloginValues = await compose.readComposeValues();
          recoveredAfterRelogin = reloginValues.subject === seed.subject && reloginValues.message === seed.message;
        }, { phase: "navigation" });

        discardTraffic = await monitor.step("discard qa draft and observe cleanup traffic", async () => {
          return captureLifecycleTraffic(page, async () => {
            await compose.discardDraft();
            await waitForSettledSurface(page, 12_000);
          });
        }, { phase: "interaction" });

        await monitor.step("reopen compose and inspect qa draft cleanup", async () => {
          await reopenComposeFromAuthenticatedSurface(page, landing, compose);
          await compose.expectComposeSurface();
          afterDiscardValues = await compose.readComposeValues();

          const leftoverQaArtifact =
            afterDiscardValues.subject.includes(seed.subject) ||
            afterDiscardValues.message.includes(seed.message) ||
            isInssaQaArtifact(afterDiscardValues.subject) ||
            isInssaQaArtifact(afterDiscardValues.message);

          if (!leftoverQaArtifact) {
            discardVerified = true;
            mutationCleanupTracker.markDraftDiscarded(seed.subject, {
              note: "Draft was absent after discard, reopen, and compose re-hydration."
            });
          }
        }, { phase: "assertion" });

        await monitor.step("flush sensitive-data findings for audit reporting", () => securityMonitor.flush(), {
          phase: "assertion"
        });
        await monitor.step("summarize inssa issues for audit reporting", async () => {
          issueSummary = errorMonitor.summarizeCategories();
          criticalIssueMessages = errorMonitor
            .classifyIssues()
            .filter((issue) => issue.severity === "critical")
            .map((issue) => `${issue.category}: ${issue.issue.message}`);
        }, { phase: "assertion" });
      });
    } finally {
      if (!discardVerified) {
        const cleanupResult = await bestEffortDiscardDraft(page, landing, compose, seed);

        if (cleanupResult.discarded) {
          discardVerified = true;
          mutationCleanupTracker.markDraftDiscarded(seed.subject, {
            note: cleanupResult.note
          });
        } else {
          mutationCleanupTracker.markCleanupSkipped(seed.subject, {
            kind: "draft",
            note: cleanupResult.note
          });
        }
      }

      await securityMonitor.flush();
      const securityFindings = summarizeSecurityMonitor(securityMonitor);
      const restoreMatrix = {
        refresh: classifyRestoreState(seed, initialValues, refreshedValues),
        relogin: classifyRestoreState(seed, initialValues, reloginValues),
        reopen: classifyRestoreState(seed, initialValues, reopenedValues)
      };
      const typingSummary = summarizeTrafficCapture(typingTraffic);
      const saveSummary = summarizeTrafficCapture(saveTraffic);
      const discardSummary = summarizeTrafficCapture(discardTraffic);
      const auditReport = {
        capabilities,
        cleanupReadyForLifecycleMutations:
          discardVerified &&
          reopenedAfterSave &&
          recoveredAfterRefresh &&
          recoveredAfterRelogin &&
          readiness.lifecycleReady,
        discardTraffic: discardSummary,
        discardVerified,
        draftSaved,
        draftPersistence: {
          autosaveWritesObservedBeforeExplicitSave: Boolean(typingTraffic && hasMutationWrites(typingTraffic)),
          draftRecoveredAfterRefresh: recoveredAfterRefresh,
          draftRecoveredAfterRelogin: recoveredAfterRelogin,
          draftReopenedAfterSave: reopenedAfterSave,
          explicitSaveWritesObserved: Boolean(saveTraffic && hasMutationWrites(saveTraffic))
        },
        afterDiscardValues,
        refreshedValues,
        initialControls,
        initialValues,
        issueSummary,
        criticalIssueMessages,
        mutationRunContext,
        readiness,
        reloginValues,
        reopenedValues,
        reopenedControls,
        restoreMatrix,
        rootCauseAssessment: inferRootCause({
          discardSummary,
          initialValues,
          reopenedValues,
          saveSummary,
          seed,
          typingSummary
        }),
        saveTraffic: saveSummary,
        securityFindings,
        seed,
        staleArtifactDetected,
        typingTraffic: typingSummary
      };

      console.log(`INSSA_DRAFT_AUDIT ${JSON.stringify(auditReport)}`);
      await testInfo.attach("inssa-cleanup-capability-audit.json", {
        body: JSON.stringify(auditReport, null, 2),
        contentType: "application/json"
      });
    }

    expect(initialControls?.discardDraft, "Expected the compose surface to expose Discard draft.").toBe(true);
    expect(initialControls?.saveAndExit, "Expected the compose surface to expose Save & exit.").toBe(true);
    expect(discardVerified, "Expected the QA draft to be fully removed after Discard draft.").toBe(true);
  });
});

async function reopenComposeFromAuthenticatedSurface(
  page: Page,
  landing: LandingPage,
  compose: TimeCapsulePage
): Promise<void> {
  if (!/\/timecapsule(?:\?|$)/i.test(page.url())) {
    await landing.goToHome();
    await landing.expectAuthenticatedLandingSurface();
    const response = await page.goto(INSSA_DEFAULT_COMPOSE_ROUTE, { waitUntil: "domcontentloaded" });
    if (response && response.status() >= 400) {
      throw new Error(`INSSA compose route returned HTTP ${response.status()} during reopen.`);
    }
  }

  await compose.expectComposeSurface();
}

async function bestEffortDiscardDraft(
  page: Page,
  landing: LandingPage,
  compose: TimeCapsulePage,
  seed: { message: string; subject: string }
): Promise<{ discarded: boolean; note: string }> {
  try {
    await reopenComposeFromAuthenticatedSurface(page, landing, compose);
    const values = await compose.readComposeValues();
    const hasQaDraft =
      values.subject.includes(seed.subject) ||
      values.message.includes(seed.message) ||
      isInssaQaArtifact(values.subject) ||
      isInssaQaArtifact(values.message);
    const hasAnyDraftSignal = Boolean(values.subject.trim() || values.message.trim());

    if (!hasQaDraft && !hasAnyDraftSignal) {
      return {
        discarded: false,
        note: "Best-effort cleanup found no visible draft values to discard."
      };
    }

    await compose.discardDraft();
    await waitForSettledSurface(page, 12_000);
    await reopenComposeFromAuthenticatedSurface(page, landing, compose);
    const afterDiscardValues = await compose.readComposeValues();
    const leftoverQaArtifact =
      afterDiscardValues.subject.includes(seed.subject) ||
      afterDiscardValues.message.includes(seed.message) ||
      isInssaQaArtifact(afterDiscardValues.subject) ||
      isInssaQaArtifact(afterDiscardValues.message);

    if (leftoverQaArtifact) {
      return {
        discarded: false,
        note: "Best-effort cleanup reopened compose but still found QA-tagged draft values."
      };
    }

    return {
      discarded: true,
      note: "Best-effort cleanup discarded the QA draft after a failed assertion path."
    };
  } catch (error) {
    return {
      discarded: false,
      note: `Best-effort cleanup could not verify draft discard: ${formatError(error)}`
    };
  }
}

async function captureLifecycleTraffic(page: Page, action: () => Promise<void>): Promise<TrafficCapture> {
  const requests: RequestRecord[] = [];
  const responses: ResponseRecord[] = [];
  const failures: FailureRecord[] = [];

  const onRequest = (request: any) => {
    if (!isLifecycleRelevantRequest(page, request)) {
      return;
    }

    const bodyText = request.postData() ?? null;
    const firestoreMutations = summarizeFirestoreMutations(request.url(), bodyText);

    requests.push({
      bodyBytes: bodyText?.length ?? 0,
      bodyKeys: summarizeBodyKeys(bodyText),
      contentType: request.headers()["content-type"] ?? null,
      containsAuthorizationHeader: containsAuthorizationHeader(bodyText),
      firestoreMutations,
      hasQaMarker: isInssaQaArtifact(bodyText),
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url()
    });
  };

  const onResponse = (response: any) => {
    const request = response.request();
    if (!isLifecycleRelevantRequest(page, request)) {
      return;
    }

    responses.push({
      contentType: response.headers()["content-type"] ?? null,
      method: request.method(),
      ok: response.ok(),
      status: response.status(),
      url: response.url()
    });
  };

  const onRequestFailed = (request: any) => {
    if (!isLifecycleRelevantRequest(page, request)) {
      return;
    }

    failures.push({
      errorText: request.failure()?.errorText ?? "Request failed without a browser error message.",
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url()
    });
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  try {
    await action();
    await waitForSettledSurface(page, 8_000);
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }

  return { failures, requests, responses };
}

function hasMutationWrites(traffic: TrafficCapture | null): boolean {
  return Boolean(
    traffic?.requests.some((request) => ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) ||
      traffic?.responses.some((response) => ["POST", "PUT", "PATCH", "DELETE"].includes(response.method))
  );
}

function isLifecycleRelevantRequest(page: Page, request: { method(): string; resourceType(): string; url(): string }): boolean {
  const url = request.url();
  const method = request.method();
  const resourceType = request.resourceType();
  const sameOrigin = isSameOrigin(url, page.url() || assertValidInssaUrl());
  const firebaseLifecycleTraffic =
    /google\.firestore\.v1\.Firestore\/(?:Write|Listen)\/channel|firestore\.googleapis\.com\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents/i.test(
      url
    );

  if ((sameOrigin || firebaseLifecycleTraffic) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return true;
  }

  if ((sameOrigin || firebaseLifecycleTraffic) && ["xhr", "fetch", "document"].includes(resourceType)) {
    return /timecapsule|capsule|draft|share|save|discard|profile|google\.firestore\.v1\.Firestore\/(?:Write|Listen)\/channel|firestore\.googleapis\.com\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents/i.test(
      url
    );
  }

  return false;
}

function isSameOrigin(candidateUrl: string, currentUrl: string): boolean {
  try {
    return new URL(candidateUrl).origin === new URL(currentUrl).origin;
  } catch {
    return false;
  }
}

function summarizeBodyKeys(rawBody: string | null): string[] {
  if (!rawBody) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed).slice(0, 12);
    }
  } catch {
    // Ignore non-JSON payloads. A missing key summary is sufficient for the audit.
  }

  return [];
}

async function waitForSettledSurface(page: Page, timeout: number): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
}

function summarizeTrafficCapture(traffic: TrafficCapture | null) {
  if (!traffic) {
    return null;
  }

  const firestoreMutations = traffic.requests.flatMap((request) => request.firestoreMutations);

  return {
    authorizationHeaderInRequestBodies: traffic.requests.some((request) => request.containsAuthorizationHeader),
    failureCount: traffic.failures.length,
    firestoreMutations,
    hasQaMarkerInRequestBody: traffic.requests.some((request) => request.hasQaMarker),
    mutationRequestCount: traffic.requests.filter((request) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
    ).length,
    mutationResponseCount: traffic.responses.filter((response) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(response.method)
    ).length,
    requestCount: traffic.requests.length,
    responseCount: traffic.responses.length
  };
}

function summarizeFirestoreMutations(url: string, rawBody: string | null): FirestoreMutationRecord[] {
  if (!rawBody || !/google\.firestore\.v1\.Firestore\/(?:Write|Listen)\/channel/i.test(url)) {
    return [];
  }

  const params = new URLSearchParams(rawBody);
  const channel = /\/Write\/channel/i.test(url) ? "write" : "listen";
  const mutations: FirestoreMutationRecord[] = [];

  for (const [key, value] of params.entries()) {
    if (!/^req\d+___data__$/.test(key)) {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }

    if (parsed?.addTarget) {
      mutations.push({
        channel,
        collection: extractCollectionFromTarget(parsed.addTarget),
        containsQaMarker: false,
        expectedCount: parsed.addTarget.expectedCount,
        kind: "addTarget",
        targetId: parsed.addTarget.targetId
      });
    }

    if (parsed?.removeTarget) {
      mutations.push({
        channel,
        containsQaMarker: false,
        kind: "removeTarget",
        targetId: parsed.removeTarget
      });
    }

    for (const write of parsed?.writes ?? []) {
      if (write.update) {
        const fields = write.update.fields ?? {};
        const messageTitle = extractFirestoreString(fields.messageTitle);
        const messageBody = extractFirestoreString(fields.messageBody);
        mutations.push({
          channel,
          collection: extractCollectionFromDocumentName(write.update.name),
          containsQaMarker:
            isInssaQaArtifact(messageTitle) || isInssaQaArtifact(messageBody) || isInssaQaArtifact(value),
          documentId: extractDocumentId(write.update.name),
          draftStep: extractFirestoreString(fields.draftStep),
          isDraft: extractFirestoreBoolean(fields.isDraft),
          kind: "update",
          lifecycleStatus: extractFirestoreString(fields.lifecycleStatus),
          messageBody,
          messageTitle,
          status: extractFirestoreString(fields.status)
        });
      }

      if (write.delete) {
        mutations.push({
          channel,
          collection: extractCollectionFromDocumentName(write.delete),
          containsQaMarker: false,
          documentId: extractDocumentId(write.delete),
          kind: "delete"
        });
      }
    }
  }

  return mutations;
}

function classifyRestoreState(
  seed: { message: string; subject: string },
  initialValues: { message: string; subject: string } | null,
  restoredValues: { message: string; subject: string } | null
): RestoreClassification | "not-observed" {
  if (!restoredValues) {
    return "not-observed";
  }

  const exactSubject = restoredValues.subject === seed.subject;
  const exactMessage = restoredValues.message === seed.message;
  if (exactSubject && exactMessage) {
    return "deterministic-restore";
  }

  const partialSubject = exactSubject || restoredValues.subject.includes(seed.subject);
  const partialMessage = exactMessage || restoredValues.message.includes(seed.message);
  if (partialSubject || partialMessage) {
    return "partial-restore";
  }

  if (
    initialValues &&
    restoredValues.subject === initialValues.subject &&
    restoredValues.message === initialValues.message
  ) {
    return "template-overwrite";
  }

  if (/this place made me think of you:/i.test(restoredValues.message)) {
    return "template-overwrite";
  }

  if (!restoredValues.subject.trim() && !restoredValues.message.trim()) {
    return "failed-persistence";
  }

  return "stale-overwrite";
}

function inferRootCause(input: {
  discardSummary: ReturnType<typeof summarizeTrafficCapture> | null;
  initialValues: { message: string; subject: string } | null;
  reopenedValues: { message: string; subject: string } | null;
  saveSummary: ReturnType<typeof summarizeTrafficCapture> | null;
  seed: { message: string; subject: string };
  typingSummary: ReturnType<typeof summarizeTrafficCapture> | null;
}) {
  const reopenClassification = classifyRestoreState(input.seed, input.initialValues, input.reopenedValues);
  const typingQaWrite = input.typingSummary?.firestoreMutations.some(
    (mutation) => mutation.kind === "update" && mutation.containsQaMarker
  );
  const typingTemplateWrite = input.typingSummary?.firestoreMutations.some(
    (mutation) =>
      mutation.kind === "update" &&
      Boolean(mutation.messageBody) &&
      /this place made me think of you:/i.test(mutation.messageBody)
  );
  const saveWrites = input.saveSummary?.mutationRequestCount ?? 0;
  const discardDeletes = input.discardSummary?.firestoreMutations.some((mutation) => mutation.kind === "delete");

  return {
    confidence:
      reopenClassification === "template-overwrite" && typingTemplateWrite && !typingQaWrite ? "high" : "moderate",
    direction:
      reopenClassification === "template-overwrite" && typingTemplateWrite && !typingQaWrite
        ? "frontend-persistence-serialization"
        : reopenClassification === "partial-restore"
          ? "hydration-ordering-or-partial-field-mapping"
          : "inconclusive",
    evidence: {
      discardDeletes,
      reopenClassification,
      saveWrites,
      typingQaWrite,
      typingTemplateWrite
    }
  };
}

function summarizeSecurityMonitor(
  monitor: ReturnType<typeof createConsoleSecurityMonitor>
) {
  return {
    consoleFindings: monitor.findings.map((finding) => ({
      matchedRule: finding.matchedRule,
      pageUrl: finding.pageUrl,
      sourceUrl: finding.location.url ?? null,
      type: finding.type
    })),
    networkFindings: monitor.networkFindings.map((finding) => ({
      matchedRule: finding.matchedRule,
      requestUrl: finding.requestUrl,
      status: finding.status
    }))
  };
}

function containsAuthorizationHeader(rawBody: string | null): boolean {
  if (!rawBody) {
    return false;
  }

  const decoded = safeDecodeURIComponent(rawBody);
  return /\bAuthorization\s*:\s*Bearer\b/i.test(decoded);
}

function extractCollectionFromTarget(target: any): string | undefined {
  if (target?.documents?.documents?.[0]) {
    return extractCollectionFromDocumentName(target.documents.documents[0]);
  }

  return target?.query?.structuredQuery?.from?.[0]?.collectionId;
}

function extractCollectionFromDocumentName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  const parts = name.split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : undefined;
}

function extractDocumentId(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  const parts = name.split("/");
  return parts.at(-1);
}

function extractFirestoreString(field: any): string | undefined {
  if (field?.stringValue !== undefined) {
    return String(field.stringValue);
  }

  return undefined;
}

function extractFirestoreBoolean(field: any): boolean | undefined {
  if (field?.booleanValue !== undefined) {
    return Boolean(field.booleanValue);
  }

  return undefined;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
