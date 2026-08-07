import type { Page, Request, Response } from "@playwright/test";
import type { InssaLiveCapsuleShareEvidence } from "../pages/inssa/time-capsule.page";

export const INSSA_DEBUG_LIFECYCLE_NETWORK_ENV_FLAG = "INSSA_DEBUG_LIFECYCLE_NETWORK";

export type InssaLifecycleNetworkPhase = "bury-click" | "post-create" | "pre-create" | "reveal-continue";

export type InssaLifecyclePersistenceClassification =
  | "finalization-response-missing"
  | "finalized-and-retrievable"
  | "finalized-but-unindexed"
  | "finalized-without-share-link"
  | "optimistic-ui-without-persistence"
  | "persistence-created-but-not-surfaced"
  | "reveal-now-needs-recipient-selection";

export type InssaLifecycleNetworkObservation = {
  collectionPaths: string[];
  debugBodySnippet?: string | null;
  debugJsonKeys?: string[];
  event: "request" | "requestfailed" | "response";
  method: string;
  observedAt: string;
  phase: InssaLifecycleNetworkPhase;
  possibleCapsuleIds: string[];
  possibleDocumentIds: string[];
  possibleShareTokens: string[];
  requestId: string;
  requestUrl: string;
  resourceType: string;
  responseStatus?: number;
};

export type InssaLifecycleNetworkSummary = {
  collectionPaths: string[];
  debugEnabled: boolean;
  failedRequestCount: number;
  finalizeLikeCallCount: number;
  firestoreWriteCount: number;
  lifecycleApiCallCount: number;
  possibleCapsuleIds: string[];
  possibleDocumentIds: string[];
  possibleShareTokens: string[];
  postBuryRequestCount: number;
  postContinueLifecycleApiResponseCount: number;
  postContinueRequestCount: number;
  responseCount: number;
  requestCount: number;
  storageCallCount: number;
  successfulPostContinueWriteCount: number;
};

export type InssaLifecycleNetworkMonitor = {
  attach: (page: Page) => void;
  flush: () => Promise<void>;
  observations: InssaLifecycleNetworkObservation[];
  summarize: () => InssaLifecycleNetworkSummary;
};

const DEBUG_BODY_LIMIT = 2_000;
const DEBUG_FLUSH_TIMEOUT_MS = 5_000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function createInssaLifecycleNetworkMonitor(input: {
  getPhase: () => InssaLifecycleNetworkPhase;
  onPossibleDocumentId?: (id: string) => void;
}): InssaLifecycleNetworkMonitor {
  const debugEnabled = process.env[INSSA_DEBUG_LIFECYCLE_NETWORK_ENV_FLAG] === "1";
  const observations: InssaLifecycleNetworkObservation[] = [];
  const pending: Promise<void>[] = [];
  const requestIds = new WeakMap<Request, string>();
  let requestSequence = 0;

  const nextRequestId = (request: Request): string => {
    const existing = requestIds.get(request);
    if (existing) {
      return existing;
    }

    requestSequence += 1;
    const requestId = `lifecycle-network-${requestSequence}`;
    requestIds.set(request, requestId);
    return requestId;
  };

  const recordObservation = (observation: InssaLifecycleNetworkObservation) => {
    observations.push(observation);
    observation.possibleDocumentIds.forEach((id) => input.onPossibleDocumentId?.(id));
    if (debugEnabled && (observation.phase === "bury-click" || observation.phase === "reveal-continue" || observation.phase === "post-create")) {
      console.log(
        [
          "INSSA_LIFECYCLE_NETWORK",
          observation.event,
          `phase=${observation.phase}`,
          `${observation.method} ${redactUrl(observation.requestUrl)}`,
          observation.responseStatus === undefined ? null : `status=${observation.responseStatus}`,
          observation.possibleDocumentIds.length > 0 ? `docIds=${observation.possibleDocumentIds.join(",")}` : null,
          observation.possibleShareTokens.length > 0 ? `shareTokens=${observation.possibleShareTokens.join(",")}` : null
        ]
          .filter((part): part is string => Boolean(part))
          .join(" ")
      );
    }
  };

  const handleRequest = (request: Request) => {
    if (!isRelevantLifecycleRequest(request)) {
      return;
    }

    const textForExtraction = expandLifecycleExtractionText([request.url(), request.postData() ?? ""].join("\n"));
    recordObservation({
      collectionPaths: extractCollectionPaths(textForExtraction),
      event: "request",
      method: request.method(),
      observedAt: new Date().toISOString(),
      phase: input.getPhase(),
      possibleCapsuleIds: extractPossibleCapsuleIds(textForExtraction),
      possibleDocumentIds: extractPossibleDocumentIds(textForExtraction),
      possibleShareTokens: extractPossibleShareTokens(textForExtraction),
      requestId: nextRequestId(request),
      requestUrl: redactUrl(request.url()),
      resourceType: request.resourceType(),
      ...(debugEnabled
        ? {
            debugBodySnippet: sanitizeBodySnippet(request.postData() ?? null),
            debugJsonKeys: extractJsonKeys(request.postData() ?? null)
          }
        : {})
    });
  };

  const handleResponse = async (response: Response) => {
    const request = response.request();
    if (!isRelevantLifecycleRequest(request)) {
      return;
    }

    let responseText: string | null = null;
    if (debugEnabled && isBodyInspectionSafe(response)) {
      responseText = await response.text().catch(() => null);
    }

    const textForExtraction = expandLifecycleExtractionText([request.url(), responseText ?? ""].join("\n"));
    recordObservation({
      collectionPaths: extractCollectionPaths(textForExtraction),
      debugBodySnippet: debugEnabled ? sanitizeBodySnippet(responseText) : undefined,
      debugJsonKeys: debugEnabled ? extractJsonKeys(responseText) : undefined,
      event: "response",
      method: request.method(),
      observedAt: new Date().toISOString(),
      phase: input.getPhase(),
      possibleCapsuleIds: extractPossibleCapsuleIds(textForExtraction),
      possibleDocumentIds: extractPossibleDocumentIds(textForExtraction),
      possibleShareTokens: extractPossibleShareTokens(textForExtraction),
      requestId: nextRequestId(request),
      requestUrl: redactUrl(request.url()),
      resourceType: request.resourceType(),
      responseStatus: response.status()
    });
  };

  const handleRequestFailed = (request: Request) => {
    if (!isRelevantLifecycleRequest(request)) {
      return;
    }

    const textForExtraction = expandLifecycleExtractionText([request.url(), request.failure()?.errorText ?? ""].join("\n"));
    recordObservation({
      collectionPaths: extractCollectionPaths(textForExtraction),
      debugBodySnippet: debugEnabled ? sanitizeBodySnippet(request.failure()?.errorText ?? null) : undefined,
      event: "requestfailed",
      method: request.method(),
      observedAt: new Date().toISOString(),
      phase: input.getPhase(),
      possibleCapsuleIds: extractPossibleCapsuleIds(textForExtraction),
      possibleDocumentIds: extractPossibleDocumentIds(textForExtraction),
      possibleShareTokens: extractPossibleShareTokens(textForExtraction),
      requestId: nextRequestId(request),
      requestUrl: redactUrl(request.url()),
      resourceType: request.resourceType()
    });
  };

  return {
    attach: (page) => {
      page.on("request", handleRequest);
      page.on("response", (response) => {
        const pendingResponse = handleResponse(response).catch(() => {});
        pending.push(pendingResponse);
      });
      page.on("requestfailed", handleRequestFailed);
    },
    flush: async () => {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => setTimeout(resolve, DEBUG_FLUSH_TIMEOUT_MS))
      ]);
    },
    observations,
    summarize: () => summarizeLifecycleNetwork(observations, debugEnabled)
  };
}

export function classifyInssaLifecyclePersistence(input: {
  finalShareEvidence: InssaLiveCapsuleShareEvidence | null;
  finalShareLink: string | null;
  finalUrl: string;
  networkSummary: InssaLifecycleNetworkSummary;
  observedCreateSuccess: boolean;
  possibleFinalCapsuleId: string | null;
  possibleShareToken: string | null;
  revealAudience: "personal-memory" | "shared-capsule" | null;
  revealSettingsContinueClicked: boolean;
  revealSettingsFollowupClickedLabel: string | null;
  revealTiming: "reveal-later" | "reveal-now" | null;
}): InssaLifecyclePersistenceClassification {
  const hasRetrievalMetadata = Boolean(
    input.finalShareLink ||
      input.possibleFinalCapsuleId ||
      input.possibleShareToken ||
      /\/capsule\//i.test(input.finalUrl) ||
      input.networkSummary.possibleCapsuleIds.length > 0 ||
      input.networkSummary.possibleShareTokens.length > 0
  );
  const hasPostContinueBackendResponse =
    input.networkSummary.successfulPostContinueWriteCount > 0 ||
    input.networkSummary.postContinueLifecycleApiResponseCount > 0;
  const hasPersistenceEvidence = input.networkSummary.firestoreWriteCount > 0 || input.networkSummary.possibleDocumentIds.length > 0;
  const isPendingRecipientOrLinkStep = Boolean(
    input.revealSettingsContinueClicked &&
      input.revealAudience === "shared-capsule" &&
      input.revealTiming === "reveal-now" &&
      !input.revealSettingsFollowupClickedLabel &&
      !hasRetrievalMetadata &&
      input.finalShareEvidence?.visibleButtons.some((label) =>
        /send to selected contacts|skip contacts|share link with others/i.test(label)
      )
  );

  if (hasRetrievalMetadata && input.observedCreateSuccess) {
    return "finalized-and-retrievable";
  }

  if (isPendingRecipientOrLinkStep) {
    return "reveal-now-needs-recipient-selection";
  }

  if (input.revealSettingsContinueClicked && !hasPostContinueBackendResponse) {
    return input.observedCreateSuccess ? "optimistic-ui-without-persistence" : "finalization-response-missing";
  }

  if (hasPersistenceEvidence && !hasRetrievalMetadata) {
    return "persistence-created-but-not-surfaced";
  }

  if (input.observedCreateSuccess && !hasRetrievalMetadata) {
    return "finalized-without-share-link";
  }

  return hasRetrievalMetadata ? "finalized-but-unindexed" : "finalization-response-missing";
}

function summarizeLifecycleNetwork(
  observations: InssaLifecycleNetworkObservation[],
  debugEnabled: boolean
): InssaLifecycleNetworkSummary {
  const requestObservations = observations.filter((observation) => observation.event === "request");
  const responseObservations = observations.filter((observation) => observation.event === "response");
  const successfulPostContinueWrites = responseObservations.filter(
    (observation) =>
      (observation.phase === "reveal-continue" || observation.phase === "post-create") &&
      isWriteMethod(observation.method) &&
      typeof observation.responseStatus === "number" &&
      observation.responseStatus < 400
  );

  return {
    collectionPaths: uniqueStrings(observations.flatMap((observation) => observation.collectionPaths)),
    debugEnabled,
    failedRequestCount: observations.filter((observation) => observation.event === "requestfailed").length,
    finalizeLikeCallCount: observations.filter((observation) => isFinalizeLikeUrl(observation.requestUrl)).length,
    firestoreWriteCount: responseObservations.filter(
      (observation) => isFirestoreUrl(observation.requestUrl) && isWriteMethod(observation.method) && (observation.responseStatus ?? 0) < 400
    ).length,
    lifecycleApiCallCount: responseObservations.filter(
      (observation) => isLifecycleApiUrl(observation.requestUrl) && (observation.responseStatus ?? 0) < 400
    ).length,
    possibleCapsuleIds: uniqueStrings(observations.flatMap((observation) => observation.possibleCapsuleIds)),
    possibleDocumentIds: uniqueStrings(observations.flatMap((observation) => observation.possibleDocumentIds)),
    possibleShareTokens: uniqueStrings(observations.flatMap((observation) => observation.possibleShareTokens)),
    postBuryRequestCount: requestObservations.filter((observation) => observation.phase === "bury-click").length,
    postContinueLifecycleApiResponseCount: responseObservations.filter(
      (observation) =>
        (observation.phase === "reveal-continue" || observation.phase === "post-create") &&
        isLifecycleApiUrl(observation.requestUrl) &&
        (observation.responseStatus ?? 0) < 400
    ).length,
    postContinueRequestCount: requestObservations.filter(
      (observation) => observation.phase === "reveal-continue" || observation.phase === "post-create"
    ).length,
    responseCount: responseObservations.length,
    requestCount: requestObservations.length,
    storageCallCount: observations.filter((observation) => isStorageUrl(observation.requestUrl)).length,
    successfulPostContinueWriteCount: successfulPostContinueWrites.length
  };
}

function isRelevantLifecycleRequest(request: Request): boolean {
  const url = request.url();
  if (/google-analytics|analytics\.google|doubleclick|\/collect\?|\/g\/collect/i.test(url)) {
    return false;
  }

  return (
    isWriteMethod(request.method()) ||
    /firestore|firebasestorage|storage\.googleapis|timecapsule|capsule|messages|cloudfunctions|functions|documents|share|reveal|graphql|\/api\//i.test(
      url
    )
  );
}

function isBodyInspectionSafe(response: Response): boolean {
  const contentType = response.headers()["content-type"]?.toLowerCase() ?? "";
  return (
    response.status() < 500 &&
    /json|text|javascript|x-www-form-urlencoded|grpc-web-text|protobuf/i.test(contentType)
  );
}

function isWriteMethod(method: string): boolean {
  return /^(POST|PUT|PATCH|DELETE)$/i.test(method);
}

function isFirestoreUrl(url: string): boolean {
  return /firestore|google\.firestore|\/documents\//i.test(url);
}

function isStorageUrl(url: string): boolean {
  return /firebasestorage|storage\.googleapis/i.test(url);
}

function isLifecycleApiUrl(url: string): boolean {
  return /capsule|timecapsule|share|reveal|finalize|bury|messages|cloudfunctions|functions|graphql|\/api\//i.test(url);
}

function isFinalizeLikeUrl(url: string): boolean {
  return /finalize|create|publish|share|reveal|bury|capsule/i.test(url);
}

function sanitizeBodySnippet(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return redactSecrets(value).slice(0, DEBUG_BODY_LIMIT);
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|auth|session|credential|password|secret|signature/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }

    return parsed.toString();
  } catch {
    return redactSecrets(url);
  }
}

function redactSecrets(value: string): string {
  return value
    .replace(/(["']?(?:accessToken|idToken|refreshToken|authorization|password|apiKey|key|secret|credential)["']?\s*[:=]\s*["']?)[^"',\s&}]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|access_token|id_token|refresh_token|key|signature)=)[^&\s]+/gi, "$1[redacted]");
}

function extractJsonKeys(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }

    return Object.keys(parsed).slice(0, 30);
  } catch {
    return [];
  }
}

function extractPossibleDocumentIds(value: string): string[] {
  const ids = new Set<string>();
  const addIfSafe = (candidate: string | undefined) => {
    if (!candidate || !SAFE_ID_PATTERN.test(candidate) || isKnownNonDocumentId(candidate)) {
      return;
    }

    ids.add(candidate);
  };

  for (const match of value.matchAll(/\b(?:capsuleId|draftId|documentId|docId|messageId|shareId|id)["'=:\s]+([A-Za-z0-9_-]{8,64})/gi)) {
    addIfSafe(match[1]);
  }

  for (const match of value.matchAll(/\/documents\/(?:[^/?#\s"'{}]+\/)*([A-Za-z0-9_-]{8,64})/gi)) {
    addIfSafe(match[1]);
  }

  for (const match of value.matchAll(/\/(?:capsules|drafts|messages|shares|timecapsules)\/([A-Za-z0-9_-]{8,64})/gi)) {
    addIfSafe(match[1]);
  }

  return [...ids];
}

export function extractInssaLifecycleIdentifiers(value: string) {
  const expanded = expandLifecycleExtractionText(value);
  return {
    capsuleIds: extractPossibleCapsuleIds(expanded),
    documentIds: extractPossibleDocumentIds(expanded),
    shareTokens: extractPossibleShareTokens(expanded)
  };
}

function expandLifecycleExtractionText(value: string): string {
  const variants = new Set([value]);
  let current = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current.replace(/\+/g, " "));
      variants.add(decoded);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return [...variants].join("\n");
}

function extractPossibleCapsuleIds(value: string): string[] {
  const ids = new Set<string>();
  const addIfSafe = (candidate: string | undefined) => {
    if (!candidate || !SAFE_ID_PATTERN.test(candidate) || isKnownNonDocumentId(candidate)) {
      return;
    }

    ids.add(candidate);
  };

  for (const match of value.matchAll(/\bcapsuleId["'=:\s]+([A-Za-z0-9_-]{8,64})/gi)) {
    addIfSafe(match[1]);
  }

  for (const match of value.matchAll(/\/capsule\/([A-Za-z0-9_-]{6,64})/gi)) {
    addIfSafe(match[1]);
  }

  for (const match of value.matchAll(/\/(?:capsules|timecapsules)\/([A-Za-z0-9_-]{8,64})/gi)) {
    addIfSafe(match[1]);
  }

  for (const match of value.matchAll(/\/documents\/(?:[^/?#\s"'{}]+\/)*(?:capsules|timecapsules)\/([A-Za-z0-9_-]{8,64})/gi)) {
    addIfSafe(match[1]);
  }

  return [...ids];
}

function extractPossibleShareTokens(value: string): string[] {
  const tokens = new Set<string>();
  for (const match of value.matchAll(/[?&](?:token|shareToken)=([A-Za-z0-9._-]{8,256})/gi)) {
    if (match[1] && !/^eyJ/i.test(match[1])) {
      tokens.add(match[1]);
    }
  }

  for (const match of value.matchAll(/\b(?:shareToken|publicToken)["'=:\s]+([A-Za-z0-9._-]{8,256})/gi)) {
    if (match[1] && !/^eyJ/i.test(match[1])) {
      tokens.add(match[1]);
    }
  }

  return [...tokens];
}

function extractCollectionPaths(value: string): string[] {
  const paths = new Set<string>();
  for (const match of value.matchAll(/\/documents\/([^?#\s"'{}]+)/gi)) {
    const path = match[1]?.replace(/\/[A-Za-z0-9_-]{8,64}(?=\/|$)/g, "/{id}");
    if (path) {
      paths.add(path.slice(0, 300));
    }
  }

  return [...paths];
}

function isKnownNonDocumentId(candidate: string): boolean {
  return (
    /^G-[A-Z0-9]+$/i.test(candidate) ||
    /^gsessionid$/i.test(candidate) ||
    /^AIza/i.test(candidate) ||
    /^eyJ/i.test(candidate) ||
    /^AMf-/i.test(candidate) ||
    candidate.includes(".")
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}
