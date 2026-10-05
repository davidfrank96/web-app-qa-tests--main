// Offline browser regression: all traffic is fulfilled locally, never staging.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { chromium, type Browser, type Route, type Request } from "@playwright/test";
import { prepareInssaSafeSession, readPreparedInssaSafeState } from "../../utils/inssa-safe-session";
import { installSafeWriteAudit } from "../../utils/inssa-safe-write-audit";

async function main() {
  Object.assign(process.env, { INSSA_URL: "https://staging.inssa.us", INSSA_TEST_EMAIL: "fixture@example.test", INSSA_TEST_PASSWORD: "fixture-only" });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "safe-auth-regression-"));
  const statePath = path.join(directory, "private", "storage-state.json"), preflightPath = path.join(directory, "evidence", "safe-auth-preflight.json");
  Object.assign(process.env, { INSSA_SAFE_AUTH_STATE_PATH: statePath, INSSA_SAFE_AUTH_PREFLIGHT_PATH: preflightPath });
  const browser = await chromium.launch();
  let mode: "normal" | "seed" | "home" = "normal", contexts = 0, signIns = 0, forwardedSeed = 0, forwardedWrites = 0, aborted = 0;
  const fixtureBrowser = new Proxy(browser, { get(target, key) {
    if (key !== "newContext") return Reflect.get(target, key);
    return async (options: Parameters<Browser["newContext"]>[0]) => {
      contexts++;
      const context = await target.newContext(options);
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.includes("discover_seedQuickFindCategories")) forwardedSeed++;
        if (route.request().method() === "POST") { forwardedWrites++; await route.fulfill({ body: "{}" }); return; }
        assert.equal(url.origin, process.env.INSSA_URL);
        if (url.pathname === "/signin") {
          signIns++;
          assert.equal(url.searchParams.get("next"), "/timecapsule");
          await route.fulfill({ contentType: "text/html", body: `<input type="email"><input type="password"><button>Sign In</button><script>
          document.querySelector('button').onclick=async()=>{
            await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',{method:'POST',body:'{}'});
            // Bootstrap traffic is deliberately outside the strict test auditor.
            await fetch('https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel',{method:'POST',body:'fixture-bootstrap'});
            ${mode === "seed" ? `await fetch('https://us-central1-kbean-stg-fcm.cloudfunctions.net/discover_seedQuickFindCategories',{method:'POST',body:'{}'}).catch(()=>{});` : ""}
            localStorage.setItem('firebase:authUser:fixture:[DEFAULT]',JSON.stringify({uid:'fixture-user',email:'fixture@example.test'}));
            localStorage.setItem('userProfile',JSON.stringify({state:{userProfile:{uid:'fixture-user'}}}));
            ${mode === "home" ? "history.replaceState(null,'','/');" : ""}
            history.replaceState(null,'','/timecapsule');document.body.innerHTML='<a href="/me">Profile</a>';
          };</script>` });
        } else await route.fulfill({ contentType: "text/html", body: "<p>Offline compose</p>" });
      });
      const realRoute = context.route.bind(context);
      context.route = async (pattern, handler) => realRoute(pattern, async (route, request) => {
        const wrapped = new Proxy(route, { get(target, key) {
          if (key === "continue") return () => target.fallback();
          if (key === "abort") return async () => { aborted++; await target.abort("blockedbyclient"); };
          return Reflect.get(target, key);
        } });
        await (handler as (route: Route, request: Request) => unknown)(wrapped, request);
      });
      return context;
    };
  } });
  try {
    await assert.rejects(fs.access(statePath));
    const result = await prepareInssaSafeSession(fixtureBrowser, statePath, preflightPath);
    assert.deepEqual({ ...result, completedAt: "timestamp" }, {
      status: "PASS", freshSession: true, targetHost: "staging.inssa.us", redirectPath: "/timecapsule",
      firebaseIdentityMatched: true, profileIdentityMatched: true, homeVisited: false, seedFunctionObserved: false, completedAt: "timestamp"
    });
    assert.equal(contexts, 1); assert.equal(signIns, 1); assert.equal(aborted, 0); assert.equal(forwardedWrites, 2);
    assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600);
    // Every authenticated consumer resolves the same state without logging in.
    for (let i = 0; i < 8; i++) assert.equal(await readPreparedInssaSafeState(), statePath);
    assert.equal(contexts, 1); assert.equal(signIns, 1);
    const preflight = await fs.readFile(preflightPath, "utf8");
    for (const secret of ["fixture-user", "fixture@example.test", "fixture-only", "localStorage", "cookies", "token"]) assert.ok(!preflight.includes(secret));
    assert.deepEqual(await fs.readdir(path.dirname(preflightPath)), ["safe-auth-preflight.json"]);

    // Actual Safe contexts share the snapshot but remain isolated, with the
    // unmodified strict audit installed before any navigation or action.
    for (let execution = 0; execution < 2; execution++) {
      const context = await fixtureBrowser.newContext({ baseURL: process.env.INSSA_URL, storageState: await readPreparedInssaSafeState() });
      const audit = await installSafeWriteAudit(context, "fixture-user");
      const page = await context.newPage(); await page.goto("/timecapsule");
      assert.equal(await page.evaluate(() => localStorage.getItem("test-marker")), null);
      await page.evaluate(() => localStorage.setItem("test-marker", "independent-context"));
      const before: number = forwardedWrites;
      for (const target of ["/api/unknown", "/api/capsules", "/api/drafts", "/api/media", "/api/profile", "https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel?database=projects/fixture/databases/(default)", "https://us-central1-kbean-stg-fcm.cloudfunctions.net/discover_seedQuickFindCategories"]) {
        await page.evaluate(url => fetch(url, { method: "POST", body: "{}" }).catch(() => null), target);
      }
      await audit.dispose();
      assert.equal(audit.failures.length, 7); assert.equal(audit.records.filter(r => r.blocked).length, 7);
      assert.equal(forwardedWrites, before); await context.close();
    }
    assert.equal(signIns, 1);
    // A new run must overwrite even a usable prior snapshot with fresh login.
    await prepareInssaSafeSession(fixtureBrowser, statePath, preflightPath);
    assert.equal(signIns, 2);
    for (const scenario of ["seed", "home"] as const) {
      mode = scenario;
      await assert.rejects(prepareInssaSafeSession(fixtureBrowser, statePath, preflightPath), /SAFE_AUTH_SETUP_FAILED: (SEED_FUNCTION_OBSERVED|HOME_NAVIGATION_OBSERVED). Safe tests NOT STARTED/);
      await assert.rejects(fs.access(statePath));
      const failure = JSON.parse(await fs.readFile(preflightPath, "utf8"));
      assert.equal(failure.status, "FAILED"); assert.equal(failure[scenario === "seed" ? "seedFunctionObserved" : "homeVisited"], true);
      await assert.rejects(readPreparedInssaSafeState());
    }
    assert.equal(forwardedSeed, 0);
    // Exercise the real global setup and command wrapper with an offline
    // configuration failure. No product page or Safe test body may be started.
    const output = path.join(directory, "failed-run");
    const beforeDirectories = (await fs.readdir(os.tmpdir())).filter(n => n.startsWith("inssa-safe-session-")).sort();
    const execution = spawnSync(process.execPath, ["scripts/inssa/run-safe-suite.js"], {
      cwd: path.resolve(import.meta.dirname, "../.."), encoding: "utf8", timeout: 30_000,
      env: { ...process.env, INSSA_TEST_EMAIL: "", INSSA_TEST_PASSWORD: "", INSSA_RUN_OUTPUT_DIR: output,
        PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(output, "playwright-results.json"),
        PLAYWRIGHT_OUTPUT_DIR: path.join(output, "test-results"), PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(output, "playwright-report") }
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stdout + execution.stderr, /SAFE_AUTH_SETUP_FAILED: CONFIGURATION. Safe tests NOT STARTED/);
    const report = JSON.parse(await fs.readFile(path.join(output, "playwright-results.json"), "utf8"));
    assert.equal(report.errors.length, 1);
    assert.equal(report.stats.expected, 0); assert.equal(report.stats.unexpected, 0);
    assert.equal(JSON.parse(await fs.readFile(path.join(output, "safe-auth-preflight.json"), "utf8")).status, "FAILED");
    assert.deepEqual((await fs.readdir(os.tmpdir())).filter(n => n.startsWith("inssa-safe-session-")).sort(), beforeDirectories);

    console.log("PASS: fresh direct-compose auth once; run-owned private state; eight consumers; independent strict test contexts; unknown/product writes blocked; Home and seed fail preparation; sanitized failure survives");
  } finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
