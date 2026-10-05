import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, type Browser } from "@playwright/test";
import { AuthPage } from "../pages/inssa/auth-page";
import { getInssaTestCredentials, hasCompleteInssaSession } from "./auth";
import { assertValidInssaUrl } from "./env";

export type SafeAuthPreflight = {
  status: "PASS" | "FAILED";
  freshSession: true;
  targetHost: string;
  redirectPath: "/timecapsule";
  firebaseIdentityMatched: boolean;
  profileIdentityMatched: boolean;
  homeVisited: boolean;
  seedFunctionObserved: boolean;
  completedAt: string;
};

// This prerequisite deliberately permits ordinary authentication/bootstrap
// traffic. The strict product-write audit belongs to each Safe test context.
export async function prepareInssaSafeSession(browser: Browser, statePath: string, preflightPath: string) {
  const result: SafeAuthPreflight = {
    status: "FAILED", freshSession: true, targetHost: "staging.inssa.us", redirectPath: "/timecapsule",
    firebaseIdentityMatched: false, profileIdentityMatched: false,
    homeVisited: false, seedFunctionObserved: false, completedAt: ""
  };
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  let stage = "CONFIGURATION";
  try {
    const origin = new URL(assertValidInssaUrl()).origin;
    if (origin !== "https://staging.inssa.us") throw new Error("Staging required");
    const { email, password } = getInssaTestCredentials();
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    await fs.rm(statePath, { force: true });
    context = await browser.newContext({ baseURL: origin, storageState: { cookies: [], origins: [] }, serviceWorkers: "allow" });
    context.setDefaultNavigationTimeout(20_000);
    context.setDefaultTimeout(10_000);
    await context.route("**/*", async (route, request) => {
      const url = new URL(request.url());
      if (url.hostname === "us-central1-kbean-stg-fcm.cloudfunctions.net" && /^\/discover_seedQuickFindCategories\/?$/.test(url.pathname)) {
        result.seedFunctionObserved = true;
        await route.abort("blockedbyclient");
      } else if (request.isNavigationRequest() && url.origin === origin && url.pathname === "/") {
        result.homeVisited = true;
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on("framenavigated", frame => {
      if (frame !== page.mainFrame() || !frame.url().startsWith(origin + "/")) return;
      if (new URL(frame.url()).pathname === "/") result.homeVisited = true;
    });
    const auth = new AuthPage(page);
    stage = "SIGN_IN";
    await auth.goToSignIn("/timecapsule");
    await auth.submitEmailPassword(email, password);
    stage = "IDENTITY";
    await expect.poll(async () => {
      const identity = await page.evaluate(expectedEmail => {
        let firebaseIdentityMatched = false, profileIdentityMatched = false;
        try {
          const profile = JSON.parse(localStorage.getItem("userProfile") ?? "null")?.state?.userProfile;
          for (const [key, value] of Object.entries(localStorage)) {
            if (!key.startsWith("firebase:authUser:")) continue;
            const user = JSON.parse(value);
            if (typeof user?.uid === "string" && user.uid && user.email?.toLowerCase() === expectedEmail.toLowerCase()) {
              firebaseIdentityMatched = true;
              profileIdentityMatched = profile?.uid === user.uid;
            }
          }
        } catch { /* Only sanitized booleans leave the browser. */ }
        return { firebaseIdentityMatched, profileIdentityMatched };
      }, email);
      Object.assign(result, identity);
      return identity.firebaseIdentityMatched && identity.profileIdentityMatched;
    }, { timeout: 15_000, message: "Expected the requested Firebase account and matching profile." }).toBe(true);
    stage = "DIRECT_COMPOSE_REDIRECT";
    await expect.poll(() => new URL(page.url()).origin + new URL(page.url()).pathname, { timeout: 15_000 }).toBe(origin + "/timecapsule");
    await expect(page.getByRole("heading", { name: "Signing in...", exact: true, includeHidden: true })).not.toBeVisible({ timeout: 15_000 });
    const state = await context.storageState();
    // Close while the seed guard is still active, then certify the final flags.
    await context.close();
    context = undefined;
    if (result.homeVisited || result.seedFunctionObserved) throw new Error("Forbidden bootstrap navigation");
    stage = "SAVE_STATE";
    await fs.writeFile(statePath + ".tmp", JSON.stringify(state), { mode: 0o600 });
    await fs.rename(statePath + ".tmp", statePath);
    result.status = "PASS";
  } catch {
    // Never include browser exceptions, form contents or session values in logs.
    throw new Error(`SAFE_AUTH_SETUP_FAILED: ${result.seedFunctionObserved ? "SEED_FUNCTION_OBSERVED" : result.homeVisited ? "HOME_NAVIGATION_OBSERVED" : stage}. Safe tests NOT STARTED.`);
  } finally {
    await context?.close().catch(() => {});
    if (result.status !== "PASS") await fs.rm(statePath, { force: true });
    await fs.rm(statePath + ".tmp", { force: true });
    result.completedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(preflightPath), { recursive: true });
    await fs.writeFile(preflightPath, JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}

export async function readPreparedInssaSafeState(): Promise<string> {
  const statePath = process.env.INSSA_SAFE_AUTH_STATE_PATH;
  const preflightPath = process.env.INSSA_SAFE_AUTH_PREFLIGHT_PATH;
  if (!statePath || !preflightPath) throw new Error("SAFE_AUTH_SETUP_FAILED: Run npm run test:inssa:safe to prepare a fresh session.");
  const preflight = JSON.parse(await fs.readFile(preflightPath, "utf8")) as SafeAuthPreflight;
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const origin = state.origins?.find((entry: { origin: string }) => entry.origin === new URL(assertValidInssaUrl()).origin);
  if (preflight.status !== "PASS" || !preflight.freshSession || !preflight.firebaseIdentityMatched || !preflight.profileIdentityMatched || preflight.homeVisited || preflight.seedFunctionObserved ||
      !hasCompleteInssaSession(origin?.localStorage ?? [], getInssaTestCredentials().email)) {
    throw new Error("SAFE_AUTH_SETUP_FAILED: Prepared session certification is invalid.");
  }
  return statePath;
}
