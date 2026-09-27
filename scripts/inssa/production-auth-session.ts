import { expect, type Page } from "@playwright/test";
import { AuthPage } from "../../pages/inssa/auth-page";

// Return only state, never Firebase tokens or user records, to the runner/reporters.
export async function productionSessionState(page: Page, expectedEmail?: string) {
  return page.evaluate((email) => {
    let authenticated = false;
    let expectedAccount = false;
    let malformed = false;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("firebase:authUser:")) continue;
      try {
        const user = JSON.parse(localStorage.getItem(key) ?? "null");
        if (user === null) continue;
        if (typeof user?.uid !== "string" || !user.uid) { malformed = true; continue; }
        authenticated = true;
        expectedAccount ||= user.email === email;
      } catch { malformed = true; }
    }
    return { authenticated, expectedAccount, malformed };
  }, expectedEmail);
}

export async function expectProductionSession(page: Page, email: string, timeout = 15_000) {
  await expect.poll(() => productionSessionState(page, email), {
    message: "Expected a persisted production session for the approved account.", timeout
  }).toEqual({ authenticated: true, expectedAccount: true, malformed: false });
}

export async function signOutReadOnlyProduction(page: Page, timeout = 15_000) {
  const authPage = new AuthPage(page);
  // Load the actual profile while online. INSSA's online logout first awaits a
  // Firestore FCM-token update, which the production no-mutation guard must deny.
  await authPage.goToProfile();
  await expect(authPage.signOutButton()).toBeVisible({ timeout });
  await expect(authPage.signOutButton()).toBeEnabled({ timeout });
  const context = page.context();
  await context.setOffline(true);
  try {
    // Exercise INSSA's existing offline UI logout path. Do not clear storage or
    // invoke Firebase directly: a broken application logout must still fail.
    await authPage.signOutButton().click();
    await expect.poll(() => productionSessionState(page), {
      message: "Expected production UI logout to clear the persisted authenticated session.", timeout
    }).toEqual({ authenticated: false, expectedAccount: false, malformed: false });
  } finally {
    await context.setOffline(false);
  }
  // Reconnect and load a fresh document: the public map alone is not proof of logout.
  await authPage.goToSignIn();
  await expect.poll(() => productionSessionState(page), { timeout }).toEqual({
    authenticated: false, expectedAccount: false, malformed: false
  });
}
