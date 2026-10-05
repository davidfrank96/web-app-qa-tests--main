import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getInssaPhase1Command } from "../lib/inssa-ops/command-registry";
const root=path.resolve(import.meta.dirname,"../..");
test("Safe discovery excludes Home/Bury and registers ten tests with one worker and zero retries",()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
  const command=pkg.scripts['test:inssa:safe'];
  assert.equal(command,'node scripts/inssa/run-safe-suite.js');
  assert.doesNotMatch(command,/live-capsule-create|smoke/);
  const listing=execFileSync(process.execPath,[path.join(root,'scripts/inssa/run-safe-suite.js'),'--list'],{cwd:root,encoding:'utf8'});
  assert.match(listing,/Total: 10 tests/);assert.doesNotMatch(listing,/authenticated bury|logged-out bury|Home.*Bury/i);
  assert.match(listing,/authenticated direct compose route/);
  const runner=fs.readFileSync(path.join(root,'scripts/inssa/run-safe-suite.js'),'utf8');
  assert.match(runner,/--workers=1/);assert.match(runner,/--retries=0/);
});
test("Home/Bury belongs to existing governed Text Lifecycle with approval controls intact",()=>{
  const command=getInssaPhase1Command('test_inssa_campaign_text')!;
  assert.equal(command.adminOnly,true);assert.equal(command.approvalRequired,true);assert.equal(command.mutatesStaging,true);
  assert.equal(command.npmScript,'test:inssa:campaign:text');
  const spec=fs.readFileSync(path.join(root,'tests/inssa/live-capsule-create.spec.ts'),'utf8');
  assert.match(spec,/productWriteAuditEnabled: false, safeSession: false/);
  assert.match(spec,/openGovernedHomeBury\(guestPage, false\)/);assert.match(spec,/openGovernedHomeBury\(page, true\)/);
  assert.match(spec,/governed-home-seeding.json/);assert.match(spec,/MANUAL_CLEANUP_APPROVED/);
});
