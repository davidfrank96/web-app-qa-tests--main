import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page, type Request, type Response, type TestInfo } from "@playwright/test";
import { AuthPage } from "../../pages/inssa/auth-page";
import { resolveAuthenticationMonitorCredentials } from "../../scripts/inssa/authentication-monitoring-config.js";

type AuthenticationMethod = "apple-sign-in" | "google-oauth" | "username-password";
type AuthenticationCheckStatus =
  | "blocked_external"
  | "disabled"
  | "failed"
  | "missing_configuration"
  | "passed"
  | "timed_out";
type CheckResult = {
  completedAt: string;
  durationMs: number;
  error: string | null;
  method: AuthenticationMethod;
  startedAt: string;
  status: AuthenticationCheckStatus;
};

type AuthenticationMonitorConfig = {
  environment: string;
  enabledMethods: Set<AuthenticationMethod>;
  outputRoot: string;
  targetHost: string;
  targetUrl: string;
};

type HarEntryState = {
  error: string | null;
  method: string;
  mimeType: string;
  startedAt: number;
  startedDateTime: string;
  status: number;
  statusText: string;
  time: number;
  url: string;
};

const AUTH_TIMEOUT_MS = readPositiveInteger(process.env.AUTH_MONITOR_TIMEOUT_MS, 90_000);
const AUTH_MONITOR_CAMPAIGN_REQUESTED = Boolean(process.env.AUTH_MONITOR_ENVIRONMENT);

test.describe.configure({ mode: "default", timeout: AUTH_TIMEOUT_MS });
test.skip(!AUTH_MONITOR_CAMPAIGN_REQUESTED, "Authentication monitoring runs only through its campaign runner.");

test("Username & Password", async ({ page }, testInfo) => {
  const config = authenticationMonitorConfig();
  await runAuthenticationCheck("username-password", config, page, testInfo, async () => {
    const credentials = credentialsFor(config.environment, "password");
    const authPage = new AuthPage(page);
    await authPage.goToSignIn();
    await authPage.signInWithEmail(credentials.email, credentials.password);
    await authPage.expectAuthenticatedState();
    await authPage.expectAuthenticatedSession();
    await authPage.signOut();
    await expectLoggedOutState(page);
  });
});

test("Google OAuth", async ({ page }, testInfo) => {
  const config = authenticationMonitorConfig();
  await runAuthenticationCheck("google-oauth", config, page, testInfo, async () => {
    const authPage = new AuthPage(page);
    await authPage.goToSignIn();
    const credentials = credentialsFor(config.environment, "google");
    const providerPage = await launchProvider(page, "Sign in with Google");
    await completeGoogleSignIn(providerPage, credentials.email, credentials.password);
    await settleProviderFlow(page, providerPage);
    await authPage.expectAuthenticatedState();
    await authPage.signOut();
    await expectLoggedOutState(page);
  });
});

test("Apple Sign-In", async ({ page }, testInfo) => {
  const config = authenticationMonitorConfig();
  await runAuthenticationCheck("apple-sign-in", config, page, testInfo, async () => {
    const authPage = new AuthPage(page);
    await authPage.goToSignIn();
    const credentials = credentialsFor(config.environment, "apple");
    const providerPage = await launchProvider(page, "Sign In with Apple");
    await completeAppleSignIn(providerPage, credentials.email, credentials.password);
    await settleProviderFlow(page, providerPage);
    await authPage.expectAuthenticatedState();
    await authPage.signOut();
    await expectLoggedOutState(page);
  });
});

async function runAuthenticationCheck(
  method: AuthenticationMethod,
  config: AuthenticationMonitorConfig,
  page: Page,
  testInfo: TestInfo,
  check: () => Promise<void>
) {
  const startedAt = new Date();
  const outputDir = path.join(config.outputRoot, method);
  const consoleEntries: Array<{ text: string; type: string }> = [];
  const networkEntries: Array<{ method?: string; status?: number; url: string }> = [];
  const requestStates = new Map<Request, HarEntryState>();
  const observedPages = new Set<Page>();
  await fs.mkdir(outputDir, { recursive: true });
  if (!config.enabledMethods.has(method)) {
    const completedAt = new Date();
    const result: CheckResult = {
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      error: null,
      method,
      startedAt: startedAt.toISOString(),
      status: "disabled"
    };
    const resultPath = path.join(outputDir, "result.json");
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await testInfo.attach(`${method}-result`, { contentType: "application/json", path: resultPath });
    return;
  }
  const attachObservers = (observedPage: Page) => {
    observedPages.add(observedPage);
    observedPage.on("console", (message) => consoleEntries.push({ text: sanitize(message.text()), type: message.type() }));
  };
  const context = page.context();
  attachObservers(page);
  context.on("page", attachObservers);
  context.on("request", (request) => {
    requestStates.set(request, {
      error: null,
      method: request.method(),
      mimeType: "",
      startedAt: Date.now(),
      startedDateTime: new Date().toISOString(),
      status: 0,
      statusText: "",
      time: 0,
      url: safeUrl(request.url())
    });
  });
  context.on("response", (response) => {
    const request = response.request();
    const state = requestStates.get(request);
    if (state) {
      state.mimeType = response.headers()["content-type"] ?? "";
      state.status = response.status();
      state.statusText = response.statusText();
    }
    if (response.status() >= 400) {
      networkEntries.push({ method: request.method(), status: response.status(), url: safeUrl(response.url()) });
    }
  });
  context.on("requestfinished", (request) => {
    const state = requestStates.get(request);
    if (state) state.time = Math.max(0, Date.now() - state.startedAt);
  });
  context.on("requestfailed", (request) => {
    const state = requestStates.get(request);
    if (state) {
      state.error = sanitize(request.failure()?.errorText ?? "Request failed");
      state.time = Math.max(0, Date.now() - state.startedAt);
    }
    networkEntries.push({ method: request.method(), url: safeUrl(request.url()) });
  });
  let failure: Error | null = null;
  try {
    await check();
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  const completedAt = new Date();
  const result: CheckResult = {
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    error: failure ? sanitize(failure.message) : null,
    method,
    startedAt: startedAt.toISOString(),
    status: failure ? classifyAuthenticationFailure(failure) : "passed"
  };
  const screenshotPath = path.join(outputDir, "screenshot.png");
  const consolePath = path.join(outputDir, "console-log.json");
  const resultPath = path.join(outputDir, "result.json");
  const screenshotPage = page.isClosed() ? context.pages().find((candidate) => !candidate.isClosed()) : page;
  if (screenshotPage) {
    await screenshotPage.screenshot({ fullPage: true, path: screenshotPath }).catch(async (error) => {
      failure ??= error instanceof Error ? error : new Error(String(error));
    });
  }
  await fs.writeFile(consolePath, `${JSON.stringify(consoleEntries, null, 2)}\n`, "utf8");
  if (failure) {
    const networkPath = path.join(outputDir, "network-log.json");
    const harPath = path.join(outputDir, "network.har");
    const diagnosticsPath = path.join(outputDir, "failure-diagnostics.json");
    const providerScreenshots = await captureFailurePages([...observedPages], outputDir, screenshotPage);
    await fs.writeFile(networkPath, `${JSON.stringify(networkEntries, null, 2)}\n`, "utf8");
    await fs.writeFile(harPath, `${JSON.stringify(createSanitizedHar([...requestStates.values()]), null, 2)}\n`, "utf8");
    await fs.writeFile(
      diagnosticsPath,
      `${JSON.stringify(await capturePageDiagnostics([...observedPages]), null, 2)}\n`,
      "utf8"
    );
    await testInfo.attach(`${method}-network`, { contentType: "application/json", path: networkPath });
    await testInfo.attach(`${method}-har`, { contentType: "application/json", path: harPath });
    await testInfo.attach(`${method}-diagnostics`, { contentType: "application/json", path: diagnosticsPath });
    for (const providerScreenshot of providerScreenshots) {
      await testInfo.attach(`${method}-${path.basename(providerScreenshot, ".png")}`, {
        contentType: "image/png",
        path: providerScreenshot
      });
    }
  }
  result.error = failure ? sanitize(failure.message) : null;
  result.status = failure ? classifyAuthenticationFailure(failure) : "passed";
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  await testInfo.attach(`${method}-result`, { contentType: "application/json", path: resultPath });
  await testInfo.attach(`${method}-console`, { contentType: "application/json", path: consolePath });
  if (screenshotPage) {
    await testInfo.attach(`${method}-screenshot`, { contentType: "image/png", path: screenshotPath }).catch(() => {});
  }
  if (failure) throw failure;
}

async function captureFailurePages(pages: Page[], outputDir: string, primaryPage: Page | undefined) {
  const screenshots: string[] = [];
  let index = 0;
  for (const observedPage of pages) {
    if (observedPage.isClosed() || observedPage === primaryPage) continue;
    index += 1;
    const screenshotPath = path.join(outputDir, `provider-page-${index}.png`);
    const captured = await observedPage
      .screenshot({ fullPage: true, path: screenshotPath })
      .then(() => true)
      .catch(() => false);
    if (captured) screenshots.push(screenshotPath);
  }
  return screenshots;
}

async function capturePageDiagnostics(pages: Page[]) {
  return await Promise.all(
    pages.map(async (observedPage, index) => {
      if (observedPage.isClosed()) return { closed: true, index };
      const details = await observedPage
        .evaluate(() => ({
          controls: [...document.querySelectorAll("button, input, a[href]")]
            .filter((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            })
            .slice(0, 30)
            .map((element) => ({
              ariaLabel: element.getAttribute("aria-label"),
              name: element.getAttribute("name"),
              role: element.getAttribute("role"),
              text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) || null,
              type: element.getAttribute("type")
            })),
          title: document.title
        }))
        .catch(() => ({ controls: [], title: "" }));
      return {
        closed: false,
        controls: details.controls.map((control) => ({
          ...control,
          ariaLabel: control.ariaLabel ? sanitize(control.ariaLabel) : null,
          name: control.name ? sanitize(control.name) : null,
          text: control.text ? sanitize(control.text) : null
        })),
        index,
        title: sanitize(details.title),
        url: safeUrl(observedPage.url())
      };
    })
  );
}

function createSanitizedHar(entries: HarEntryState[]) {
  return {
    log: {
      creator: { name: "INSSA Authentication Monitoring", version: "1" },
      entries: entries.map((entry) => ({
        cache: {},
        request: {
          bodySize: -1,
          cookies: [],
          headers: [],
          headersSize: -1,
          httpVersion: "",
          method: entry.method,
          queryString: [],
          url: entry.url
        },
        response: {
          bodySize: -1,
          content: { mimeType: entry.mimeType, size: -1 },
          cookies: [],
          headers: [],
          headersSize: -1,
          httpVersion: "",
          redirectURL: "",
          status: entry.status,
          statusText: entry.error ?? entry.statusText
        },
        startedDateTime: entry.startedDateTime,
        time: entry.time,
        timings: { blocked: -1, connect: -1, dns: -1, receive: 0, send: 0, ssl: -1, wait: entry.time }
      })),
      version: "1.2"
    }
  };
}

async function launchProvider(page: Page, accessibleName: string) {
  const button = page.getByRole("button").filter({ hasText: accessibleName }).first();
  await expect(button, `Expected ${accessibleName} on the INSSA sign-in page.`).toBeVisible();
  await expect(button, `Expected ${accessibleName} to be enabled.`).toBeEnabled();
  const popupPromise = page.context().waitForEvent("page", { timeout: 12_000 }).catch(() => null);
  const redirectPromise = page
    .waitForURL((url) => !isInssaUrl(url), { timeout: 12_000 })
    .then(() => page)
    .catch(() => null);
  await button.click();
  const providerPage = (await Promise.race([popupPromise, redirectPromise])) ?? page;
  await providerPage.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  return providerPage;
}

async function expectLoggedOutState(page: Page) {
  await expect(page.getByRole("button", { name: /sign out|log out|logout/i })).toHaveCount(0);
  const publicSignal = page
    .getByRole("link", { name: /sign in/i })
    .or(page.getByText("Skip", { exact: true }))
    .or(page.getByRole("button", { name: "Next", exact: true }));
  await expect(
    publicSignal.first(),
    "Expected logout to return to a public INSSA sign-in or onboarding surface."
  ).toBeVisible({ timeout: 15_000 });
}

async function completeGoogleSignIn(page: Page, email: string, password: string) {
  if (isInssaPage(page)) return;
  const emailInput = page
    .getByRole("textbox", { name: /email or phone|email address/i })
    .or(page.locator("input[name='identifier']:visible, input[type='email']:visible"))
    .first();
  await expectProviderControl(emailInput, page, "Google email or phone input");
  await emailInput.fill(email);
  await clickEnabledProviderButton(page, /^next$/i, "Google email step");

  const passwordInput = page
    .locator(
      [
        "input[name='Passwd']:visible",
        "input[type='password']:visible:not([aria-hidden='true'])",
        "input[autocomplete='current-password']:visible"
      ].join(", ")
    )
    .first();
  const passwordRequired = await waitForProviderControlOrReturn(page, passwordInput, "Google password input");
  if (!passwordRequired) return;
  await passwordInput.fill(password);
  await clickEnabledProviderButton(page, /^next$/i, "Google password step");
  await rejectUnsupportedChallenge(page, "Google");
}

async function completeAppleSignIn(page: Page, email: string, password: string) {
  if (isInssaPage(page)) return;
  const emailInput = page.locator("#account_name_text_field:visible, input[type='email']:visible").first();
  await expectProviderControl(emailInput, page, "Apple Account email input");
  await emailInput.fill(email);
  await clickVisibleAppleSubmit(page, "Apple email step");
  const passwordInput = page.locator("#password_text_field:visible, input[type='password']:visible").first();
  const passwordRequired = await waitForProviderControlOrReturn(page, passwordInput, "Apple password input");
  if (!passwordRequired) return;
  await passwordInput.fill(password);
  const completionResponse = page
    .waitForResponse((response) => /appleauth\/auth\/signin\/complete/i.test(response.url()), { timeout: 20_000 })
    .catch(() => null);
  await clickVisibleAppleSubmit(page, "Apple password step");
  const response = await completionResponse;
  if (response && response.status() >= 400) {
    throw new ProviderBlockedError(
      `Apple authentication was rejected by the provider (HTTP ${response.status()}): ${await readAppleServiceError(response)}`
    );
  }
  await rejectUnsupportedChallenge(page, "Apple");
}

async function settleProviderFlow(applicationPage: Page, providerPage: Page) {
  try {
    await applicationPage.waitForURL(
      (url) => isInssaUrl(url) && !/^\/signin\/?$/.test(url.pathname),
      { timeout: 25_000 }
    );
  } catch {
    const providerState = await providerStateSummary(providerPage);
    const message =
      `Authentication provider did not return to an authenticated INSSA route. ` +
        `Application=${safeUrl(applicationPage.url())}; provider=${safeUrl(providerPage.url())}; ` +
        `providerState=${providerState}`;
    if (!providerPage.isClosed() && !isInssaPage(providerPage)) throw new ProviderBlockedError(message);
    throw new Error(message);
  }
  await applicationPage.bringToFront();
}

async function rejectUnsupportedChallenge(page: Page, provider: string) {
  await page.waitForTimeout(1_000);
  if (page.isClosed() || isInssaPage(page)) return;
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (/captcha|verify it'?s you|2-step|two-factor|verification code|security key/.test(text)) {
    throw new ProviderBlockedError(`${provider} authentication requires an interactive challenge that monitoring must not bypass.`);
  }
}

async function expectProviderControl(control: Locator, page: Page, label: string) {
  try {
    await expect(control, `Expected a visible ${label}.`).toBeVisible({ timeout: 20_000 });
    await expect(control, `Expected an enabled ${label}.`).toBeEnabled({ timeout: 20_000 });
  } catch {
    const message = `Expected a visible and enabled ${label}. Provider state: ${await providerStateSummary(page)}`;
    if (/Google|Apple/.test(label)) throw new ProviderBlockedError(message);
    throw new Error(message);
  }
}

async function waitForProviderControlOrReturn(page: Page, control: Locator, label: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (isInssaPage(page)) return false;
    if (
      (await control.isVisible().catch(() => false)) &&
      (await control.isEnabled().catch(() => false))
    ) {
      return true;
    }
    const providerError = await visibleProviderError(page);
    if (providerError) throw new ProviderBlockedError(`${label} was not reached: ${providerError}`);
    await page.waitForTimeout(250);
  }
  throw new ProviderBlockedError(`Expected a visible and enabled ${label}. Provider state: ${await providerStateSummary(page)}`);
}

async function clickEnabledProviderButton(page: Page, name: RegExp, step: string) {
  const button = page.getByRole("button", { name }).first();
  await expect(button, `Expected a visible action for ${step}.`).toBeVisible({ timeout: 15_000 });
  await expect(button, `Expected an enabled action for ${step}.`).toBeEnabled({ timeout: 15_000 });
  await button.click();
}

async function clickVisibleAppleSubmit(page: Page, step: string) {
  const button = page.locator("#sign-in:visible, button[type='submit']:visible").first();
  await expect(button, `Expected a visible submit action for ${step}.`).toBeVisible({ timeout: 15_000 });
  await expect(button, `Expected an enabled submit action for ${step}.`).toBeEnabled({ timeout: 15_000 });
  await button.click();
}

async function readAppleServiceError(response: Response) {
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "serviceErrors" in payload && Array.isArray(payload.serviceErrors)) {
    const message = payload.serviceErrors
      .map((entry: unknown) => (entry && typeof entry === "object" && "message" in entry ? String(entry.message) : ""))
      .find(Boolean);
    if (message) return sanitize(message);
  }
  return "Apple returned an unspecified authentication error.";
}

async function visibleProviderError(page: Page) {
  if (page.isClosed()) return "provider page closed before returning to INSSA";
  const candidates = page
    .locator("[role='alert']:visible, [aria-live='assertive']:visible, [aria-live='polite']:visible")
    .filter({ hasText: /error|incorrect|invalid|couldn'?t|unable|not active|try again|problem/i });
  const count = await candidates.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const text = sanitize((await candidates.nth(index).innerText().catch(() => "")).trim());
    if (text) return text.slice(0, 500);
  }
  const bodyText = sanitize((await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim());
  const knownFailure = bodyText.match(
    /couldn['’]?t sign you in.{0,350}|browser or app may not be secure.{0,350}|apple account is not active.{0,350}/i
  );
  if (knownFailure) return knownFailure[0].slice(0, 500);
  return null;
}

async function providerStateSummary(page: Page) {
  if (page.isClosed()) return "provider page closed";
  const error = await visibleProviderError(page);
  const bodyText = sanitize((await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim());
  return JSON.stringify({
    error,
    text: bodyText.slice(0, 500),
    url: safeUrl(page.url())
  });
}

function credentialsFor(environment: string, provider: "apple" | "google" | "password") {
  const credentials = resolveAuthenticationMonitorCredentials(process.env, environment, provider);
  if (!credentials) {
    throw new MissingConfigurationError(`Missing required ${environment} ${provider} authentication monitor credentials.`);
  }
  return credentials;
}

function authenticationMonitorConfig(): AuthenticationMonitorConfig {
  const environment = required("AUTH_MONITOR_ENVIRONMENT");
  const outputRoot = required("AUTH_MONITOR_OUTPUT_DIR");
  const targetUrl = required("INSSA_URL");
  const parsedTarget = new URL(targetUrl);
  const targetHost = parsedTarget.hostname;
  const expectedHost = environment === "production" ? "inssa.us" : environment === "staging" ? "staging.inssa.us" : "";
  if (!expectedHost || targetHost !== expectedHost || parsedTarget.protocol !== "https:") {
    throw new Error(`Authentication monitoring target is not allowlisted for ${environment}: ${targetHost}`);
  }
  if (environment === "production" && (
    process.env.AUTH_MONITOR_ALLOW_PRODUCTION !== "1" ||
    process.env.AUTH_MONITOR_PRODUCTION_CONFIRMATION?.trim().toLowerCase() !== "inssa.us"
  )) {
    throw new Error("Production authentication monitoring confirmation is missing.");
  }
  return { environment, enabledMethods: authenticationMethodsFor(environment), outputRoot, targetHost, targetUrl };
}

function authenticationMethodsFor(environment: string) {
  const variableName = environment === "production" ? "AUTH_MONITOR_PRODUCTION_METHODS" : "AUTH_MONITOR_STAGING_METHODS";
  const configured = process.env[variableName]?.trim();
  if (!configured) return new Set<AuthenticationMethod>(["username-password", "google-oauth", "apple-sign-in"]);
  const methods = configured.split(",").map((value) => value.trim()).filter(Boolean);
  const supported = new Set<AuthenticationMethod>(["username-password", "google-oauth", "apple-sign-in"]);
  const unknown = methods.filter((method) => !supported.has(method as AuthenticationMethod));
  if (unknown.length > 0) throw new Error(`${variableName} contains unsupported authentication methods: ${unknown.join(", ")}`);
  if (methods.length === 0) throw new Error(`${variableName} must enable at least one authentication method.`);
  return new Set(methods as AuthenticationMethod[]);
}

function classifyAuthenticationFailure(error: Error): AuthenticationCheckStatus {
  if (error instanceof MissingConfigurationError) return "missing_configuration";
  if (error instanceof ProviderBlockedError) return "blocked_external";
  if (error.name === "TimeoutError" || /timed?\s*out|timeout/i.test(error.message)) return "timed_out";
  return "failed";
}

class MissingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigurationError";
  }
}

class ProviderBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderBlockedError";
  }
}

function isInssaPage(page: Page) {
  if (page.isClosed()) return false;
  try {
    return isInssaUrl(new URL(page.url()));
  } catch {
    return false;
  }
}

function isInssaUrl(url: URL) {
  return url.hostname === "inssa.us" || url.hostname === "www.inssa.us" || url.hostname === "staging.inssa.us";
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

function sanitize(value: string) {
  const secrets = [
    process.env.INSSA_TEST_EMAIL,
    process.env.INSSA_TEST_PASSWORD,
    process.env.AUTH_MONITOR_STAGING_EMAIL,
    process.env.AUTH_MONITOR_STAGING_PASSWORD,
    process.env.AUTH_MONITOR_STAGING_GOOGLE_EMAIL,
    process.env.AUTH_MONITOR_STAGING_GOOGLE_PASSWORD,
    process.env.AUTH_MONITOR_STAGING_APPLE_EMAIL,
    process.env.AUTH_MONITOR_STAGING_APPLE_PASSWORD,
    process.env.AUTH_MONITOR_PRODUCTION_EMAIL,
    process.env.AUTH_MONITOR_PRODUCTION_PASSWORD,
    process.env.AUTH_MONITOR_PRODUCTION_GOOGLE_EMAIL,
    process.env.AUTH_MONITOR_PRODUCTION_GOOGLE_PASSWORD,
    process.env.AUTH_MONITOR_PRODUCTION_APPLE_EMAIL,
    process.env.AUTH_MONITOR_PRODUCTION_APPLE_PASSWORD
  ].filter((secret): secret is string => Boolean(secret));
  return secrets.reduce((message, secret) => message.replaceAll(secret, "[redacted]"), value)
    .replace(/(?:eyJ|ya29\.)[A-Za-z0-9._-]+/g, "[redacted-token]");
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
