// Exercise the real cache lifecycle against intercepted documents only.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { ensureInssaAuthStorageState, getInssaAuthStorageStatePath, hasCompleteInssaSession } from "../../utils/auth";

async function main() {
  Object.assign(process.env, { INSSA_URL: "https://session-fixture.invalid", INSSA_TEST_EMAIL: `${randomUUID()}@example.test`, INSSA_TEST_PASSWORD: "fixture-only" });
  const statePath = getInssaAuthStorageStatePath();
  const key = "firebase:authUser:fixture:[DEFAULT]";
  const auth = { name: key, value: JSON.stringify({ uid: "fixture-user", email: process.env.INSSA_TEST_EMAIL }) };
  const profile = { name: "userProfile", value: JSON.stringify({ state: { userProfile: { uid: "fixture-user" } } }) };
  const state = (entries: typeof auth[]) => ({ cookies: [], origins: [{ origin: process.env.INSSA_URL, localStorage: entries }] });
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state([auth])));
  const browser = await chromium.launch();
  let logins = 0;
  const guardedBrowser = new Proxy(browser, {
    get(target, property) {
      if (property !== "newContext") return Reflect.get(target, property);
      return async (options: Parameters<Browser["newContext"]>[0]) => {
        const context = await target.newContext({ ...options, serviceWorkers: "block" });
        await context.route("**/*", async route => {
          assert.equal(new URL(route.request().url()).origin, process.env.INSSA_URL);
          if (new URL(route.request().url()).pathname === "/me") {
            await route.fulfill({ status: 503, body: "Profile unavailable" });
            return;
          }
          logins++;
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><input type="email"><input type="password"><button>Sign In</button><script>
            document.querySelector('button').onclick = () => {
              localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(auth.value)});
              history.replaceState(null, '', '/');
              document.body.innerHTML = '<a href="/me">Profile</a>';
              setTimeout(() => localStorage.setItem('userProfile', ${JSON.stringify(profile.value)}), 700);
            };
          </script>` });
        });
        return context;
      };
    }
  });
  try {
    await ensureInssaAuthStorageState(guardedBrowser);
    const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
    assert.equal(hasCompleteInssaSession(saved.origins[0].localStorage), true);
    assert.equal(logins, 1, "incomplete fresh cache is rejected and delayed profile is captured");
    await ensureInssaAuthStorageState(guardedBrowser);
    assert.equal(logins, 1, "complete recent snapshot is reused");
    assert.equal(hasCompleteInssaSession([auth, profile], "wrong@example.test"), false, "matching UIDs do not authorize reuse for another email");
    const old = new Date(Date.now() - 20 * 60_000);
    await fs.utimes(statePath, old, old);
    await ensureInssaAuthStorageState(guardedBrowser);
    assert.equal(logins, 2, "indeterminate profile validation cannot accept the stale session");
    assert.equal(hasCompleteInssaSession([auth, { ...profile, value: JSON.stringify({ state: { userProfile: { uid: "other-user" } } }) }]), false);
    assert.equal(hasCompleteInssaSession([auth, { ...profile, value: "malformed" }]), false);
    console.log("PASS: incomplete cache rejected; delayed matching profile captured; complete cache reused; failed validation, wrong account and malformed state fail closed");
  } finally {
    await browser.close();
    await fs.rm(path.dirname(statePath), { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
