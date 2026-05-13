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

const FIRESTORE_BACKEND_PATTERN = /Could not reach Cloud Firestore backend|FirebaseError: \[code=unavailable\]/i;
const FIRESTORE_CHANNEL_PATTERN =
  /firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/(?:Listen|Write)\/channel/i;
const FAILED_RESOURCE_4XX_PATTERN = /Failed to load resource: the server responded with a status of (400|404)/i;
const TELEMETRY_NOISE_PATTERN =
  /csp\.withgoogle\.com|report-only Content Security Policy|google-analytics\.com\/g\/collect|sentry\.io\/api\/|google\.com\/recaptcha|firebaseinstallations\.googleapis\.com/i;
const AZURE_PROFILE_FAILURE_PATTERN =
  /Error fetching Azure profile: TypeError: Failed to fetch|kbeanbetastaging\.azurewebsites\.net\/api\/public\/GetUserProfileByEmail|kbeanbetastaging\.azurewebsites\.net\/Account\/SocialLoginJWT/i;
const AUTH_FAILURE_PATTERN = /401|403|unauthorized|forbidden|sign in failed|invalid login|wrong password/i;
const RETRYABLE_NETWORK_PATTERN =
  /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT|ETIMEDOUT|timeout exceeded/i;
const FIREBASE_RETRYABLE_AUTH_NETWORK_PATTERN = /auth\/network-request-failed|Post-auth profile flow error/i;
const THIRD_PARTY_IMAGE_PATTERN =
  /googleusercontent\.com|gravatar\.com|firebasestorage\.googleapis\.com|storage\.googleapis\.com|maps\.gstatic\.com|googleapis\.com\/maps/i;

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
