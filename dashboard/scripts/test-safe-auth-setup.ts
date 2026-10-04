// All browser traffic is intercepted; exercise the actual safe auth setup.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Route, type Request } from "@playwright/test";
import { ensureInssaAuthStorageState, getInssaAuthStorageStatePath } from "../../utils/auth";
import type { SafeWriteRecord } from "../../utils/inssa-safe-write-audit";
async function main() {
  Object.assign(process.env,{INSSA_URL:"https://safe-auth-fixture.invalid",INSSA_TEST_EMAIL:`${randomUUID()}@example.test`,INSSA_TEST_PASSWORD:"fixture-only"});
  const browser=await chromium.launch(); const statePath=getInssaAuthStorageStatePath();
  let injectMutation=false, blocked=0, forwardedMutations=0;
  const guarded=new Proxy(browser,{get(target,key){
    if(key!=="newContext")return Reflect.get(target,key);
    return async(options:Parameters<Browser["newContext"]>[0])=>{
      const context=await target.newContext(options);
      await context.route("**/*",async route=>{
        const url=new URL(route.request().url());
        if(route.request().method()==="POST"){forwardedMutations++;return route.fulfill({body:"{}"});}
        assert.equal(url.origin,process.env.INSSA_URL);
        assert.equal(url.pathname,"/signin");assert.equal(url.searchParams.get("next"),"/timecapsule");
        await route.fulfill({contentType:"text/html",body:`<input type="email"><input type="password"><button>Sign In</button><script>
          document.querySelector('button').onclick=async()=>{
            ${injectMutation?`await fetch('/api/drafts',{method:'POST',body:'{}'}).catch(()=>{});`:''}
            localStorage.setItem('firebase:authUser:fixture:[DEFAULT]',JSON.stringify({uid:'fixture-user',email:${JSON.stringify(process.env.INSSA_TEST_EMAIL)}}));
            localStorage.setItem('userProfile',JSON.stringify({state:{userProfile:{uid:'fixture-user'}}}));
            history.replaceState(null,'','/timecapsule');document.body.innerHTML='<a href="/me">Profile</a>';
          };</script>`});
      });
      // Keep the fixture underneath the real guard; continue becomes fallback
      // only here so no request can escape to the Internet.
      const realRoute=context.route.bind(context);
      context.route=async(pattern,handler)=>realRoute(pattern,async(route,request)=>{
        const wrapped=new Proxy(route,{get(target,key){if(key==='continue')return ()=>target.fallback();if(key==='abort')return async()=>{blocked++;await target.abort('blockedbyclient');};return Reflect.get(target,key);}});
        await (handler as (route:Route,request:Request)=>unknown)(wrapped,request);
      });
      return context;
    };
  }});
  try {
    const records:SafeWriteRecord[]=[];
    await ensureInssaAuthStorageState(guarded,{safe:true,onAudit:rows=>records.push(...rows)});
    assert.equal(blocked,0);await fs.rm(statePath,{force:true});
    injectMutation=true;
    await assert.rejects(ensureInssaAuthStorageState(guarded,{safe:true,onAudit:rows=>records.push(...rows)}),/Blocked unclassified non-read request/);
    assert.equal(blocked,1);assert.equal(forwardedMutations,0);
    assert.equal(records.some(row=>row.outcome==='BLOCKED_UNEXPECTED_WRITE'),true);
    await assert.rejects(fs.access(statePath));
    console.log('PASS: safe login uses direct compose redirect; setup guard blocks draft before forwarding; rejected session is not cached');
  } finally {await browser.close();await fs.rm(statePath,{force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
