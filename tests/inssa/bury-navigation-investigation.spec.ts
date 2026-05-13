import { expect, type Page } from "@playwright/test";
import { LandingPage } from "../../pages/inssa/landing.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import { assertValidInssaUrl } from "../../utils/env";
import { INSSA_TIME_CAPSULE_ROUTE_PATTERN } from "../../utils/inssa-test-data";
import { test } from "./fixtures";

const ATTEMPT_COUNT = 6;
const TRANSITION_TIMEOUT_MS = 15_000;
const BURY_NAV_AUDIT_ENABLED = process.env.INSSA_ENABLE_BURY_NAV_AUDIT === "1";
const RELEVANT_NETWORK_PATTERN =
  /\/timecapsule(?:\?|$)|\/signin(?:\?|$)|securetoken\.googleapis\.com\/v1\/token|identitytoolkit\.googleapis\.com\/v1\/accounts:lookup|GetUserProfileByEmail|SocialLoginJWT|google\.firestore\.v1\.Firestore\/(?:Listen|Write)\/channel/i;

type AuthSnapshot = {
  cookieNames: string[];
  firebaseAuthKeyCount: number;
  hasFirebaseAuthUserKey: boolean;
  localStorageKeys: string[];
  pageUrl: string;
  pointsLedgerLinkVisible: boolean;
  profileLinkVisible: boolean;
  progressIndicatorsVisible: number;
  sessionStorageKeys: string[];
  timecapsuleStorageKeys: string[];
  visibilityState: string;
};

type BuryHitTarget = {
  buttonEnabled: boolean;
  buttonVisibleText: string;
  centerX: number;
  centerY: number;
  topElementMatchesButton: boolean;
  topElementPointerEvents: string;
  topElementSummary: string;
  trialClickReady: boolean;
};

type ProbeEvent = {
  action: string;
  hasCapsuleState?: boolean;
  key?: string;
  nextValuePresent?: boolean;
  text?: string;
  timestampMs: number;
  to?: string;
  url: string;
  visibility?: string;
};

type NetworkEvent = {
  kind: "console" | "framenavigated" | "pageerror" | "request" | "requestfailed" | "response";
  message?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  timestampMs: number;
  url: string;
};

type AttemptReport = {
  afterClickAuth: AuthSnapshot;
  beforeClickAuth: AuthSnapshot;
  buryHitTarget: BuryHitTarget;
  composeBootstrapReached: boolean;
  composeRouteReached: boolean;
  finalUrl: string;
  intermediateUrls: string[];
  networkEvents: NetworkEvent[];
  outcome: "compose" | "home-timeout" | "other-route" | "signin" | "timecapsule-no-bootstrap";
  pageIssues: string[];
  probeEvents: ProbeEvent[];
};

test.describe("INSSA bury navigation investigation", () => {
  test.skip(
    !BURY_NAV_AUDIT_ENABLED,
    "Investigation-only spec. Set INSSA_ENABLE_BURY_NAV_AUDIT=1 to run the authenticated Bury transition audit."
  );

  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  test("authenticated Bury must transition to compose and exposes the exact failure mode when it does not", async (
    { page },
    testInfo
  ) => {
    test.setTimeout(240_000);
    test.slow();

    const landing = new LandingPage(page);
    const errorMonitor = createInssaErrorMonitor(page);
    const reports: AttemptReport[] = [];

    await installBuryNavigationProbe(page);

    for (let attempt = 1; attempt <= ATTEMPT_COUNT; attempt += 1) {
      await resetBuryNavigationProbe(page);
      errorMonitor.issues.length = 0;

      await landing.goToHome();
      await landing.expectAuthenticatedLandingSurface();

      const beforeClickAuth = await readAuthSnapshot(page);
      const buryHitTarget = await inspectBuryHitTarget(page, landing);
      const capture = beginTransitionCapture(page);

      await landing.buryButton().click();

      const outcome = await waitForBuryOutcome(page);
      const composeRouteReached = INSSA_TIME_CAPSULE_ROUTE_PATTERN.test(new URL(page.url()).pathname + new URL(page.url()).search);
      const composeBootstrapReached = composeRouteReached && (await isComposeSurfaceVisible(page));
      const afterClickAuth = await readAuthSnapshot(page);
      const probeEvents = await readBuryNavigationProbe(page);
      const networkEvents = capture.stop();
      const pageIssues = errorMonitor
        .classifyIssues()
        .filter((issue) => issue.severity === "critical")
        .map((issue) => `${issue.category}: ${issue.issue.message}`);

      reports.push({
        afterClickAuth,
        beforeClickAuth,
        buryHitTarget,
        composeBootstrapReached,
        composeRouteReached,
        finalUrl: page.url(),
        intermediateUrls: Array.from(new Set(networkEvents.filter((event) => event.kind === "framenavigated").map((event) => event.url))),
        networkEvents,
        outcome,
        pageIssues,
        probeEvents
      });

      if (composeRouteReached) {
        await landing.goToHome();
      }
    }

    const summary = summarizeReports(reports);
    console.log(`INSSA_BURY_NAVIGATION_AUDIT ${JSON.stringify(summary)}`);
    await testInfo.attach("inssa-bury-navigation-audit.json", {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json"
    });

    expect(
      reports.every((report) => report.outcome === "compose"),
      `Authenticated Bury must eventually land on /timecapsule. Investigation summary:\n${JSON.stringify(summary, null, 2)}`
    ).toBe(true);
  });
});

function beginTransitionCapture(page: Page) {
  const startedAt = Date.now();
  const events: NetworkEvent[] = [];

  const push = (event: Omit<NetworkEvent, "timestampMs">) => {
    events.push({
      ...event,
      timestampMs: Date.now() - startedAt
    });
  };

  const onConsole = (message: any) => {
    if (message.type() === "error") {
      push({
        kind: "console",
        message: message.text(),
        url: page.url() || "about:blank"
      });
    }
  };

  const onPageError = (error: Error) => {
    push({
      kind: "pageerror",
      message: error.message,
      url: page.url() || "about:blank"
    });
  };

  const onFrameNavigated = (frame: any) => {
    if (frame === page.mainFrame()) {
      push({
        kind: "framenavigated",
        url: frame.url()
      });
    }
  };

  const onRequest = (request: any) => {
    if (!RELEVANT_NETWORK_PATTERN.test(request.url())) {
      return;
    }

    push({
      kind: "request",
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url()
    });
  };

  const onResponse = (response: any) => {
    if (!RELEVANT_NETWORK_PATTERN.test(response.url())) {
      return;
    }

    push({
      kind: "response",
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      status: response.status(),
      url: response.url()
    });
  };

  const onRequestFailed = (request: any) => {
    if (!RELEVANT_NETWORK_PATTERN.test(request.url())) {
      return;
    }

    push({
      kind: "requestfailed",
      message: request.failure()?.errorText ?? "request failed",
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url()
    });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("framenavigated", onFrameNavigated);
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  return {
    stop() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("framenavigated", onFrameNavigated);
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      return events;
    }
  };
}

async function installBuryNavigationProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const globalKey = "__INSSA_BURY_NAV_AUDIT__";
    const root = ((window as any)[globalKey] ??= { events: [] as any[] });
    const push = (action: string, extra: Record<string, unknown> = {}) => {
      root.events.push({
        action,
        timestampMs: Math.round(performance.now() * 100) / 100,
        url: window.location.href,
        ...extra
      });
    };

    const wrapHistory = (name: "pushState" | "replaceState") => {
      const original = window.history[name].bind(window.history);
      window.history[name] = (state: any, unused: string, url?: string | URL | null) => {
        push(name, {
          hasCapsuleState: Boolean(state?.capsule),
          nextValuePresent: Boolean(state?.next),
          to: typeof url === "string" ? url : url?.toString?.() ?? window.location.href
        });
        return original(state, unused, url as any);
      };
    };

    wrapHistory("pushState");
    wrapHistory("replaceState");

    window.addEventListener("popstate", () => push("popstate"));
    document.addEventListener("visibilitychange", () => push("visibilitychange", { visibility: document.visibilityState }));
    document.addEventListener(
      "click",
      (event) => {
        const target = (event.target as HTMLElement | null)?.closest?.("button,a");
        if (!target) {
          return;
        }

        const text = (target.textContent || "").trim();
        if (/bury/i.test(text)) {
          push("bury-click", { text });
        }
      },
      true
    );

    const originalSessionSet = window.sessionStorage.setItem.bind(window.sessionStorage);
    window.sessionStorage.setItem = (key: string, value: string) => {
      if (/timecapsule|firebase:authUser|auth/i.test(key)) {
        push("session-storage-set", { key });
      }
      return originalSessionSet(key, value);
    };

    const originalLocalSet = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      if (/timecapsule|firebase:authUser|auth/i.test(key)) {
        push("local-storage-set", { key });
      }
      return originalLocalSet(key, value);
    };

    window.addEventListener("error", (event) => {
      push("window-error", { text: String(event.message || "") });
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      push("unhandledrejection", {
        text: typeof reason === "string" ? reason : String(reason?.message ?? reason ?? "")
      });
    });
  });
}

async function resetBuryNavigationProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = (window as any).__INSSA_BURY_NAV_AUDIT__;
    if (root) {
      root.events = [];
    }
  });
}

async function readBuryNavigationProbe(page: Page): Promise<ProbeEvent[]> {
  return page.evaluate(() => {
    const entries = (window as any).__INSSA_BURY_NAV_AUDIT__?.events;
    return Array.isArray(entries) ? entries.slice() : [];
  });
}

async function readAuthSnapshot(page: Page): Promise<AuthSnapshot> {
  const storageSnapshot = await page.evaluate(() => {
    const localStorageKeys = Object.keys(window.localStorage);
    const sessionStorageKeys = Object.keys(window.sessionStorage);
    const countVisible = (selector: string) =>
      Array.from(document.querySelectorAll(selector)).filter((element) => {
        const style = window.getComputedStyle(element as HTMLElement);
        const rect = (element as HTMLElement).getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      }).length;

    return {
      firebaseAuthKeyCount: localStorageKeys.filter((key) => key.startsWith("firebase:authUser:")).length,
      hasFirebaseAuthUserKey: localStorageKeys.some((key) => key.startsWith("firebase:authUser:")),
      localStorageKeys: localStorageKeys.filter((key) => /firebase:authUser|auth/i.test(key)),
      pageUrl: window.location.href,
      pointsLedgerLinkVisible: Boolean(document.querySelector("a[href='/points-ledger']")),
      profileLinkVisible: Boolean(document.querySelector("a[href='/me'], a[href^='/u/']")),
      progressIndicatorsVisible: countVisible("[role='progressbar'], [aria-busy='true'], .MuiBackdrop-root, .MuiCircularProgress-root"),
      sessionStorageKeys: sessionStorageKeys.filter((key) => /firebase:authUser|auth/i.test(key)),
      timecapsuleStorageKeys: sessionStorageKeys.filter((key) => /timecapsule/i.test(key)),
      visibilityState: document.visibilityState
    };
  });
  const cookieNames = (await page.context().cookies("https://staging.inssa.us")).map((cookie) => cookie.name).sort();

  return {
    ...storageSnapshot,
    cookieNames
  };
}

async function inspectBuryHitTarget(page: Page, landing: LandingPage): Promise<BuryHitTarget> {
  const buryButton = landing.buryButton();
  const trialClickReady = await buryButton
    .click({ trial: true })
    .then(() => true)
    .catch(() => false);

  return buryButton.evaluate((element, ready) => {
    const rect = (element as HTMLElement).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY) as HTMLElement | null;
    const summarize = (node: HTMLElement | null) => {
      if (!node) {
        return "none";
      }

      const text = (node.innerText || node.textContent || "").trim().slice(0, 80);
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${node.className ? `.${String(node.className).split(/\s+/).slice(0, 3).join(".")}` : ""}${text ? `:${text}` : ""}`;
    };

    return {
      buttonEnabled: !(element as HTMLButtonElement).disabled,
      buttonVisibleText: ((element as HTMLElement).innerText || (element as HTMLElement).textContent || "").trim(),
      centerX,
      centerY,
      topElementMatchesButton: Boolean(topElement && (topElement === element || (element as HTMLElement).contains(topElement))),
      topElementPointerEvents: topElement ? window.getComputedStyle(topElement).pointerEvents : "none",
      topElementSummary: summarize(topElement),
      trialClickReady: ready
    };
  }, trialClickReady);
}

async function isComposeSurfaceVisible(page: Page): Promise<boolean> {
  const subject = page.locator("input[type='text']").first();
  const message = page.locator("textarea:not([name='g-recaptcha-response'])").first();
  return (await subject.isVisible().catch(() => false)) && (await message.isVisible().catch(() => false));
}

async function waitForBuryOutcome(
  page: Page
): Promise<AttemptReport["outcome"]> {
  const startedUrl = page.url();

  const composePromise = page
    .waitForURL(INSSA_TIME_CAPSULE_ROUTE_PATTERN, { timeout: TRANSITION_TIMEOUT_MS })
    .then(async (): Promise<AttemptReport["outcome"]> =>
      (await isComposeSurfaceVisible(page)) ? "compose" : "timecapsule-no-bootstrap"
    )
    .catch(() => null);

  const signInPromise = page
    .waitForURL(/\/signin(?:\?|$)|\/sign-in(?:\?|$)|\/login(?:\?|$)|\/auth/i, { timeout: TRANSITION_TIMEOUT_MS })
    .then(() => "signin" as const)
    .catch(() => null);

  const timeoutPromise = new Promise<AttemptReport["outcome"]>((resolve) => {
    setTimeout(() => {
      const currentUrl = page.url();
      if (currentUrl === startedUrl || new URL(currentUrl).pathname === "/") {
        resolve("home-timeout");
        return;
      }
      resolve("other-route");
    }, TRANSITION_TIMEOUT_MS);
  });

  return (await Promise.race([composePromise, signInPromise, timeoutPromise].map((candidate) => Promise.resolve(candidate)))) ?? "other-route";
}

function summarizeReports(reports: AttemptReport[]) {
  const outcomes = reports.reduce<Record<AttemptReport["outcome"], number>>(
    (counts, report) => {
      counts[report.outcome] += 1;
      return counts;
    },
    {
      compose: 0,
      "home-timeout": 0,
      "other-route": 0,
      signin: 0,
      "timecapsule-no-bootstrap": 0
    }
  );

  const exactFailureMode =
    reports.find((report) => report.outcome !== "compose") ??
    null;

  return {
    attempts: reports,
    exactFailureMode,
    outcomeCounts: outcomes
  };
}
