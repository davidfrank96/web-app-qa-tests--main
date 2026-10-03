// Offline browser fixtures: no product authentication or product writes.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { AuthPage } from "../../pages/inssa/auth-page";

async function main() {
const origin = "https://staging-auth-fixture.invalid";
process.env.INSSA_URL = origin;
const browser = await chromium.launch();
const cases = ["success", "slow-profile", "post-login-overlays", "public-location-modal", "login-location-modal", "late-location-modal", "slow-location-consent", "permission-driven-location", "wrong-account", "stale-profile", "logout-failure", "missing-control"];
try {
  for (const scenario of cases.filter(name => !process.argv[2] || name === process.argv[2])) {
    const context = await browser.newContext({ baseURL: origin, serviceWorkers: "block" });
    let documents = 0;
    await context.route("**/*", async route => {
      assert.equal(new URL(route.request().url()).origin, origin);
      documents++;
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><main><input type="email"><input type="password"><button>Sign In</button></main><script>
        const scenario = ${JSON.stringify(scenario)};
        document.querySelector('button').onclick = () => {
          const user = {uid:'expected',email:scenario==='wrong-account'?'wrong@example.test':'expected@example.test'};
          localStorage.setItem('firebase:authUser:fixture:[DEFAULT]', JSON.stringify(user));
          history.replaceState(null,'','/');
          document.querySelector('main').innerHTML = '<a href="/me" aria-label="Profile, 1 new">Profile</a>';
          setTimeout(() => localStorage.setItem('userProfile',JSON.stringify({state:{userProfile:{uid:scenario==='stale-profile'?'stale':'expected'}}})), scenario==='slow-profile'?700:0);
          if(scenario==='post-login-overlays') {
            const overlay=document.createElement('aside');overlay.setAttribute('aria-hidden','true');overlay.innerHTML='<h2>Signing in...</h2>';overlay.style.cssText='position:fixed;inset:0;background:white;z-index:100';document.body.append(overlay);
            setTimeout(()=>{overlay.removeAttribute('aria-hidden');overlay.innerHTML='<p>Heads up about this browser session</p><button>Got it</button>';overlay.querySelector('button').onclick=()=>{overlay.remove();};
              const onboarding=document.createElement('aside');onboarding.style.cssText='position:fixed;inset:0;background:white;z-index:99';onboarding.innerHTML='<button aria-label="Skip onboarding">Skip</button>';onboarding.querySelector('button').onclick=()=>onboarding.remove();document.body.append(onboarding);
            },700);
          }
          if(scenario==='login-location-modal'||scenario==='late-location-modal'||scenario==='slow-location-consent'||scenario==='permission-driven-location') {
            const showLocation=()=>{
              document.querySelector('main').setAttribute('aria-hidden','true');
              const prompt=document.createElement('section');prompt.setAttribute('role','dialog');prompt.setAttribute('aria-label',"Unlock what's near you");prompt.style.cssText='position:fixed;inset:0;z-index:500;background:white';prompt.innerHTML='<button>Use my location</button>';document.body.append(prompt);
              if(scenario==='slow-location-consent'){prompt.querySelector('button').disabled=true;setTimeout(()=>prompt.querySelector('button').disabled=false,2500);}
              if(scenario==='permission-driven-location')navigator.permissions.query({name:'geolocation'}).then(permission=>{const sync=()=>{if(permission.state==='granted'){document.querySelector('main').removeAttribute('aria-hidden');prompt.remove();}};permission.onchange=sync;sync();});
              prompt.querySelector('button').onclick=()=>{document.querySelector('main').removeAttribute('aria-hidden');prompt.remove();if(scenario==='slow-location-consent'){const link=document.querySelector('a');link.style.cssText='display:inline-block;transform:translateX(150px);transition:transform 2.2s';requestAnimationFrame(()=>requestAnimationFrame(()=>link.style.transform='translateX(0)'));}};
            };
            if(scenario==='login-location-modal'||scenario==='slow-location-consent'||scenario==='permission-driven-location')showLocation();else {
              document.querySelector('a').style.cssText='transform:translateX(50px);transition:transform 1s';
              setTimeout(showLocation,30);
              setTimeout(()=>document.querySelector('a')?.style.removeProperty('transform'),10);
            }
          }
          document.querySelector('a').onclick = event => {
            event.preventDefault(); history.pushState(null,'','/u/expected');
            document.querySelector('main').innerHTML = '<h1>Profile</h1>';
            if(scenario!=='missing-control') {
              const button=document.createElement('button');button.textContent='Sign out';document.querySelector('main').append(button);
              button.onclick=()=>{if(scenario==='logout-failure')return;localStorage.removeItem('firebase:authUser:fixture:[DEFAULT]');localStorage.removeItem('userProfile');history.pushState(null,'','/');document.querySelector('main').innerHTML='<a href="/signin">Sign In</a>';if(scenario==='public-location-modal'){document.querySelector('main').setAttribute('aria-hidden','true');const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent="Unlock what is near you";document.body.append(dialog);}};
            }
          };
        };
      </script>` });
    });
    const page=await context.newPage();if(scenario==='slow-location-consent'||scenario==='permission-driven-location')page.setDefaultTimeout(3000);const auth=new AuthPage(page);
    await auth.goToSignIn();await auth.signInWithEmail("expected@example.test","fixture-only");
    if(scenario==='success'||scenario==='slow-profile'||scenario==='post-login-overlays'||scenario==='public-location-modal'||scenario==='login-location-modal'||scenario==='late-location-modal'||scenario==='slow-location-consent'||scenario==='permission-driven-location') {
      await auth.signOutStaging("expected@example.test");await auth.expectPublicState();
    } else {
      await assert.rejects(auth.signOutStaging("expected@example.test"), scenario==='missing-control'?/sign out/i:scenario==='logout-failure'?/Expected: false/:/Expected: true/);
    }
    assert.equal(documents,1,"logout must use Profile SPA navigation, not reload /me");
    await context.close();console.log(`PASS ${scenario}`);
  }
} finally {await browser.close();}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
