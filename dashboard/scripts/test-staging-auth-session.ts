// Offline browser fixtures: no product authentication or product writes.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { AuthPage } from "../../pages/inssa/auth-page";

const cases: Record<string, string | null> = {
  success: null,
  "slow-profile": null,
  "location-dialog": null,
  onboarding: null,
  "unactionable-profile-link": null,
  "wrong-account": "SESSION_NOT_ESTABLISHED",
  "missing-profile": "PROFILE_INITIALIZATION_FAILED",
  "mismatched-uid": "PROFILE_INITIALIZATION_FAILED",
  "profile-route-failure": "AUTHENTICATED_PROFILE_ROUTE_FAILED",
  "missing-control": "LOGOUT_CONTROL_MISSING",
  "logout-failure": "LOGOUT_FAILED",
  "public-state": null,
  "public-onboarding": null,
  "sign-out-persists": "LOGOUT_FAILED",
  "profile-route-persists": "LOGOUT_FAILED",
  "random-public-page": "LOGOUT_FAILED",
  "credentials-rejected": "AUTHENTICATION_REJECTED",
  "no-firebase-session": "SESSION_NOT_ESTABLISHED"
};

async function main() {
  const origin = "https://staging-auth-fixture.invalid";
  process.env.INSSA_URL = origin;
  const browser = await chromium.launch();
  try {
    for (const [scenario, failure] of Object.entries(cases).filter(([name]) => !process.argv[2] || name === process.argv[2])) {
      const context = await browser.newContext({ baseURL: origin, serviceWorkers: "block" });
      // Any accidental restoration of these auth dependencies fails the fixture.
      context.setGeolocation = async () => { throw new Error("Auth must not set geolocation"); };
      context.grantPermissions = async () => { throw new Error("Auth must not grant permissions"); };
      const page = await context.newPage();
      page.addLocatorHandler = async () => { throw new Error("Auth must not install overlay handlers"); };
      page.setDefaultTimeout(10_000);
      const documents: string[] = [];
      let readyBeforeNavigation = false;
      await page.exposeFunction("recordReadiness", (ready: boolean) => { readyBeforeNavigation = ready; });
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, origin);
        documents.push(url.pathname);
        if (url.pathname === "/me") {
          // This runs before fulfilling the new document: persistence must have
          // completed in the landing document, including the slow-profile case.
          assert.equal(readyBeforeNavigation, true, "Direct /me navigation must follow matching persisted identity and completed login");
          await route.fulfill({ status: scenario === "profile-route-failure" ? 503 : 200, contentType: "text/html", body: `<!doctype html><main><h1>Profile</h1>${scenario === "missing-control" ? "" : "<button>Sign Out</button>"}</main><script>
            document.querySelector('button')?.addEventListener('click',()=>{
              sessionStorage.setItem('logoutClicked','true');
              if(${JSON.stringify(scenario)}==='logout-failure')return;
              localStorage.removeItem('firebase:authUser:fixture:[DEFAULT]');
              localStorage.removeItem('userProfile');
              if(${JSON.stringify(scenario)}!=='profile-route-persists')history.pushState(null,'','/');
              document.querySelector('main').innerHTML='<a href="/signin">Sign In</a>';
              if(${JSON.stringify(scenario)}==='public-onboarding')document.querySelector('main').innerHTML='<section aria-label="Onboarding"><button aria-label="Skip onboarding"></button><button>Skip</button><button>Next</button></section>';
              if(${JSON.stringify(scenario)}==='sign-out-persists')document.querySelector('main').insertAdjacentHTML('beforeend','<button>Sign Out</button>');
              if(${JSON.stringify(scenario)}==='random-public-page')document.querySelector('main').innerHTML='<h1>Some page</h1><p>Not an authentication signal</p>';
              if(${JSON.stringify(scenario)}==='public-state') {
                document.querySelector('main').setAttribute('aria-hidden','true');
                const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.textContent="Unlock what's near you";document.body.append(dialog);
              }
            });
          </script>` });
          return;
        }
        assert.equal(url.pathname, "/signin");
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><main><input type="email"><input type="password"><button>Sign In</button></main><script>
          const scenario=${JSON.stringify(scenario)};
          document.querySelector('button').onclick=()=>{
            if(scenario==='credentials-rejected'){document.querySelector('main').insertAdjacentHTML('beforeend','<p role="alert">Incorrect password</p>');return;}
            if(scenario!=='no-firebase-session')localStorage.setItem('firebase:authUser:fixture:[DEFAULT]',JSON.stringify({uid:'expected',email:scenario==='wrong-account'?'wrong@example.test':'expected@example.test'}));
            document.querySelector('main').innerHTML='<h2>Signing in...</h2>';
            setTimeout(()=>{
              if(scenario!=='missing-profile')localStorage.setItem('userProfile',JSON.stringify({state:{userProfile:{uid:scenario==='mismatched-uid'?'stale':'expected'}}}));
              // Persistence precedes completion of the transitional surface.
              setTimeout(()=>{
                history.replaceState(null,'','/');
                document.querySelector('main').innerHTML='<a href="/me" aria-label="Profile">Profile</a>';
                document.querySelector('a').onclick=event=>{event.preventDefault();sessionStorage.setItem('unrelatedInteraction','profile-link');};
                if(scenario==='unactionable-profile-link')document.querySelector('a').style.cssText='pointer-events:none;position:fixed;left:-2000px';
                if(scenario==='location-dialog'||scenario==='onboarding'){
                  const overlay=document.createElement('section');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label',scenario==='location-dialog'?"Unlock what's near you":'Welcome');overlay.style.cssText='position:fixed;inset:0;z-index:500;background:white';
                  overlay.innerHTML=scenario==='location-dialog'?'<button>Use my location</button>':'<button>Skip onboarding</button>';
                  overlay.querySelector('button').onclick=()=>sessionStorage.setItem('unrelatedInteraction','overlay');document.body.append(overlay);
                  document.querySelector('main').setAttribute('aria-hidden','true');
                }
                sessionStorage.setItem('loginFinished','true');
                const user=JSON.parse(localStorage.getItem('firebase:authUser:fixture:[DEFAULT]'));
                const profile=JSON.parse(localStorage.getItem('userProfile'));
                window.recordReadiness(user?.email==='expected@example.test'&&user?.uid===profile?.state?.userProfile?.uid);
              },100);
            },scenario==='slow-profile'?700:0);
          };
        </script>` });
      });
      try {
        const auth = new AuthPage(page);
        await auth.goToSignIn();
        await auth.submitEmailPassword("expected@example.test", "fixture-only");
        if (failure) await assert.rejects(auth.signOutStaging("expected@example.test"), new RegExp(`^Error: ${failure}:`));
        else {
          await auth.signOutStaging("expected@example.test");
          assert.equal(await page.evaluate(() => sessionStorage.getItem("logoutClicked")), "true");
          if (scenario === "public-onboarding") {
            assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isVisible(), true);
            assert.equal(await page.locator("a[href='/signin']").count(), 0);
          } else await auth.expectPublicState();
        }
        assert.equal(await page.evaluate(() => sessionStorage.getItem("unrelatedInteraction")), null);
        const beforeProfileFailure = ["SESSION_NOT_ESTABLISHED", "PROFILE_INITIALIZATION_FAILED", "AUTHENTICATION_REJECTED"].includes(failure ?? "");
        assert.deepEqual(documents, beforeProfileFailure ? ["/signin"] : ["/signin", "/me"]);
        console.log(`PASS ${scenario}${failure ? ` (${failure})` : ""}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
