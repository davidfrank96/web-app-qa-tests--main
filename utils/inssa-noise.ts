export type InssaIssueKind = "console" | "pageerror" | "requestfailed";
export type InssaIssueSeverity = "acceptable" | "critical";
export type InssaIssueCategory =
  | "acceptable-staging-noise"
  | "auth-error"
  | "failed-api-dependency"
  | "fatal-error"
  | "retryable-network-error"
  | "transport-chatter"
  | "unknown";

export type InssaIssueLike = {
  action?: string;
  kind: InssaIssueKind;
  message: string;
  method?: string;
  pageUrl?: string;
  requestUrl?: string;
  resourceType?: string;
};

export type ClassifiedInssaIssue = {
  category: InssaIssueCategory;
  issue: InssaIssueLike;
  severity: InssaIssueSeverity;
};

export type InssaLifecycleRequestFailureContext = {
  finalizationAttempted?: boolean;
  lifecycleStage?: string;
  lifecycleSucceeded: boolean;
  retrievalSucceeded: boolean;
  shareLinkCaptured?: boolean;
  uploadSucceeded?: boolean;
};

export type InssaLifecycleNetworkIssueClassification =
  | "analytics-telemetry"
  | "auth-session-failure"
  | "create-finalize-failure"
  | "firestore-write-failure"
  | "optional-asset-preload"
  | "optional-preview-media"
  | "retrieval-failure"
  | "retryable-transport"
  | "share-link-generation-failure"
  | "stale-cdn-fetch"
  | "thumbnail-retry"
  | "unknown-fatal"
  | "upload-failure";

export type ClassifiedInssaLifecycleNetworkIssue = {
  classification: InssaLifecycleNetworkIssueClassification;
  impact: "fatal" | "warning";
  issue: InssaIssueLike;
  lifecycleStage: string;
  reason: string;
};

export type InssaLifecycleRequestFailureSummary = {
  classifications: Record<string, number>;
  fatal: number;
  total: number;
  warning: number;
};

const FIRESTORE_BACKEND_PATTERN = /Could not reach Cloud Firestore backend|FirebaseError: \[code=unavailable\]/i;
const FIRESTORE_CHANNEL_PATTERN =
  /firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/(?:Listen|Write)\/channel/i;
const FAILED_RESOURCE_4XX_PATTERN = /Failed to load resource: the server responded with a status of (400|404)/i;
const TELEMETRY_NOISE_PATTERN =
  /csp\.withgoogle\.com|report-only Content Security Policy|google-analytics\.com\/g\/collect|sentry\.io\/api\/|google\.com\/recaptcha|firebaseinstallations\.googleapis\.com/i;
const GOOGLE_MAPS_VECTOR_FALLBACK_PATTERN =
  /Attempted to load a Vector Map, but failed\. Falling back to Raster|developers\.google\.com\/maps\/documentation\/javascript\/webgl\/support/i;
const AZURE_PROFILE_FAILURE_PATTERN =
  /Error fetching Azure profile: TypeError: Failed to fetch|Error signing in with email and password: Failed to fetch \(kbeanbetastaging\.azurewebsites\.net\)|kbeanbetastaging\.azurewebsites\.net\/api\/public\/GetUserProfileByEmail|kbeanbetastaging\.azurewebsites\.net\/Account\/SocialLoginJWT/i;
const AUTH_FAILURE_PATTERN = /401|403|unauthorized|forbidden|sign in failed|invalid login|wrong password/i;
const RETRYABLE_NETWORK_PATTERN =
  /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT|ETIMEDOUT|timeout exceeded/i;
const FIREBASE_RETRYABLE_AUTH_NETWORK_PATTERN = /auth\/network-request-failed|Post-auth profile flow error/i;
const THIRD_PARTY_IMAGE_PATTERN =
  /googleusercontent\.com|gravatar\.com|firebasestorage\.googleapis\.com|storage\.googleapis\.com|maps\.gstatic\.com|googleapis\.com\/maps/i;
const OPTIONAL_ASSET_PATTERN =
  /\/assets\/|\/static\/|\.css(?:[?#]|$)|\.js(?:[?#]|$)|\.map(?:[?#]|$)|\.woff2?(?:[?#]|$)|\.ttf(?:[?#]|$)|favicon|manifest\.json/i;
const OPTIONAL_MEDIA_PATTERN =
  /thumbnail|preview|poster|avatar|image|photo|video|media|firebasestorage|storage\.googleapis|googleusercontent|blob:|cdn/i;
const LIFECYCLE_FINALIZE_PATTERN = /capsule|timecapsule|share|reveal|finalize|bury|cloudfunctions|functions|graphql|\/api\//i;
const AUTH_OR_SESSION_PATTERN =
  /401|403|unauthorized|forbidden|signin|sign-in|login|auth\/|identitytoolkit|securetoken|Account\/SocialLoginJWT|GetUserProfileByEmail|kbeanbetastaging\.azurewebsites\.net/i;

export function classifyInssaIssue(issue: InssaIssueLike): ClassifiedInssaIssue {
  const searchable = [
    issue.action ?? "",
    issue.kind,
    issue.message,
    issue.pageUrl ?? "",
    issue.requestUrl ?? "",
    issue.method ?? "",
    issue.resourceType ?? ""
  ].join("\n");

  if (issue.kind === "pageerror") {
    return {
      category: "fatal-error",
      issue,
      severity: "critical"
    };
  }

  if (FIRESTORE_BACKEND_PATTERN.test(searchable)) {
    return {
      category: "transport-chatter",
      issue,
      severity: "acceptable"
    };
  }

  if (FIRESTORE_CHANNEL_PATTERN.test(searchable)) {
    if (issue.kind === "console" && FAILED_RESOURCE_4XX_PATTERN.test(searchable)) {
      return {
        category: "transport-chatter",
        issue,
        severity: "acceptable"
      };
    }

    if (issue.kind === "requestfailed") {
      return {
        category: "transport-chatter",
        issue,
        severity: "acceptable"
      };
    }
  }

  if (issue.kind === "requestfailed" && issue.resourceType === "websocket") {
    return {
      category: "transport-chatter",
      issue,
      severity: "acceptable"
    };
  }

  if (issue.kind === "requestfailed" && RETRYABLE_NETWORK_PATTERN.test(searchable)) {
    return {
      category: "retryable-network-error",
      issue,
      severity: "acceptable"
    };
  }

  if (FIREBASE_RETRYABLE_AUTH_NETWORK_PATTERN.test(searchable)) {
    return {
      category: "retryable-network-error",
      issue,
      severity: "acceptable"
    };
  }

  if (TELEMETRY_NOISE_PATTERN.test(searchable)) {
    return {
      category: "acceptable-staging-noise",
      issue,
      severity: "acceptable"
    };
  }

  if (issue.kind === "console" && GOOGLE_MAPS_VECTOR_FALLBACK_PATTERN.test(searchable)) {
    return {
      category: "acceptable-staging-noise",
      issue,
      severity: "acceptable"
    };
  }

  if (AZURE_PROFILE_FAILURE_PATTERN.test(searchable)) {
    return {
      category: "failed-api-dependency",
      issue,
      severity: "acceptable"
    };
  }

  if ((issue.resourceType === "image" || issue.kind === "console") && THIRD_PARTY_IMAGE_PATTERN.test(searchable)) {
    return {
      category: "failed-api-dependency",
      issue,
      severity: "acceptable"
    };
  }

  if (AUTH_FAILURE_PATTERN.test(searchable)) {
    return {
      category: "auth-error",
      issue,
      severity: "critical"
    };
  }

  return {
    category: "unknown",
    issue,
    severity: "critical"
  };
}

export function summarizeInssaIssueCategories(issues: InssaIssueLike[]): Record<InssaIssueCategory, number> {
  return issues.reduce<Record<InssaIssueCategory, number>>(
    (counts, issue) => {
      const { category } = classifyInssaIssue(issue);
      counts[category] += 1;
      return counts;
    },
    {
      "acceptable-staging-noise": 0,
      "auth-error": 0,
      "failed-api-dependency": 0,
      "fatal-error": 0,
      "retryable-network-error": 0,
      "transport-chatter": 0,
      unknown: 0
    }
  );
}

export function isAcceptableInssaIssue(issue: InssaIssueLike): boolean {
  return classifyInssaIssue(issue).severity === "acceptable";
}

export function summarizeInssaLifecycleNetworkIssues(
  issues: ClassifiedInssaLifecycleNetworkIssue[]
): InssaLifecycleRequestFailureSummary {
  return issues.reduce<InssaLifecycleRequestFailureSummary>(
    (summary, issue) => {
      summary.total += 1;
      summary[issue.impact] += 1;
      summary.classifications[issue.classification] = (summary.classifications[issue.classification] ?? 0) + 1;
      return summary;
    },
    {
      classifications: {},
      fatal: 0,
      total: 0,
      warning: 0
    }
  );
}

export function classifyInssaRequestFailure(
  issue: InssaIssueLike,
  context: InssaLifecycleRequestFailureContext
): ClassifiedInssaLifecycleNetworkIssue {
  if (issue.kind !== "requestfailed") {
    return {
      classification: "unknown-fatal",
      impact: "fatal",
      issue,
      lifecycleStage: context.lifecycleStage ?? issue.action ?? "unknown",
      reason: "Only requestfailed issues can be lifecycle-network classified."
    };
  }

  return classifyLifecycleNetworkIssue(issue, context);
}

export function classifyLifecycleNetworkIssue(
  issue: InssaIssueLike,
  context: InssaLifecycleRequestFailureContext
): ClassifiedInssaLifecycleNetworkIssue {
  const lifecycleStage = context.lifecycleStage ?? issue.action ?? "unknown";
  const searchable = [
    issue.action ?? "",
    issue.kind,
    issue.message,
    issue.method ?? "",
    issue.pageUrl ?? "",
    issue.requestUrl ?? "",
    issue.resourceType ?? "",
    lifecycleStage
  ].join("\n");
  const method = issue.method?.toUpperCase() ?? "";
  const isWrite = /^(POST|PUT|PATCH|DELETE)$/i.test(method);
  const lifecycleSucceeded = context.lifecycleSucceeded && context.retrievalSucceeded;

  if (TELEMETRY_NOISE_PATTERN.test(searchable)) {
    return warning("analytics-telemetry", "Telemetry or analytics request failed.");
  }

  if (FIRESTORE_CHANNEL_PATTERN.test(searchable)) {
    if (/Listen\/channel/i.test(searchable)) {
      return warning("retryable-transport", "Firestore listen transport channel failed; lifecycle retrieval is asserted separately.");
    }

    if (/Write\/channel/i.test(searchable) && !lifecycleSucceeded) {
      return fatal("firestore-write-failure", "Firestore write transport failed before lifecycle retrieval was proven.");
    }

    return warning("retryable-transport", "Firestore write transport reported a failure after lifecycle retrieval was proven.");
  }

  if (AUTH_OR_SESSION_PATTERN.test(searchable)) {
    if (/securetoken\.googleapis\.com/i.test(searchable) && /net::ERR_ABORTED/i.test(searchable) && lifecycleSucceeded) {
      return warning("retryable-transport", "Background token refresh was aborted after lifecycle retrieval was proven.");
    }

    return fatal("auth-session-failure", "Authentication/session request failed.");
  }

  if (isWrite && isStorageRequest(searchable)) {
    return context.uploadSucceeded && lifecycleSucceeded
      ? warning("optional-preview-media", "Storage write/upload failure occurred after upload evidence was already observed.")
      : fatal("upload-failure", "Storage upload request failed before upload success was proven.");
  }

  if (isWrite && LIFECYCLE_FINALIZE_PATTERN.test(searchable)) {
    return fatal("create-finalize-failure", "Create/finalize lifecycle write request failed.");
  }

  if (!context.shareLinkCaptured && /share|token|capsule/i.test(searchable)) {
    return fatal("share-link-generation-failure", "Share-link/capsule request failed before share-link evidence was captured.");
  }

  if (!context.retrievalSucceeded && /\/capsule\/|share|token/i.test(searchable)) {
    return fatal("retrieval-failure", "Retrieval-related request failed before direct retrieval evidence was proven.");
  }

  if (RETRYABLE_NETWORK_PATTERN.test(searchable)) {
    return lifecycleSucceeded
      ? warning("retryable-transport", "Retryable network failure occurred after lifecycle retrieval was proven.")
      : fatal("retrieval-failure", "Retryable network failure occurred before lifecycle retrieval was proven.");
  }

  if (isOptionalPreviewMediaFailure(issue, searchable) && lifecycleSucceeded) {
    return warning("optional-preview-media", "Optional preview/media request failed after lifecycle retrieval was proven.");
  }

  if (isThumbnailRetryFailure(searchable) && lifecycleSucceeded) {
    return warning("thumbnail-retry", "Thumbnail/preview retry failed after lifecycle retrieval was proven.");
  }

  if (isOptionalAssetFailure(issue, searchable) && lifecycleSucceeded) {
    return warning("optional-asset-preload", "Optional asset/preload request failed after lifecycle retrieval was proven.");
  }

  if (isStaleCdnFailure(searchable) && lifecycleSucceeded) {
    return warning("stale-cdn-fetch", "CDN/storage GET failed after lifecycle retrieval was proven.");
  }

  if (!isWrite && lifecycleSucceeded) {
    return warning("optional-asset-preload", "Non-write request failed after lifecycle retrieval was proven.");
  }

  return fatal("unknown-fatal", "Request failed before lifecycle retrieval made it safe to downgrade.");

  function fatal(
    classification: InssaLifecycleNetworkIssueClassification,
    reason: string
  ): ClassifiedInssaLifecycleNetworkIssue {
    return {
      classification,
      impact: "fatal",
      issue,
      lifecycleStage,
      reason
    };
  }

  function warning(
    classification: InssaLifecycleNetworkIssueClassification,
    reason: string
  ): ClassifiedInssaLifecycleNetworkIssue {
    return {
      classification,
      impact: "warning",
      issue,
      lifecycleStage,
      reason
    };
  }
}

function isOptionalPreviewMediaFailure(issue: InssaIssueLike, searchable: string): boolean {
  return (
    issue.resourceType === "image" ||
    issue.resourceType === "media" ||
    issue.resourceType === "font" ||
    OPTIONAL_MEDIA_PATTERN.test(searchable)
  );
}

function isThumbnailRetryFailure(searchable: string): boolean {
  return /thumb|thumbnail|preview|poster/i.test(searchable);
}

function isOptionalAssetFailure(issue: InssaIssueLike, searchable: string): boolean {
  return (
    issue.resourceType === "image" ||
    issue.resourceType === "font" ||
    issue.resourceType === "stylesheet" ||
    issue.resourceType === "script" ||
    OPTIONAL_ASSET_PATTERN.test(searchable)
  );
}

function isStaleCdnFailure(searchable: string): boolean {
  return /cdn|firebasestorage|storage\.googleapis|googleusercontent|cloudfront|blob:/i.test(searchable);
}

function isStorageRequest(searchable: string): boolean {
  return /firebasestorage|storage\.googleapis|\/storage\/|upload/i.test(searchable);
}
