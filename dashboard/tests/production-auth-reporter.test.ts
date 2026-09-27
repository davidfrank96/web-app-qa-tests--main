import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ProductionAuthReporter from "../../scripts/inssa/production-auth-reporter";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";

test("production failure evidence omits credential-bearing steps, output and exception text", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"production-auth-reporter-"));
  const names=["AUTH_MONITOR_OUTPUT_DIR","PLAYWRIGHT_JSON_OUTPUT_FILE","PLAYWRIGHT_HTML_OUTPUT_DIR","AUTH_MONITOR_PRODUCTION_PASSWORD","BREVO_API_KEY"];
  const before=names.map(name=>process.env[name]);
  try {
    process.env.AUTH_MONITOR_OUTPUT_DIR=dir; process.env.PLAYWRIGHT_JSON_OUTPUT_FILE=path.join(dir,"playwright-results.json");
    process.env.PLAYWRIGHT_HTML_OUTPUT_DIR=path.join(dir,"html");
    process.env.AUTH_MONITOR_PRODUCTION_PASSWORD="fixture-private-password"; process.env.BREVO_API_KEY="fixture-private-key";
    const reporter=new ProductionAuthReporter();
    reporter.onTestEnd({title:"username-password"} as TestCase, {status:"failed",retry:0,duration:100,startTime:new Date(),
      errors:[{message:"failure fixture-private-password fixture-private-key"}],
      steps:[{title:'fill("fixture-private-password")'}],stdout:["fixture-private-key"],stderr:["fixture-private-password"]} as unknown as TestResult);
    reporter.onEnd({status:"failed",duration:100,startTime:new Date()} as FullResult);
    const json=fs.readFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,"utf8"), html=fs.readFileSync(path.join(dir,"html/index.html"),"utf8");
    assert.doesNotMatch(json+html,/fixture-private-password|fixture-private-key/);
    const parsed=JSON.parse(json); assert.equal(parsed.stats.unexpected,1);
    assert.equal(parsed.suites[0].specs[0].tests[0].results[0].status,"failed");
    assert.match(html,/redacted/);
  } finally { names.forEach((name,i)=>{if(before[i]===undefined)delete process.env[name];else process.env[name]=before[i];});fs.rmSync(dir,{recursive:true,force:true}); }
});
