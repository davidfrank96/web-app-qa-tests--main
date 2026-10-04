import assert from "node:assert/strict";
import { createInssaLifecycleNetworkMonitor } from "../../utils/inssa-lifecycle-network";
import { chromium } from "@playwright/test";
import { assertGovernedHomeBury, openGovernedHomeBury, observeGovernedHomeSeeding, seedResponseEvidence } from "../../utils/inssa-governed-home-bury";
import { INSSA_LIVE_CAPSULE_ENV_FLAG, INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG } from "../../utils/inssa-mutation";

async function main() {
  process.env.INSSA_URL = "https://staging.inssa.us";
  process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] = "1";
  process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] = "1";
  assertGovernedHomeBury();
  for (const flag of [INSSA_LIVE_CAPSULE_ENV_FLAG, INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG]) {
    process.env[flag] = "0"; assert.throws(assertGovernedHomeBury); process.env[flag] = "1";
  }
  process.env.INSSA_URL = "https://inssa.us"; assert.throws(assertGovernedHomeBury);
  process.env.INSSA_URL = "https://staging.inssa.us";
  assert.deepEqual(seedResponseEvidence({result:{createdCapsuleIds:["known", "invalid/id"], reusedCapsuleIds:["reused"]}}), {identity:"reported-system-owned",createdCapsuleIdsCount:2,createdCapsuleIds:["known"],reusedCapsuleIdsCount:1,reusedCapsuleIds:["reused"]});
  for (const value of [null, {}, {error:"failed"}, {result:{}}]) assert.deepEqual(seedResponseEvidence(value),{identity:"unknown"});
  process.env.INSSA_DEBUG_LIFECYCLE_NETWORK = "1";
  const browser = await chromium.launch();
  try {
    for (const authenticated of [false,true]) {
      const context=await browser.newContext({baseURL:process.env.INSSA_URL});
      const page=await context.newPage(); const observer=observeGovernedHomeSeeding(); observer.attach(page);
      const network=createInssaLifecycleNetworkMonitor({getPhase:()=>"pre-create",separatelyAccountedEndpoints:["https://us-central1-kbean-stg-fcm.cloudfunctions.net/discover_seedQuickFindCategories"]});network.attach(page);
      const visits:string[]=[];
      await context.route("**/*", async route => {
        const url=new URL(route.request().url()); visits.push(url.pathname);
        if(url.hostname.endsWith("cloudfunctions.net")) return route.fulfill({contentType:"application/json",body:JSON.stringify({result:{createdCapsuleIds:["fixture-id"],reusedCapsuleIds:[],categories:{places:[{id:"system-capsule",capsuleId:"system-capsule"}]}}})});
        const body=url.pathname==="/" ? `<input type="text" placeholder="Search for any place"><button>Find</button><button onclick="location.href='${authenticated?'/timecapsule':'/signin?next=%2Ftimecapsule'}'">Bury</button><a href="/signin">Sign In</a><a href="/points-ledger">Points</a>` : '<h1>Compose</h1><input type="text"><textarea></textarea><button>Discard draft</button><button>Save & exit</button>';
        await route.fulfill({contentType:"text/html",body});
      });
      await openGovernedHomeBury(page,authenticated);
      assert.deepEqual(visits,["/",authenticated?"/timecapsule":"/signin"]);
      await page.evaluate(async()=>{await fetch("https://us-central1-kbean-stg-fcm.cloudfunctions.net/discover_seedQuickFindCategories",{method:"POST",body:"{}"});});
      const evidence=await observer.finish();
      await network.flush();
      assert.ok(network.observations.some(row=>row.event==="response"));
      assert.deepEqual(network.summarize().possibleCapsuleIds,[]);
      assert.deepEqual(network.summarize().possibleDocumentIds,[]);
      assert.equal(JSON.stringify(network.observations).includes("system-capsule"),false);
      assert.equal(evidence.records.length,1); assert.equal(evidence.records[0].createdCapsuleIdsCount,1);
      assert.equal(evidence.records[0].owner,"inssa"); assert.equal(evidence.records[0].cleanup,"manual-review-only-not-qa-owned");
      assert.equal(evidence.manualCleanup,true);assert.equal(evidence.advisory,true);
      await context.close();
    }
    console.log("PASS: isolated guest/authenticated Home → Bury routing, staging/approval rejection, sanitized seed accounting; no live mutation");
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
