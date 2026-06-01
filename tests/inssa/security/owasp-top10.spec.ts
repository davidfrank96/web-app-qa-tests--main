import { promises as fs } from "fs";
import path from "path";
import type { APIRequestContext, Browser } from "@playwright/test";
import { test, type Page } from "../fixtures";
import { assertValidInssaUrl } from "../../../utils/env";
import { INSSA_DEFAULT_COMPOSE_ROUTE } from "../../../utils/inssa-test-data";

const STAGING_HOSTNAME = "staging.inssa.us";
const SECURITY_OUTPUT_DIR = path.resolve(process.cwd(), "security-campaigns");
const SECURITY_INPUT_PROBES_ENABLED = process.env.INSSA_ENABLE_SECURITY_INPUT_PROBES === "1";
const NAVIGATION_TIMEOUT_MS = 8_000;

type RiskLevel = "Informational" | "Low" | "Medium" | "High" | "Critical";
type SecurityClassification = "expected" | "high-risk" | "warning";

type SecurityFinding = {
  affectedRoute: string;
  classification: SecurityClassification;
  evidence: Record<string, unknown>;
  finding: string;
  owaspCategory: string;
  recommendation: string;
  reproduction: string;
  risk: RiskLevel;
};

type RouteProbe = {
  bodySample: string;
  context: string;
  error: string | null;
  finalUrl: string;
  httpStatus: number | null;
  route: string;
  visibleButtons: string[];
};

type LifecycleArtifact = {
  environment?: string;
  finalShareLink?: string | null;
  message?: string;
  observedCreateSuccess?: boolean;
  possibleFinalCapsuleId?: string | null;
  possibleShareToken?: string | null;
  revealLaterSchedule?: {
    scheduledAtIso?: string | null;
  } | null;
  revealTiming?: string | null;
  runId?: string;
  subject?: string;
};

test.describe("INSSA OWASP Top 10 security campaign", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.setTimeout(240_000);

  test("collects non-destructive OWASP black-box security signals", async ({ browser, page, request }, testInfo) => {
    const configuredUrl = assertValidInssaUrl();
    const origin = new URL(configuredUrl).origin;
    const hostname = new URL(configuredUrl).hostname.toLowerCase();
    if (hostname !== STAGING_HOSTNAME) {
      throw new Error(`INSSA security campaign is hard-blocked outside ${STAGING_HOSTNAME}. Current host: "${hostname}".`);
    }

    await fs.mkdir(SECURITY_OUTPUT_DIR, { recursive: true });

    const findings: SecurityFinding[] = [];
    const lifecycleArtifacts = await readLifecycleArtifacts();

    await page.goto("/", { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(750);

    const accessControl = await collectAccessControl({
      authenticatedPage: page,
      browser,
      findings,
      lifecycleArtifacts,
      origin
    });
    const headers = await collectHeadersAndCrypto({
      authenticatedPage: page,
      findings,
      origin,
      request
    });
    const injection = await collectInjectionSignals({
      authenticatedPage: page,
      findings,
      origin
    });
    const authentication = await collectAuthenticationSignals({
      authenticatedPage: page,
      browser,
      findings,
      origin
    });
    const misconfiguration = await collectMisconfigurationSignals({
      authenticatedPage: page,
      findings,
      origin
    });

    await writeJson("access-control.json", accessControl);
    await writeJson("security-headers.json", headers);
    await writeJson("injection.json", injection);
    await writeJson("authentication.json", authentication);
    await writeJson("misconfiguration.json", misconfiguration);

    await testInfo.attach("inssa-owasp-security-findings.json", {
      body: JSON.stringify({ findings }, null, 2),
      contentType: "application/json"
    });

    const hardFailures = findings.filter(
      (finding) =>
        finding.risk === "Critical" &&
        /confirmed access-control bypass|confirmed authentication bypass|confirmed reflected xss|confirmed stored xss|confirmed sensitive data exposure/i.test(
          finding.finding
        )
    );

    if (hardFailures.length > 0) {
      throw new Error(`Confirmed critical INSSA security finding(s): ${hardFailures.map((finding) => finding.finding).join("; ")}`);
    }
  });
});

async function collectAccessControl(input: {
  authenticatedPage: Page;
  browser: Browser;
  findings: SecurityFinding[];
  lifecycleArtifacts: LifecycleArtifact[];
  origin: string;
}) {
  const protectedRoutes = ["/me", "/settings", "/points-ledger", "/profile/connections", "/profile/connections/requests", "/messages"];
  const authenticatedRoutes: RouteProbe[] = [];
  const loggedOutRoutes: RouteProbe[] = [];
  for (const route of protectedRoutes) {
    authenticatedRoutes.push(await probeRoute(input.authenticatedPage, route, "authenticated", input.origin));
    loggedOutRoutes.push(await probeRouteInNewContext(input.browser, route, "logged-out", input.origin));
  }

  const capsuleProbes: RouteProbe[] = [];
  for (const artifact of selectRepresentativeLifecycleArtifacts(input.lifecycleArtifacts)) {
    const tokenized = resolveArtifactShareLink(input.origin, artifact);
    const tokenless = tokenized ? stripToken(tokenized) : resolveTokenlessCapsuleUrl(input.origin, artifact);
    if (tokenized) {
      capsuleProbes.push(await probeRouteInNewContext(input.browser, tokenized, "clean-tokenized", input.origin));
      capsuleProbes.push(await probeRoute(input.authenticatedPage, tokenized, "authenticated-tokenized", input.origin));
    }
    if (tokenless) {
      capsuleProbes.push(await probeRouteInNewContext(input.browser, tokenless, "logged-out-tokenless", input.origin));
      capsuleProbes.push(await probeRoute(input.authenticatedPage, tokenless, "authenticated-tokenless", input.origin));
    }
  }

  const tokenlessExactContent = capsuleProbes.some((probe) =>
    input.lifecycleArtifacts.some((artifact) => containsExactQaContent(probe.bodySample, artifact))
  );
  if (tokenlessExactContent) {
    input.findings.push({
      affectedRoute: "/capsule/<id>",
      classification: "high-risk",
      evidence: {
        probeCount: capsuleProbes.length,
        tokenlessExactContent
      },
      finding: "Tokenless capsule route exposes exact QA-created content",
      owaspCategory: "A01: Broken Access Control",
      recommendation: "Confirm whether tokenless capsule-by-ID access is intended. If not, require token or authorization for capsule content.",
      reproduction: "Open a known QA-created /capsule/<id> URL without the token in a clean or logged-out browser context.",
      risk: "High"
    });
  }

  const revealLaterArtifacts = input.lifecycleArtifacts.filter((artifact) => artifact.revealTiming === "reveal-later");
  const revealLaterProtection = revealLaterArtifacts.map((artifact) => {
    const scheduledAtIso = artifact.revealLaterSchedule?.scheduledAtIso ?? null;
    const pending = scheduledAtIso ? Date.now() < Date.parse(scheduledAtIso) : false;
    return {
      pending,
      runId: artifact.runId ?? null,
      scheduledAtIso,
      subject: artifact.subject ?? null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    owaspCategory: "A01: Broken Access Control",
    protectedRoutes: {
      authenticated: authenticatedRoutes,
      loggedOut: loggedOutRoutes
    },
    capsuleProbes,
    revealLaterProtection,
    summary: {
      lifecycleArtifactCount: input.lifecycleArtifacts.length,
      tokenlessExactContent,
      loggedOutProtectedRouteCount: loggedOutRoutes.length
    }
  };
}

async function collectHeadersAndCrypto(input: {
  authenticatedPage: Page;
  findings: SecurityFinding[];
  origin: string;
  request: APIRequestContext;
}) {
  const httpsResponse = await input.request.get(input.origin, { failOnStatusCode: false, timeout: 10_000 });
  const headers = normalizeHeaders(httpsResponse.headers());
  const httpUrl = new URL(input.origin);
  httpUrl.protocol = "http:";
  const httpResponse = await input.request.get(httpUrl.toString(), {
    failOnStatusCode: false,
    maxRedirects: 0,
    timeout: 10_000
  });
  const cookies = (await input.authenticatedPage.context().cookies()).map((cookie) => ({
    domain: cookie.domain,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    sameSite: cookie.sameSite,
    secure: cookie.secure
  }));
  const storageSummary = await input.authenticatedPage.evaluate(() => {
    const summarize = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => Boolean(key))
        .map((key) => {
          const value = storage.getItem(key) ?? "";
          return {
            key,
            sensitiveName: /token|secret|password|credential|auth|session|bearer|jwt/i.test(key),
            sensitiveValuePattern: /eyJ|bearer|refresh|token|password|secret|api[_-]?key/i.test(value),
            valueLength: value.length
          };
        });

    return {
      localStorage: summarize(window.localStorage),
      sessionStorage: summarize(window.sessionStorage)
    };
  });

  const securityHeaderChecks = {
    contentSecurityPolicy: Boolean(headers["content-security-policy"]),
    hsts: Boolean(headers["strict-transport-security"]),
    permissionsPolicy: Boolean(headers["permissions-policy"]),
    referrerPolicy: Boolean(headers["referrer-policy"]),
    xContentTypeOptions: headers["x-content-type-options"] ?? null,
    xFrameOptions: headers["x-frame-options"] ?? null
  };
  if (!securityHeaderChecks.hsts) {
    input.findings.push({
      affectedRoute: "/",
      classification: "warning",
      evidence: { header: "strict-transport-security", present: false },
      finding: "HSTS header was not observed on the staging root response",
      owaspCategory: "A02: Cryptographic Failures / A05: Security Misconfiguration",
      recommendation: "Enable HSTS on staging if it is expected to mirror production transport security behavior.",
      reproduction: "Request https://staging.inssa.us and inspect response headers.",
      risk: "Medium"
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    owaspCategories: ["A02: Cryptographic Failures", "A05: Security Misconfiguration"],
    https: {
      rootStatus: httpsResponse.status(),
      httpStatus: httpResponse.status(),
      httpLocation: httpResponse.headers()["location"] ?? null,
      httpRedirectsToHttps: /^https:\/\//i.test(httpResponse.headers()["location"] ?? "")
    },
    securityHeaderChecks,
    headers: pickHeaders(headers, [
      "content-security-policy",
      "strict-transport-security",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
      "x-content-type-options"
    ]),
    cookies,
    storageSummary
  };
}

async function collectInjectionSignals(input: { authenticatedPage: Page; findings: SecurityFinding[]; origin: string }) {
  const payloads = [
    "' OR '1'='1",
    "<script>alert(1)</script>",
    "{{7*7}}",
    "${7*7}"
  ];
  const probes = [];
  for (const route of ["/", "/messages", "/profile/connections", "/profile/connections/requests"]) {
    probes.push(...(await probeVisibleInputs(input.authenticatedPage, route, payloads, input.origin)));
  }

  const composeProbe = SECURITY_INPUT_PROBES_ENABLED
    ? await probeVisibleInputs(input.authenticatedPage, INSSA_DEFAULT_COMPOSE_ROUTE, payloads, input.origin)
    : [
        {
          route: INSSA_DEFAULT_COMPOSE_ROUTE,
          status: "skipped",
          target: "subject/message",
          reason:
            "Subject/message injection probes are gated behind INSSA_ENABLE_SECURITY_INPUT_PROBES=1 because compose fields may autosave a draft."
        }
      ];
  probes.push(...composeProbe);

  const dialogTriggered = probes.some((probe) => "dialogTriggered" in probe && probe.dialogTriggered);
  if (dialogTriggered) {
    input.findings.push({
      affectedRoute: "visible text input",
      classification: "high-risk",
      evidence: { dialogTriggered },
      finding: "Confirmed reflected XSS dialog during safe input probing",
      owaspCategory: "A03: Injection",
      recommendation: "Escape user-controlled input before rendering it as HTML.",
      reproduction: "Enter the recorded XSS probe payload into the affected input and observe script execution.",
      risk: "Critical"
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    owaspCategory: "A03: Injection",
    payloads,
    securityInputProbesEnabled: SECURITY_INPUT_PROBES_ENABLED,
    probes
  };
}

async function collectAuthenticationSignals(input: {
  authenticatedPage: Page;
  browser: Browser;
  findings: SecurityFinding[];
  origin: string;
}) {
  const routes = ["/me", "/settings", "/messages", "/points-ledger", "/profile/connections"];
  const authenticated = [];
  const loggedOut = [];
  for (const route of routes) {
    authenticated.push(await probeRoute(input.authenticatedPage, route, "authenticated", input.origin));
    loggedOut.push(await probeRouteInNewContext(input.browser, route, "logged-out", input.origin));
  }

  const loggedOutProfileVisible = loggedOut.some((probe) => /sign out|alerts|following|loved|profile/i.test(probe.bodySample));
  if (loggedOutProfileVisible) {
    input.findings.push({
      affectedRoute: "protected authenticated route",
      classification: "high-risk",
      evidence: { loggedOutProfileVisible },
      finding: "Potential authenticated route content visible in logged-out context",
      owaspCategory: "A07: Identification and Authentication Failures",
      recommendation: "Verify route guards and server-side authorization for authenticated surfaces.",
      reproduction: "Open protected authenticated routes in a clean logged-out browser context.",
      risk: "High"
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    owaspCategory: "A07: Identification and Authentication Failures",
    authenticated,
    loggedOut,
    summary: {
      loggedOutProfileVisible,
      routeCount: routes.length
    }
  };
}

async function collectMisconfigurationSignals(input: { authenticatedPage: Page; findings: SecurityFinding[]; origin: string }) {
  await input.authenticatedPage.goto("/", { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await input.authenticatedPage.waitForTimeout(750);
  const pageInventory = await input.authenticatedPage.evaluate(() => {
    const scripts = Array.from(document.scripts).map((script) => script.src).filter(Boolean);
    const links = Array.from(document.querySelectorAll("link[href]")).map((link) => (link as HTMLLinkElement).href).filter(Boolean);
    const resources = [...scripts, ...links];
    const currentHost = window.location.hostname;
    const thirdPartyDomains = Array.from(
      new Set(
        resources
          .map((resource) => {
            try {
              return new URL(resource).hostname;
            } catch {
              return "";
            }
          })
          .filter((host) => host && host !== currentHost)
      )
    );
    const visibleText = document.body?.innerText ?? "";
    const inputDescriptors = Array.from(document.querySelectorAll("input, textarea"))
      .map((element) => {
        const input = element as HTMLInputElement | HTMLTextAreaElement;
        return {
          ariaLabel: input.getAttribute("aria-label") ?? "",
          name: input.getAttribute("name") ?? "",
          placeholder: input.getAttribute("placeholder") ?? "",
          type: input.getAttribute("type") ?? input.tagName.toLowerCase()
        };
      })
      .filter((descriptor) => /url|link|image|remote|callback|webhook/i.test(Object.values(descriptor).join(" ")));

    return {
      frameworkSignals: {
        nextJs: scripts.some((src) => src.includes("/_next/")),
        firebase: resources.some((src) => /firebase/i.test(src)),
        sentry: resources.some((src) => /sentry/i.test(src))
      },
      inputDescriptors,
      possibleVerboseErrors: /stack trace|exception|traceback|webpack|firebase error|uncaught/i.test(visibleText),
      resources,
      thirdPartyDomains
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    owaspCategories: [
      "A04: Insecure Design",
      "A05: Security Misconfiguration",
      "A06: Vulnerable and Outdated Components",
      "A08: Software and Data Integrity Failures",
      "A09: Security Logging and Monitoring Failures",
      "A10: Server-Side Request Forgery"
    ],
    checks: {
      componentFingerprints: pageInventory.frameworkSignals,
      thirdPartyDomains: pageInventory.thirdPartyDomains,
      externalResources: pageInventory.resources.map(redactUrl),
      urlFetchEntryPoints: pageInventory.inputDescriptors,
      verboseErrorsVisible: pageInventory.possibleVerboseErrors,
      lifecycleTraceability: "Lifecycle artifacts provide runId, subject, finalUrl, share-link evidence, and cleanup instruction when create campaigns are used."
    },
    ssrf: {
      attackPerformed: false,
      candidateEntryPoints: pageInventory.inputDescriptors,
      note: "Only visible URL/link/image input entry points are inventoried. No internal URLs or cloud metadata endpoints were requested."
    }
  };
}

async function probeVisibleInputs(page: Page, route: string, payloads: string[], origin: string) {
  const targetUrl = new URL(route, origin).toString();
  const result = [];
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);
    await page.waitForTimeout(500);
  const inputs = page.locator("input:visible, textarea:visible");
  const count = Math.min(await inputs.count().catch(() => 0), 3);

  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const descriptor = await input.evaluate((element) => ({
      ariaLabel: element.getAttribute("aria-label") ?? "",
      name: element.getAttribute("name") ?? "",
      placeholder: element.getAttribute("placeholder") ?? "",
      tagName: element.tagName.toLowerCase(),
      type: element.getAttribute("type") ?? ""
    })).catch(() => null);

    if (!descriptor) {
      continue;
    }

    if (/password|email|file|hidden/i.test(`${descriptor.type} ${descriptor.name} ${descriptor.placeholder}`)) {
      continue;
    }

    for (const payload of payloads) {
      let dialogTriggered = false;
      const dialogPromise = page.waitForEvent("dialog", { timeout: 500 }).then(async (dialog) => {
        dialogTriggered = true;
        await dialog.dismiss().catch(() => {});
      }).catch(() => {});
      await input.fill(`QA_SECURITY_PROBE ${payload}`).catch(() => {});
      await dialogPromise;
      const text = normalizeWhitespace((await page.locator("body").innerText().catch(() => "")));
      const html = await page.content().catch(() => "");
      result.push({
        dialogTriggered,
        encoded: html.includes("&lt;script&gt;") || html.includes("&lbrace;&lbrace;7*7&rbrace;&rbrace;"),
        payload,
        reflectedInText: text.includes(payload),
        route,
        stripped: !text.includes(payload) && !html.includes(payload),
        target: descriptor
      });
      await input.fill("").catch(() => {});
    }
  }

  if (result.length === 0) {
    result.push({
      route,
      status: "no-visible-safe-text-inputs"
    });
  }

  return result;
}

async function probeRouteInNewContext(
  browser: Browser,
  route: string,
  context: string,
  origin: string
): Promise<RouteProbe> {
  const browserContext = await browser.newContext({
    baseURL: origin,
    storageState: { cookies: [], origins: [] }
  });
  const page = await browserContext.newPage();
  try {
    return await probeRoute(page, route, context, origin);
  } finally {
    await browserContext.close().catch(() => {});
  }
}

async function probeRoute(page: Page, route: string, context: string, origin: string): Promise<RouteProbe> {
  const targetUrl = new URL(route, origin).toString();
  try {
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(750);
    const bodyText = maskEmails(normalizeWhitespace((await page.locator("body").innerText().catch(() => ""))).slice(0, 2_000));
    return {
      bodySample: bodyText,
      context,
      error: null,
      finalUrl: redactUrl(page.url()),
      httpStatus: response?.status() ?? null,
      route: redactUrl(targetUrl),
      visibleButtons: await listVisibleButtons(page)
    };
  } catch (error) {
    return {
      bodySample: "",
      context,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: redactUrl(page.url()),
      httpStatus: null,
      route: redactUrl(targetUrl),
      visibleButtons: []
    };
  }
}

async function listVisibleButtons(page: Page): Promise<string[]> {
  return await page.getByRole("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const element = button as HTMLElement;
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      })
      .map((button) => ((button as HTMLElement).innerText || button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 25)
  ).catch(() => []);
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await fs.mkdir(SECURITY_OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(SECURITY_OUTPUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readLifecycleArtifacts(): Promise<LifecycleArtifact[]> {
  const artifactDir = path.resolve(process.cwd(), "lifecycle-artifacts");
  const entries = await fs.readdir(artifactDir).catch(() => []);
  const artifacts: LifecycleArtifact[] = [];
  for (const fileName of entries) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(artifactDir, fileName);
    const artifact = JSON.parse(await fs.readFile(filePath, "utf8").catch(() => "null")) as LifecycleArtifact | null;
    if (artifact?.environment === "staging" && artifact.observedCreateSuccess && artifact.subject && artifact.message) {
      artifacts.push(artifact);
    }
  }

  return artifacts;
}

function selectRepresentativeLifecycleArtifacts(artifacts: LifecycleArtifact[]): LifecycleArtifact[] {
  const priority = [
    /^QA_LIVE_CAPSULE_/,
    /^QA_LIVE_MEDIA_CAPSULE_/,
    /^QA_LIVE_VIDEO_CAPSULE_/,
    /^QA_REVEAL_LATER_CAPSULE_/
  ];
  const selected: LifecycleArtifact[] = [];
  for (const pattern of priority) {
    const match = artifacts.find((artifact) => pattern.test(artifact.subject ?? ""));
    if (match) {
      selected.push(match);
    }
  }

  return selected.length > 0 ? selected : artifacts.slice(0, 3);
}

function resolveArtifactShareLink(origin: string, artifact: LifecycleArtifact): string | null {
  const raw =
    artifact.finalShareLink ||
    (artifact.possibleFinalCapsuleId
      ? `/capsule/${artifact.possibleFinalCapsuleId}${artifact.possibleShareToken ? `?token=${encodeURIComponent(artifact.possibleShareToken)}` : ""}`
      : null);
  return raw ? new URL(raw, origin).toString() : null;
}

function resolveTokenlessCapsuleUrl(origin: string, artifact: LifecycleArtifact): string | null {
  return artifact.possibleFinalCapsuleId ? new URL(`/capsule/${artifact.possibleFinalCapsuleId}`, origin).toString() : null;
}

function stripToken(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("token");
  return parsed.toString();
}

function containsExactQaContent(sample: string, artifact: LifecycleArtifact): boolean {
  return Boolean(artifact.subject && sample.includes(artifact.subject)) || Boolean(artifact.message && sample.includes(artifact.message));
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function pickHeaders(headers: Record<string, string>, keys: string[]): Record<string, string | null> {
  return Object.fromEntries(keys.map((key) => [key, headers[key] ?? null]));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function maskEmails(value: string): string {
  return value.replace(/\b([A-Z0-9._%+-])[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, "$1***@$2");
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    for (const key of ["token", "key", "gsessionid", "SID", "RID", "AID", "zx"]) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "<redacted>");
      }
    }
    return parsed.toString();
  } catch {
    return value.replace(/([?&](?:token|key|gsessionid|SID|RID|AID|zx)=)[^&]+/gi, "$1<redacted>");
  }
}
