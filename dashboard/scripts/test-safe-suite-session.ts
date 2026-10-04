import assert from "node:assert/strict";
import { chromium, type Page } from "@playwright/test";
import { dismissInssaSessionWarning } from "../../utils/inssa-session-warning";
import { LandingPage } from "../../pages/inssa/landing.page";
async function main() {
const browser = await chromium.launch();
const notice = '<section role="status"><h2>Heads up about this browser session</h2><button onclick="sessionStorage.setItem(\'dismissed\',\'1\');this.parentElement.remove()">Got it</button></section>';
const ready = '<input type="text" placeholder="Search for any place"><button>Find</button><button>Bury</button><a href="/points-ledger">Points</a>';
try {
  for (const scenario of ['immediate','delayed','absent','disappearing','button-detaches','unrelated-control','persistent-failure']) {
    const context = await browser.newContext();const page = await context.newPage();
    await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<body><main>${scenario==='absent'||scenario==='delayed'?'':notice}</main><button id="unrelated" onclick="window.unrelatedClicked=true">Got it</button><script>localStorage.setItem('firebase:authUser:fixture:[DEFAULT]',JSON.stringify({uid:'fixture'}));localStorage.setItem('userProfile',JSON.stringify({state:{userProfile:{uid:'fixture'}}}));</script>`}));
    await page.goto('https://fixture.invalid/');
    if (scenario==='delayed') {
      await page.evaluate(({notice,ready})=>{setTimeout(()=>{document.querySelector('main')!.innerHTML=notice;setTimeout(()=>document.querySelector('main')!.insertAdjacentHTML('beforeend',ready),300);},150);},{notice,ready});
      await new LandingPage(page).expectAuthenticatedLandingSurface();
    } else if (scenario==='disappearing') {
      const wrapped = new Proxy(page,{get(target,key){if(key!=='getByRole')return Reflect.get(target,key);return (...args:Parameters<Page['getByRole']>)=>{const locator=target.getByRole(...args);return new Proxy(locator,{get(loc,property){if(property!=='filter')return Reflect.get(loc,property);return (options:Parameters<typeof loc.filter>[0])=>{const scoped=loc.filter(options);const real=scoped.getByRole.bind(scoped);scoped.getByRole=((...a:Parameters<typeof real>)=>{void page.evaluate(()=>document.querySelector('[role=status]')?.remove());return real(...a);}) as typeof real;return scoped;};}});};}});
      await dismissInssaSessionWarning(wrapped);
    } else if(scenario==='button-detaches') {
      await page.locator('[role=status] button').evaluate(button=>button.addEventListener('pointerover',()=>{const replacement=button.cloneNode(true);button.replaceWith(replacement);},{once:true}));
      await dismissInssaSessionWarning(page);
    } else if(scenario==='persistent-failure') {
      await page.locator('[role=status] button').evaluate(button=>button.removeAttribute('onclick'));
      await assert.rejects(dismissInssaSessionWarning(page),/Timeout 3000ms/);
    } else await dismissInssaSessionWarning(page);
    if(scenario!=='persistent-failure')assert.equal(await page.locator('[role=status]').isVisible(),false);
    assert.equal(await page.evaluate(()=>Boolean((window as unknown as {unrelatedClicked?:boolean}).unrelatedClicked)),false);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('userProfile')!).state.userProfile.uid),'fixture');
    const next=await browser.newContext();const isolated=await next.newPage();await next.route('**/*',route=>route.fulfill({body:'<html></html>'}));await isolated.goto('https://fixture.invalid/');assert.equal(await isolated.evaluate(()=>sessionStorage.getItem('dismissed')),null);await next.close();
    await context.close();console.log(`PASS ${scenario}: identity preserved; unrelated control untouched; isolated context`);
  }
} finally { await browser.close(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
