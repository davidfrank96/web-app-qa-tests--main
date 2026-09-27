// Real Chromium with intercepted fixture documents only. No product requests or credentials.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { productionAuthRequestAllowed } from "../../scripts/inssa/production-auth-safety";
import { expectProductionSession, productionSessionState, signOutReadOnlyProduction } from "../../scripts/inssa/production-auth-session";

async function main() {
  process.env.INSSA_URL = "https://inssa.us";
  const browser = await chromium.launch();
  const key = "firebase:authUser:fixture:[DEFAULT]";
  try {
    for (const broken of [false, true]) {
      const context = await browser.newContext({ baseURL: "https://inssa.us", serviceWorkers: "block" });
      const page = await context.newPage();
      let blocked = 0;
      await context.route("**/*", async route => {
        const request = route.request();
        if (!productionAuthRequestAllowed(request.url(), request.method())) { blocked++; await route.abort(); return; }
        assert.equal(new URL(request.url()).origin, "https://inssa.us", "fixture must never use a backend");
        const profile = new URL(request.url()).pathname === "/me";
        await route.fulfill({ contentType: "text/html", body: profile ? `<!doctype html><button id="logout">Sign Out</button><script>
          document.getElementById('logout').onclick = async () => {
            history.replaceState(null, '', '/');
            if (navigator.onLine) {
              fetch('https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel', {method:'POST'}).catch(()=>{});
              await new Promise(()=>{}); // Firestore queues/retries the blocked FCM update.
            }
            ${broken ? "" : `localStorage.setItem(${JSON.stringify(key)}, 'null');`}
            document.body.innerHTML='<h1>Public map</h1><p>Location prompt</p>';
          };
          </script>` : '<!doctype html><h1>Sign In</h1><input type="email"><input type="password"><button>Sign In</button>' });
      });
      await page.goto("/signin");
      await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({ uid: "fixture-user", email: "fixture@example.test" })), { key });
      await expectProductionSession(page, "fixture@example.test", 500);
      await assert.rejects(expectProductionSession(page, "different@example.test", 250), /expectedAccount/);
      if (!broken) {
        // Reproduce the old online logout deadlock with no actual remote write.
        await page.goto("/me");
        await page.getByRole("button", { name: "Sign Out" }).click();
        await page.waitForFunction(() => document.location.pathname === "/");
        assert.equal((await productionSessionState(page)).authenticated, true);
        assert.equal(blocked, 1);
        // The production helper drives the same UI offline, reconnects, and verifies a fresh sign-in page.
        await signOutReadOnlyProduction(page, 1000);
        assert.deepEqual(await productionSessionState(page), { authenticated: false, expectedAccount: false, malformed: false });
        assert.equal(await page.evaluate(() => navigator.onLine), true);
        assert.equal(new URL(page.url()).pathname, "/signin");
        assert.equal(blocked, 1, "offline UI logout does not attempt the FCM write");
      } else {
        await assert.rejects(signOutReadOnlyProduction(page, 250), /authenticated/);
        assert.equal(await page.evaluate(() => navigator.onLine), true, "failure restores connectivity");
        assert.equal((await productionSessionState(page)).authenticated, true, "the helper cannot clear storage to fabricate success");
      }
      await page.evaluate(({ key }) => localStorage.setItem(key, "not-json"), { key });
      assert.equal((await productionSessionState(page)).malformed, true);
      await context.close();
    }
    console.log("PASS: reproduced blocked-write logout; offline UI clears session; online sign-in reload; wrong account, malformed state and broken logout fail closed");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
