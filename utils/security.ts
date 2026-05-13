import { expect, type ConsoleMessage, type Page, type Response } from "@playwright/test";

const DEFAULT_ALLOW_PATTERNS = [
  /\b(?:no|missing|without)\s+(?:api[_ -]?key|bearer token|token|secret|client secret|access token|refresh token|password|service[_ -]?role)s?\b/i,
  /\b(?:api[_ -]?key|bearer token|token|secret|client secret|access token|refresh token|password|service[_ -]?role)s?\s+(?:missing|not configured|not found|unavailable)\b/i,
  /\b(?:redacted|masked|sanitized|placeholder|dummy|example|test-only)\b/i,
  /<redacted>/i,
  /\[redacted\]/i
] as const;

const DEFAULT_SENSITIVE_PATTERNS = [
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/=]{12,}\b/
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
  },
  {
    name: "api-key-assignment",
    pattern: /\b(?:api[_ -]?key|apikey)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{8,}/i
  },
  {
    name: "token-assignment",
    pattern: /\b(?:token|access[_ -]?token|refresh[_ -]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{8,}/i
  },
  {
    name: "secret-assignment",
    pattern: /\b(?:secret|client[_ -]?secret|private[_ -]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{8,}/i
  },
  {
    name: "password-assignment",
    pattern: /\b(?:password|passwd|pwd)\b\s*[:=]\s*["']?[^\s"']{4,}/i
  },
  {
    name: "supabase-service-role",
    pattern: /\bsupabase\b[\s\S]{0,120}\bservice[_ -]?role\b|\bservice[_ -]?role\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{4,}/i
  }
] as const;

const NON_INSPECTABLE_RESPONSE_PATTERN =
  /google\.firestore\.v1\.Firestore\/(?:Listen|Write)\/channel|maps\.googleapis\.com\/\$rpc\//i;
const RESPONSE_TEXT_TIMEOUT_MS = 3_000;

export type ConsoleSecurityEntry = {
  location: {
    columnNumber?: number;
    lineNumber?: number;
    url?: string;
  };
  pageUrl: string;
  text: string;
  timestamp: string;
  type: string;
};

export type NetworkSecurityEntry = {
  contentType: string;
  method: string;
  pageUrl: string;
  requestUrl: string;
  resourceType: string;
  status: number;
  timestamp: string;
};

export type SensitiveConsoleFinding = ConsoleSecurityEntry & {
  matchedRule: string;
};

export type SensitiveNetworkFinding = NetworkSecurityEntry & {
  matchedRule: string;
};

export function createConsoleSecurityMonitor(
  page: Page,
  options: {
    allowPatterns?: RegExp[];
    sensitivePatterns?: Array<{
      name: string;
      pattern: RegExp;
    }>;
  } = {}
) {
  const allowPatterns = options.allowPatterns ?? [...DEFAULT_ALLOW_PATTERNS];
  const sensitivePatterns = options.sensitivePatterns ?? [...DEFAULT_SENSITIVE_PATTERNS];
  const entries: ConsoleSecurityEntry[] = [];
  const networkEntries: NetworkSecurityEntry[] = [];
  const consoleFindings: SensitiveConsoleFinding[] = [];
  const networkFindings: SensitiveNetworkFinding[] = [];
  const pendingScans = new Set<Promise<void>>();

  page.on("console", (message) => {
    const entry = toConsoleEntry(page, message);
    entries.push(entry);

    const matchedRule = findSensitiveRule(entry.text, sensitivePatterns, allowPatterns);
    if (!matchedRule) {
      return;
    }

    consoleFindings.push({
      ...entry,
      matchedRule
    });
  });

  page.on("response", (response) => {
    const pending = inspectResponseForSensitiveData(page, response, {
      allowPatterns,
      networkEntries,
      networkFindings,
      sensitivePatterns
    });

    pendingScans.add(pending);
    void pending.finally(() => {
      pendingScans.delete(pending);
    });
  });

  return {
    entries,
    findings: consoleFindings,
    networkEntries,
    networkFindings,
    async expectNoSensitiveLogs(extraAllowPatterns: RegExp[] = []) {
      await Promise.allSettled([...pendingScans]);

      const unexpectedConsole = consoleFindings.filter(
        (finding) => !matchesAnyPattern(finding.text, allowPatterns.concat(extraAllowPatterns))
      );
      const unexpectedNetwork = networkFindings.filter(
        (finding) => !matchesAnyPattern(finding.requestUrl, allowPatterns.concat(extraAllowPatterns))
      );

      expect(
        unexpectedConsole.length + unexpectedNetwork.length,
        unexpectedConsole.length + unexpectedNetwork.length === 0
          ? "Expected console logs and network responses to avoid exposing bearer tokens, API keys, passwords, or secrets."
          : `Sensitive data leakage detected:\n${unexpectedConsole
              .map((finding) => formatConsoleFinding(finding, sensitivePatterns))
              .concat(unexpectedNetwork.map((finding) => formatNetworkFinding(finding)))
              .join("\n")}`
      ).toBe(0);
    },
    async expectNoSensitiveDataExposure(extraAllowPatterns: RegExp[] = []) {
      await this.expectNoSensitiveLogs(extraAllowPatterns);
    },
    async flush() {
      await Promise.allSettled([...pendingScans]);
    }
  };
}

export function containsSensitiveData(
  text: string,
  options: {
    allowPatterns?: RegExp[];
    sensitivePatterns?: Array<{
      name: string;
      pattern: RegExp;
    }>;
  } = {}
): string | null {
  const allowPatterns = options.allowPatterns ?? [...DEFAULT_ALLOW_PATTERNS];
  const sensitivePatterns = options.sensitivePatterns ?? [...DEFAULT_SENSITIVE_PATTERNS];
  return findSensitiveRule(text, sensitivePatterns, allowPatterns);
}

export function containsSensitiveConsoleData(
  text: string,
  options: {
    allowPatterns?: RegExp[];
    sensitivePatterns?: Array<{
      name: string;
      pattern: RegExp;
    }>;
  } = {}
): string | null {
  return containsSensitiveData(text, options);
}

function toConsoleEntry(page: Page, message: ConsoleMessage): ConsoleSecurityEntry {
  const location = message.location();

  return {
    location: {
      columnNumber: location.columnNumber,
      lineNumber: location.lineNumber,
      url: location.url || undefined
    },
    pageUrl: page.url() || "about:blank",
    text: message.text(),
    timestamp: new Date().toISOString(),
    type: message.type()
  };
}

function toNetworkEntry(page: Page, response: Response): NetworkSecurityEntry {
  const request = response.request();

  return {
    contentType: response.headers()["content-type"] ?? "",
    method: request.method(),
    pageUrl: page.url() || "about:blank",
    requestUrl: response.url(),
    resourceType: request.resourceType(),
    status: response.status(),
    timestamp: new Date().toISOString()
  };
}

async function inspectResponseForSensitiveData(
  page: Page,
  response: Response,
  input: {
    allowPatterns: RegExp[];
    networkEntries: NetworkSecurityEntry[];
    networkFindings: SensitiveNetworkFinding[];
    sensitivePatterns: Array<{
      name: string;
      pattern: RegExp;
    }>;
  }
) {
  if (!shouldInspectResponse(response, page)) {
    return;
  }

  const entry = toNetworkEntry(page, response);
  input.networkEntries.push(entry);

  let bodyText = "";
  try {
    bodyText = await readResponseTextWithTimeout(response, RESPONSE_TEXT_TIMEOUT_MS);
  } catch {
    return;
  }

  if (!bodyText.trim()) {
    return;
  }

  const matchedRule = findSensitiveRule(bodyText, input.sensitivePatterns, input.allowPatterns);
  if (!matchedRule) {
    return;
  }

  input.networkFindings.push({
    ...entry,
    matchedRule
  });
}

function shouldInspectResponse(response: Response, page: Page): boolean {
  const request = response.request();
  const resourceType = request.resourceType();
  const url = response.url();

  if (!["fetch", "xhr"].includes(resourceType)) {
    return false;
  }

  if (NON_INSPECTABLE_RESPONSE_PATTERN.test(url)) {
    return false;
  }

  const contentType = response.headers()["content-type"] ?? "";
  if (!isInspectableContentType(contentType)) {
    return false;
  }

  return isSameOriginAppRequest(url, page) || /\/api\/|supabase|auth|session|token|vendor/i.test(url);
}

async function readResponseTextWithTimeout(response: Response, timeoutMs: number): Promise<string> {
  return Promise.race([
    response.text(),
    new Promise<string>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms while reading the response body.`));
      }, timeoutMs);
    })
  ]);
}

function isInspectableContentType(contentType: string): boolean {
  return /application\/(?:json|problem\+json|graphql-response\+json)|text\/(?:plain|json|javascript|html)/i.test(contentType);
}

function findSensitiveRule(
  text: string,
  sensitivePatterns: Array<{
    name: string;
    pattern: RegExp;
  }>,
  allowPatterns: RegExp[]
): string | null {
  if (matchesAnyPattern(text, allowPatterns)) {
    return null;
  }

  const match = sensitivePatterns.find((candidate) => candidate.pattern.test(text));
  return match?.name ?? null;
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function formatConsoleFinding(
  finding: SensitiveConsoleFinding,
  sensitivePatterns: Array<{
    name: string;
    pattern: RegExp;
  }>
) {
  const source = finding.location.url
    ? ` source=${finding.location.url}:${finding.location.lineNumber ?? 0}:${finding.location.columnNumber ?? 0}`
    : "";

  return `[${finding.matchedRule}] page="${finding.pageUrl}" type="${finding.type}"${source} text="${maskSensitiveText(
    finding.text,
    sensitivePatterns
  )}"`;
}

function formatNetworkFinding(finding: SensitiveNetworkFinding): string {
  return `[${finding.matchedRule}] page="${finding.pageUrl}" request="${finding.requestUrl}" method="${finding.method}" resource="${finding.resourceType}" status=${finding.status} contentType="${finding.contentType}"`;
}

function maskSensitiveText(
  text: string,
  sensitivePatterns: Array<{
    name: string;
    pattern: RegExp;
  }>
) {
  let masked = text;

  for (const candidate of sensitivePatterns) {
    masked = masked.replace(candidate.pattern, `[REDACTED:${candidate.name}]`);
  }

  return masked.length > 240 ? `${masked.slice(0, 240)}...` : masked;
}

function isSameOriginAppRequest(url: string, page: Page): boolean {
  const pageOrigin = getOrigin(page.url());
  const requestOrigin = getOrigin(url);
  return Boolean(pageOrigin && requestOrigin && pageOrigin === requestOrigin);
}

function getOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function containsSensitiveResponseData(
  text: string,
  options: {
    allowPatterns?: RegExp[];
    sensitivePatterns?: Array<{
      name: string;
      pattern: RegExp;
    }>;
  } = {}
): string | null {
  return containsSensitiveData(text, options);
}
