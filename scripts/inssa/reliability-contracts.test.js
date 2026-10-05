const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { classifyFinalSecurityPosture } = require('./run-security-verification-campaign');
test('security verification never claims success with no usable input or completed probes',()=>{
 const base={usableArtifactCount:0,verificationAreas:{},confirmedFindings:[],suspectedFindings:[]};
 assert.equal(classifyFinalSecurityPosture(base),'blocked-prerequisite-no-usable-artifacts');
 assert.equal(classifyFinalSecurityPosture({...base,confirmedFindings:[{severity:'critical'}]}),'critical-confirmed-findings');
 assert.equal(classifyFinalSecurityPosture({...base,usableArtifactCount:1}),'blocked-prerequisite-no-completed-verification');
 assert.equal(classifyFinalSecurityPosture({...base,usableArtifactCount:1,verificationAreas:{tokenless:{byStatus:{completed:1}}}}),'verification-complete-no-high-risk-findings');
});
test('report commands fail visibly when their source summaries do not exist',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'qa-report-input-'));
 try{for(const kind of ['security','lifecycle']){
  const r=spawnSync(process.execPath,[path.join(__dirname,'render-campaign-report.js'),kind],{cwd:dir,encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/No .* campaign summary found/);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
test('manual Safe Suite has zero retries while CI keeps independent retry policy',()=>{
 const {scripts}=require('../../package.json');
 assert.equal(scripts['test:inssa:safe'],'node scripts/inssa/run-safe-suite.js');
 const {safeTestArgs}=require('./run-safe-suite');
 assert.ok(safeTestArgs.includes('--workers=1'));assert.ok(safeTestArgs.includes('--retries=0'));
 assert.doesNotMatch(scripts['test:ci:playwright'],/--retries=0/);
});
