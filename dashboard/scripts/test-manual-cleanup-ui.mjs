// The real dashboard and stylesheet against loopback fixtures. No product requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(dashboard, 'package.json'));
const { build } = require('esbuild');
const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss');
const artifactDir = process.env.LIFECYCLE_UI_ARTIFACT_DIR || path.join(os.tmpdir(), 'lifecycle-ux-verification');
await fs.mkdir(artifactDir, { recursive: true });
const names = ['Text Lifecycle', 'Media Lifecycle', 'Video Lifecycle', 'Reveal-Later Lifecycle', 'Cross-User Campaign', 'Reveal-Later Security'];
const keys = ['text', 'media', 'video', 'reveal_later', 'cross_user', 'reveal_later_security'];
const campaigns = keys.map((key, i) => ({ key: `test_inssa_campaign_${key}`, displayName: names[i], npmScript: `test:inssa:campaign:${key.replaceAll('_','-')}`, commandType: 'campaign', mutatesStaging: true, adminOnly: true, approvalRequired: true, cleanupRequired: true, operatorDescription: `Creates a QA ${key.replaceAll('_',' ')} capsule and validates its lifecycle.`, phase1Enabled: true, producesReports: true, producesFindings: i > 3, riskLevel: 'live_mutation', timeoutMs: 1200000, targetEnvironment: 'staging', supportsExecutionModes: key.includes('reveal'), requiresSecondaryAccount: i > 3 }));
const metadataBackend = { backend: 'local-json', backendLabel: 'Fixture', counts: { runs: 1, logs: 1, artifacts: 0 }, error: null, storePath: null };
const records = Array.from({ length: 10 }, (_, i) => ({ id: `ledger-${i}`, objectId: `capsule-${i}`, objectPath: `timeCapsules/long-qa-object-identity-${i}-retained-with-full-inspectable-path`, originatingRunId: 'historical-run', campaignKey: campaigns[i < 3 ? 0 : i < 6 ? 1 : i < 9 ? 2 : 4].key, createdAt: '2026-08-01T00:00:00Z', retentionUntil: '2026-11-01T00:00:00Z', status: 'cleanup_unavailable', ownerAccount: 'qa@example.test', notes: 'Manual removal needed', evidencePaths: [], safelyAccounted: true }));
const checks = ['governed-command','admin-role','staging-target','worker-health','active-run','prerequisites','output-storage'].map(id=>({ id, detail: `${id} verified`, passed:true }));
checks.push({id:'manual-cleanup',detail:'10 unresolved QA objects remain advisory',passed:true,advisory:true});
const readiness = campaigns.map(campaign => ({ campaignKey:campaign.key,status:campaign.supportsExecutionModes?'NOT_YET_VALIDATED':'READY_WITH_MANUAL_CLEANUP',manualCleanupMode:true,executionAllowed:true,unresolvedCount:10,createdObjectPaths:records.filter(r=>r.campaignKey===campaign.key).map(r=>r.objectPath),cleanupStatus:'cleanup_unavailable',lastResult:campaign===campaigns[0]?'failed':'not_yet_validated',latestRunAvailable:campaign===campaigns[0],latestRunId:campaign===campaigns[0]?'historical-run':null,checks,oldestUnresolvedAt:records[0].createdAt,advisories:checks.filter(c=>c.advisory)}));
const run = { id:'historical-run',campaignKey:campaigns[0].key,status:'failed',exitCode:1,createdAt:'2026-08-01T00:00:00Z',updatedAt:'2026-08-01T00:01:00Z',startedAt:'2026-08-01T00:00:00Z',completedAt:'2026-08-01T00:01:00Z',durationMs:60000,requestedBy:'fixture',cleanup:{status:'pending',createdCapsuleIds:['a','b','c'],createdArtifactIds:[],instructions:['Remove QA objects only after independent verification.'],confirmedAt:null} };
const props = { currentUser: { id: 'fixture', email: 'admin@example.test', role: 'admin' }, initialCampaignDefinitions: campaigns, initialMetadataBackend: metadataBackend, initialRuns: [run] };
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {InssaOpsClient} from './inssa-ops-client'; const props=${JSON.stringify(props)}; props.currentUser.role=new URL(location.href).searchParams.get('role')||'admin'; createRoot(document.getElementById('root')).render(React.createElement(InssaOpsClient, props));`, resolveDir: path.join(dashboard, 'components'), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const css = process.env.LIFECYCLE_UI_CSS_PATH
  ? await fs.readFile(process.env.LIFECYCLE_UI_CSS_PATH, 'utf8')
  : (await postcss([tailwind({base: dashboard})]).process(await fs.readFile(path.join(dashboard,'app/globals.css'),'utf8'),{from:path.join(dashboard,'app/globals.css')})).css;
let previews = [], approvals = [], launches = 0, confirmations = 0, blocked = false, delayCreate = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url,'http://fixture');
  if (url.pathname === '/') { res.setHeader('content-type','text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); return; }
  if (url.pathname === '/bundle.js') {res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if (url.pathname === '/style.css') {res.setHeader('content-type','text/css');res.end(css);return;}
  let body = {};
  if (url.pathname === '/api/runs') {if(req.method==='POST') { launches++; res.statusCode=409; body={error:'Fixture execution rejected; no job created'}; } else body={runs:[run],metadataBackend};}
  else if (url.pathname.startsWith('/api/runs/')) { const kind=url.pathname.split('/')[4]; body=kind==='logs'?{logs:[]}:kind==='artifacts'?{artifacts:[]}:kind==='evidence'?{bundles:[],items:[]}:{run}; }
  else if (url.pathname === '/api/campaign-definitions') body={campaignDefinitions:campaigns};
  else if (url.pathname === '/api/cleanup-ledger') {if(req.method==='POST') confirmations++; body={records,readiness,manualCleanupMode:true};}
  else if (url.pathname === '/api/lifecycle-artifacts') body={artifacts:[{filePath:'reports/approved-reveal.json',subject:'Approved staging capsule',artifactId:'approved',timestamp:'2026-08-01T00:00:00Z',artifactType:'reveal-later',artifactValidationReady:true}]};
  else if (url.pathname === '/api/campaign-approvals') {
    const chunks=[];for await(const chunk of req)chunks.push(chunk); const input=JSON.parse(Buffer.concat(chunks).toString());
    if(input.action==='preview') {
      previews.push(input); const campaign=campaigns.find(c=>c.key===input.campaignKey);
      let error = blocked ? 'Worker unavailable' : campaign.supportsExecutionModes && !input.liveApproval.executionMode ? 'Choose Create new or Resume existing.' : input.liveApproval.executionMode==='resume' && !input.liveApproval.resumeArtifactPath ? 'Select an approved artifact.' : null;
      if(delayCreate && input.liveApproval.executionMode==='create') await new Promise(resolve=>setTimeout(resolve,700));
      body=error?{ok:false,error,checks:[{id:'worker-health',detail:error,passed:false}]}:{ok:true,checks};if(error)res.statusCode=503;
    } else if(input.action==='preflight') {approvals.push(input);body={ok:true,checks};}
  }
  res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')) { console.log(`Lifecycle UI fixture: ${origin}`); await new Promise(()=>{}); }
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
await page.clock.setFixedTime(new Date("2026-10-03T12:00:00Z"));
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
const click = name=>page.getByRole('button',{name,exact:true}).click();
async function ready() {await page.getByRole('status').filter({hasText:'Ready to run'}).waitFor();}
async function consent() {await page.getByRole('dialog').getByRole('checkbox').check();await page.getByLabel('Type RUN STAGING MUTATION',{exact:true}).fill('RUN STAGING MUTATION');}
async function noOverflow(label) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: document overflow`);
  const modal=page.getByRole('dialog');if(await modal.count()) {const b=await modal.boundingBox();const v=page.viewportSize();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1,`${label}: modal outside viewport`); const btn=await page.getByRole('button',{name:'Run Test',exact:true}).boundingBox();assert.ok(btn.y+btn.height<=v.height,`${label}: CTA hidden`);}
}
try {
  await page.goto(origin);await click('Lifecycle');await page.getByText('Manual cleanup mode',{exact:true}).waitFor();
  assert.equal(await page.getByText('Manual cleanup mode',{exact:true}).count(),1);
  assert.equal(await page.getByText('Mutation deployment readiness',{exact:true}).count(),0);
  assert.equal(await page.getByRole('article',{name:'Selected campaign'}).count(),1);
  assert.equal(await page.getByText('Video unavailable',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'View latest run',exact:true}).count(),1);
  assert.equal(await page.getByTestId('campaign-result').innerText(),'Failed');
  assert.equal(await page.locator('.lc-backlog').getAttribute('open'),null);
  assert.equal(await page.getByText('Manual cleanup backlog · 10 objects',{exact:true}).count(),1);
  for(const label of ['Open Video','Open Evidence','Open Run','Run Preflight Only']) assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0);
  await page.locator('.lc-backlog > summary').click();assert.equal(await page.getByRole('button',{name:'Mark manually cleaned',exact:true}).count(),10);
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Mark manually cleaned',exact:true}).first().click();assert.equal(confirmations,0);
  await page.locator('.lc-backlog > summary').click();await click('Reveal-Later Lifecycle');
  await page.getByRole('heading',{name:'Reveal-Later Lifecycle',exact:true}).waitFor();await page.locator('.lc-selected > details > summary').click();
  await page.getByText('No created objects recorded for this campaign',{exact:true}).waitFor();assert.equal(await page.getByText('Manual cleanup required',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'View latest run',exact:true}).count(),0);
  await click('Text Lifecycle');await click('Review & Run');await ready();assert.equal(previews.length,1);assert.equal(approvals.length,0);assert.equal(launches,0);
  assert.equal(await page.getByRole('button',{name:'Run Test',exact:true}).isDisabled(),true);await consent();assert.equal(await page.getByRole('button',{name:'Run Test',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Run Test',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Run Test');
  assert.notEqual(await page.getByRole('button',{name:'Run Test',exact:true}).evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  blocked=true;await click('Recheck');await page.getByRole('alert').filter({hasText:'Worker unavailable'}).waitFor();assert.equal(await page.getByRole('button',{name:'Run Test',exact:true}).isDisabled(),true);
  blocked=false;await click('Recheck');await ready();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Review & Run');
  await click('Reveal-Later Lifecycle');await click('Review & Run');await page.getByRole('alert').filter({hasText:'Choose Create new'}).waitFor();
  delayCreate=true;await page.getByRole('radio',{name:'Create new',exact:true}).check();await page.getByRole('radio',{name:'Resume existing',exact:true}).check();await page.getByRole('alert').filter({hasText:'Select an approved artifact'}).waitFor();await page.waitForTimeout(800);assert.equal(await page.getByRole('button',{name:'Run Test',exact:true}).isDisabled(),true);
  await page.getByLabel('Approved Reveal-Later artifact').selectOption('reports/approved-reveal.json');await ready();assert.equal(previews.at(-1).liveApproval.resumeArtifactPath,'reports/approved-reveal.json');await click('Cancel');delayCreate=false;
  await click('Security');await click('Cross-User Campaign');await click('Review & Run');await ready();assert.equal(previews.at(-1).campaignKey,campaigns[4].key);assert.equal(await page.getByRole('radio').count(),0);await click('Cancel');
  await click('Lifecycle');await click('Text Lifecycle');await click('View latest run');await page.getByRole('heading',{name:'Run Detail',exact:true}).waitFor();await page.locator('.lc-run-cleanup').waitFor();assert.equal(await page.locator('.lc-run-cleanup').getAttribute('open'),null);assert.match(await page.locator('.lc-run-cleanup summary').innerText(),/awaiting cleanup/);
  await click('Lifecycle');
  const layout=[];
  for(const theme of ['dark','light']) {
    await click(theme==='dark'?'🌙 Dark':'☀️ Light');
    for(const width of [320,375,390,430,768,1024,1440]) {
      await page.setViewportSize({width,height:width<768?844:1000});await noOverflow(`${theme} ${width}`);
      await page.getByRole('button',{name:'Review & Run',exact:true}).scrollIntoViewIfNeeded();
      assert.ok(await page.getByRole('button',{name:'Review & Run',exact:true}).evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),`${theme} ${width}: primary action covered`);
      await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
      await page.screenshot({path:path.join(artifactDir,`${theme}-${width}-workspace.png`),fullPage:true,animations:"disabled"});
      await click('Review & Run');await ready();await noOverflow(`${theme} ${width} dialog`);await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));await page.screenshot({path:path.join(artifactDir,`${theme}-${width}-dialog.png`),animations:"disabled"});
      await click('Cancel');layout.push({theme,width,pass:true});
    }
  }
  await page.goto(origin+'/?role=viewer');await click('Lifecycle');await page.locator('.lc-backlog > summary').click();assert.equal(await page.getByRole('button',{name:'Mark manually cleaned',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Review & Run',exact:true}).isDisabled(),true);
  assert.equal(launches,0);assert.equal(confirmations,0);assert.equal(approvals.length,0);assert.ok(previews.every(p=>!('confirmationPhrase' in p.liveApproval)&&!('acknowledgements' in p.liveApproval)));
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(artifactDir,'layout-results.json'),JSON.stringify(layout,null,2));
  console.log('PASS: one campaign workflow/banner/backlog; truthful results; automatic readiness with stale-response protection; blockers; consent; admin cleanup; Reveal-Later; keyboard/focus/Escape; 14 themed responsive layouts; zero execution/cleanup requests');
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
