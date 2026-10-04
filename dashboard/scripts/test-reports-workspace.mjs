// Real Reports workspace + stylesheet; all requests are restricted to a loopback fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(dashboard, 'package.json'));
const { build } = require('esbuild');
const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss');
const baseline = process.argv.includes('--baseline');
const output = process.env.REPORTS_UI_ARTIFACT_DIR || path.join(dashboard, '../output/playwright/reports-restructure');
await fs.mkdir(output, { recursive: true });
const longPath = 'reports/' + 'long-but-realistic-campaign-evidence-path-'.repeat(4);
const sha = 'abcdef0123456789'.repeat(4);
const kinds = ['Playwright Report', 'Security Report', 'Lifecycle Report', 'SIEM Export'];
const campaigns = ['security', 'lifecycle'].map(kind => ({ key: `render_${kind}`, displayName: kind === 'security' ? 'Re-render Latest Security Report' : 'Render Lifecycle Report', npmScript: `report:inssa:${kind}`, commandType: 'report_render', riskLevel: 'read_only', operatorDescription: `Render the existing ${kind} evidence as a report.`, timeoutMs: 60000, targetEnvironment: 'staging', phase1Enabled: true }));
const runs = Array.from({ length: 5 }, (_, i) => ({ id: `${i}a47639b-8da8-46bf-b28a-499199da1459`, campaignKey: i === 0 ? 'test_inssa_authentication_monitoring_staging' : `campaign_${['','security','historical','empty','expired'][i]}`, status: 'passed', exitCode: 0, createdAt: `2026-10-0${5-i}T01:00:00Z`, completedAt: `2026-10-0${5-i}T01:01:00Z`, updatedAt: `2026-10-0${5-i}T01:01:00Z`, durationMs: 60000, requestedBy: 'fixture' }));
const artifacts = runs.slice(0, 3).flatMap((run, i) => kinds.map((artifactType, j) => ({ id: `artifact-${i}-${j}`, runId: run.id, artifactType, filePath: `${longPath}${i}-${j}.${j === 3 ? 'json' : 'html'}`, contentType: j === 3 ? 'application/json' : 'text/html', fileSize: 12345, createdAt: run.createdAt, renderInline: true, sensitive: false, sha256: sha })));
const bundles = runs.map((run, i) => ({ id: `bundle-${i}`, runId: run.id, campaignKey: run.campaignKey, title: ['Authentication monitoring · staging', 'Security verification · long campaign name', 'Historical Supabase evidence', 'Empty evidence bundle', 'Expired evidence bundle'][i], bundleType: i === 1 ? 'security' : 'playwright', createdAt: run.createdAt, indexedAt: run.completedAt, environment: 'staging', product: 'INSSA', status: i === 4 ? 'expired' : 'indexed', itemCount: i < 3 ? 6 : 0, totalBytes: i < 3 ? 654321 : 0, checksumManifest: { report: sha }, storageBackend: i === 2 ? 'supabase-storage' : 'spaces', storagePrefix: `${longPath}${run.id}`, uploadStatus: 'uploaded', uploadedAt: run.completedAt, retentionClass: 'default', sensitive: false, sourceArtifactId: i < 3 ? `artifact-${i}-0` : null }));
const items = bundles.slice(0,3).flatMap((bundle,i) => [...kinds, 'Protected Screenshot', 'Download archive'].map((itemType,j) => ({ id: `item-${i}-${j}`, bundleId: bundle.id, runId: bundle.runId, campaignKey: bundle.campaignKey, artifactId: j < 4 ? `artifact-${i}-${j}` : j === 5 ? `archive-${i}` : '', itemType, fileName: j === 0 ? 'index.html' : `evidence-${j}`, relativePath: j === 0 ? 'playwright-report/index.html' : `${longPath}${i}-${j}`, storageKey: `${longPath}${bundle.runId}/${j}`, contentType: j === 3 ? 'application/json' : j === 4 ? 'image/png' : j === 5 ? 'application/zip' : 'text/html', sha256: sha, sizeBytes: 12345, createdAt: bundle.createdAt, renderInline: j !== 4, sensitive: j === 4, storageBackend: bundle.storageBackend, uploadStatus: 'uploaded', metadata: {} })));
const metadataBackend = { backend: 'local-json', backendLabel: 'Fixture', counts: { runs: runs.length, logs: 0, artifacts: artifacts.length }, error: null, storePath: null };
const props = { currentUser: { id: 'fixture', email: 'admin@example.test', role: 'admin' }, initialCampaignDefinitions: campaigns, initialMetadataBackend: metadataBackend, initialRuns: runs };
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {InssaOpsClient} from './inssa-ops-client';const props=${JSON.stringify(props)};props.currentUser.role=new URL(location.href).searchParams.get('role')||'admin';createRoot(document.getElementById('root')).render(React.createElement(InssaOpsClient,props));`, resolveDir: path.join(dashboard,'components'), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const css = (await postcss([tailwind({base:dashboard})]).process(await fs.readFile(path.join(dashboard,'app/globals.css'),'utf8'),{from:path.join(dashboard,'app/globals.css')})).css;
const launches = [];
const server = createServer(async(req,res) => {
 const url = new URL(req.url,'http://fixture');
 const scenario = new URL(req.headers.referer || 'http://fixture').searchParams.get('scenario');
 if(url.pathname === '/') { res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');return; }
 if(url.pathname === '/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname === '/style.css'){res.setHeader('content-type','text/css');res.end(css);return;}
 if(url.pathname.startsWith('/api/artifacts/')) {
  if(url.pathname.includes('archive-')) {res.setHeader('content-type','application/zip');res.setHeader('content-disposition','attachment; filename="evidence.zip"');res.end('fixture archive bytes');return;}
  if(/artifact-\d-3/.test(url.pathname)){res.setHeader('content-type','application/json');res.setHeader('content-disposition','attachment; filename="siem.json"');res.end(JSON.stringify({event:'fixture evidence',inert:'<script>window.executed=true</script>'}));return;}
  res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html><body style="font:16px system-ui;padding:20px"><h1>Evidence report fixture</h1><p>3 passed · 0 failed · 0 flaky</p></body></html>');return;
 }
 let body = {};
 if(url.pathname === '/api/runs') {
  if(req.method === 'POST') {const chunks=[];for await(const c of req)chunks.push(c);launches.push(JSON.parse(Buffer.concat(chunks).toString()));body={run:runs[0]};} else body={runs,metadataBackend};
 } else if(url.pathname.startsWith('/api/runs/')) { const runId=url.pathname.split('/')[3],kind=url.pathname.split('/')[4];body=kind==='artifacts'?{artifacts:scenario==='empty-reports'?[]:artifacts.filter(a=>a.runId===runId)}:kind==='evidence'?{bundles:bundles.filter(b=>b.runId===runId).map(b=>scenario==='upload-error'?{...b,uploadStatus:'failed',uploadError:'Upload failed: '+longPath}:b),items:items.filter(i=>i.runId===runId)}:kind==='logs'?{logs:[]}:{run:runs.find(r=>r.id===runId)}; }
 else if(url.pathname === '/api/campaign-definitions')body={campaignDefinitions:campaigns};
 else if(url.pathname === '/api/cleanup-ledger')body={records:[],readiness:[],manualCleanupMode:true};
 res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')) {console.log(origin);await new Promise(()=>{});}
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
const click=name=>page.getByRole('button',{name,exact:true}).click();
const heading=name=>page.getByRole('heading',{name,exact:true});
async function reports(){await click('Reports');await heading('Evidence Explorer').waitFor();await page.locator('.evidence-bundle-card').first().waitFor();}
async function select(title){await page.locator('.evidence-bundle-card').filter({hasText:title}).click();await page.locator('.evidence-hero h2').filter({hasText:title}).waitFor();}
const disclosureNames=['Bundle Details','Selected Item Integrity','Related Evidence','Report Archive','Report Tools'];
const disclosure=name=>page.locator('.evidence-disclosure').filter({has:page.locator('summary').getByText(name,{exact:true})});
async function expand(name){const panel=disclosure(name);if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();}
async function collapseAll(){for(const name of disclosureNames){const panel=disclosure(name);if(await panel.evaluate(el=>el.open))await panel.locator('summary').click();}}
async function shellMetrics(){return page.evaluate(()=>Object.fromEntries(['.workspace-sidebar','.workspace-titlebar','.workspace-content','.ops-topbar','.ops-footer','.side-link','.side-label'].map(selector=>{const el=document.querySelector(selector),s=getComputedStyle(el);return [selector,Object.fromEntries(['width','padding','fontSize','position','top','borderRadius','gap'].map(k=>[k,s[k]]))]})));}
async function capture(theme,width,label){
 await click(theme==='dark'?'🌙 Dark':'☀️ Light');await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForFunction(()=>scrollY===0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:path.join(output,`${label}-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
 await page.screenshot({path:path.join(output,`${label}-${theme}-${width}-viewport.png`),animations:'disabled'});
}
try {
 await page.goto(origin);await reports();
 if(baseline){await click('Authentication Monitoring');for(const [theme,width] of [['dark',1440],['light',1440],['dark',1024],['dark',390]])await capture(theme,width,'reference-authentication');await reports();for(const [theme,width] of [['dark',1440],['light',1440],['dark',1024],['dark',390]])await capture(theme,width,'before');console.log('PASS: four matching visual baselines saved');}
 else {
  // Presentation and interaction assertions are intentionally against the complete client.
  for(const name of ['Evidence Explorer','Evidence Items','Evidence Preview'])await heading(name).waitFor();
  assert.equal(await page.locator('.evidence-disclosure').count(),5);assert.equal(await page.locator('.evidence-disclosure[open]').count(),0);
  for(const name of disclosureNames){await disclosure(name).locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await disclosure(name).evaluate(el=>el.open),true);await page.keyboard.press('Space');assert.equal(await disclosure(name).evaluate(el=>el.open),false);}
  for(const label of ['Campaign','Run','Evidence Count','Bundle Size','Storage Backend','Upload Status','Retention','Integrity'])assert.match(await page.locator('.evidence-hero').innerText(),new RegExp(label));
  await page.getByLabel('Search',{exact:true}).fill('Historical Supabase');assert.equal(await page.locator('.evidence-bundle-card').count(),1);await select('Historical Supabase');
  await page.getByLabel('Search',{exact:true}).fill('');await page.getByLabel('Bundle Type',{exact:true}).selectOption('security');assert.equal(await page.locator('.evidence-bundle-card').count(),1);await select('Security verification');
  await page.getByLabel('Bundle Type',{exact:true}).selectOption('all');
  for(const sort of ['campaign','run','date']){await page.getByLabel('Sort',{exact:true}).selectOption(sort);const expected=[...bundles].sort((a,b)=>sort==='date'?b.createdAt.localeCompare(a.createdAt):`${sort==='run'?a.runId:a.campaignKey}:${b.createdAt}`.localeCompare(`${sort==='run'?b.runId:b.campaignKey}:${a.createdAt}`));assert.match(await page.locator('.evidence-bundle-card').first().innerText(),new RegExp(expected[0].title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}
  await select('Authentication monitoring');
  await page.frameLocator('.evidence-preview-pane iframe').getByRole('heading',{name:'Evidence report fixture'}).waitFor();
  const open=page.waitForEvent('popup');await page.getByRole('link',{name:'Open in New Tab'}).click();const popup=await open;await popup.waitForLoadState();assert.match(await popup.locator('body').innerText(),/Evidence report fixture/);await popup.close();
  await page.getByRole('button',{name:'Select SIEM Export',exact:true}).click();await page.getByRole('region',{name:'JSON evidence preview'}).locator('pre').waitFor();assert.match(await page.locator('pre').innerText(),/fixture evidence/);assert.equal(await page.locator('pre script').count(),0);
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download Evidence',exact:true}).click();assert.equal((await download).suggestedFilename(),'siem.json');
  await page.getByRole('button',{name:'Select Protected Screenshot',exact:true}).click();await page.getByText(/not previewable through current serving rules/).waitFor();assert.equal(await page.locator('.evidence-item-card').filter({hasText:'Protected Screenshot'}).getByRole('link').count(),0);
  await page.getByRole('button',{name:'Select Download archive',exact:true}).click();const zip=page.waitForEvent('download');await page.getByRole('link',{name:'Download Evidence',exact:true}).click();assert.equal((await zip).suggestedFilename(),'evidence.zip');
  await expand('Related Evidence');const related=disclosure('Related Evidence');await expand('Report Archive');assert.equal(await related.getByRole('link').count(),4);
  for(const category of ['Playwright','Security','Lifecycle','SIEM']){await click(`${category} (3)`);assert.equal(await page.locator('.evidence-report-list button').count(),3);assert.ok(await page.getByRole('link',{name:'Open Report'}).getAttribute('href'));}
  await click('Playwright (3)');const archiveOpen=page.waitForEvent('popup');await page.getByRole('link',{name:'Open Report'}).click();const archivePopup=await archiveOpen;await archivePopup.waitForLoadState();assert.match(await archivePopup.locator('body').innerText(),/Evidence report fixture/);await archivePopup.close();
  // Execute only against the fixture; no real report job or product mutation is created.
  for(const campaign of campaigns){await expand('Report Tools');await page.locator('.evidence-report-tool').filter({hasText:campaign.displayName}).getByRole('button').click();await heading('Execution Workspace').waitFor();assert.equal(launches.at(-1).campaignKey,campaign.key);await reports();}
  assert.equal(launches.length,2);
  await select('Empty evidence bundle');await page.getByText('This bundle has no item metadata.',{exact:true}).waitFor();await expand('Selected Item Integrity');await page.getByText('Select an evidence item to inspect integrity details.').waitFor();
  await select('Expired evidence bundle');await page.getByRole('region',{name:'Expired evidence'}).waitFor();assert.equal(await page.locator('.evidence-detail-pane a').count(),0);
  await page.goto(origin);await reports();await select('Authentication monitoring');await page.getByRole('button',{name:'Select Playwright Report',exact:true}).click();
  const layouts=[];
  for(const theme of ['dark','light'])for(const width of [320,375,390,430,768,1024,1280,1440,1600,1920]){
   await collapseAll();await capture(theme,width,'after');
   const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,center:document.querySelector('.evidence-inspection').getBoundingClientRect().width,explorer:document.querySelector('.evidence-explorer-pane').getBoundingClientRect().width,details:document.querySelector('.evidence-disclosures').getBoundingClientRect().width,itemsHeight:document.querySelector('.evidence-item-list').clientHeight,itemsScroll:document.querySelector('.evidence-item-list').scrollHeight,stripWidth:document.querySelector('.evidence-explorer-list').clientWidth,stripScroll:document.querySelector('.evidence-explorer-list').scrollWidth,metadataColumns:getComputedStyle(document.querySelector('.evidence-summary-grid')).gridTemplateColumns.split(' ').length}));
   assert.ok(dimensions.scroll<=width,`${theme} ${width}: horizontal document overflow`);
   assert.equal(dimensions.center,dimensions.explorer,'Explorer must span content width');assert.equal(dimensions.center,dimensions.details,'details must span content width');
   assert.ok(dimensions.itemsHeight<=400&&dimensions.itemsScroll>dimensions.itemsHeight,'Evidence items use bounded scrolling');assert.ok(dimensions.stripScroll>dimensions.stripWidth,'bundle strip scrolls horizontally');
   assert.equal(dimensions.metadataColumns,width<640?1:width<1280?2:4);
   const reportsShell=await shellMetrics();await click('Authentication Monitoring');const referenceShell=await shellMetrics();assert.deepEqual(reportsShell,referenceShell,`${width}: Reports must inherit the shared shell`);await reports();
   if(width>=1024){assert.equal(reportsShell['.workspace-sidebar'].position,'sticky');assert.equal(reportsShell['.workspace-sidebar'].width,'240px');}
   await expand('Report Archive');await expand('Report Tools');
   for(const control of [page.getByLabel('Search',{exact:true}),page.getByRole('link',{name:'Open Report'}),page.locator('.evidence-report-tool button').last()]){await control.scrollIntoViewIfNeeded();assert.ok(await control.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${theme} ${width}: control overlapped`);}
   layouts.push({theme,...dimensions});
  }
  await page.setViewportSize({width:1440,height:1000});await page.getByLabel('Search',{exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByLabel('Sort',{exact:true}).evaluate(el=>el===document.activeElement),true);assert.notEqual(await page.getByLabel('Sort',{exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await page.locator('.evidence-bundle-card').nth(1).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.evidence-bundle-card').nth(1).getAttribute('aria-pressed'),'true');
  for(const name of disclosureNames)await expand(name);
  for(const theme of ['dark','light'])for(const width of [1440,390]){await capture(theme,width,'expanded');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.getByLabel('Search',{exact:true}).fill('no matching bundle');await page.getByText('No Evidence Bundle Selected',{exact:true}).waitFor();assert.equal(await page.locator('.evidence-bundle-card').count(),0);
  await page.goto(origin+'/?scenario=empty-reports');await reports();await expand('Report Archive');await expand('Related Evidence');await page.getByText('No security reports indexed.',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Open Report'}).count(),0);await page.getByText('No report artifacts are linked to this bundle yet.').waitFor();
  await page.goto(origin+'/?scenario=upload-error');await reports();await page.getByRole('alert').getByText('Upload failed: '+longPath,{exact:true}).waitFor();await page.setViewportSize({width:320,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long upload error does not overflow');
  await page.goto(origin+'/?role=viewer');await reports();await expand('Report Tools');assert.equal(await page.getByRole('button',{name:'Viewer role cannot run'}).count(),2);for(const button of await page.getByRole('button',{name:'Viewer role cannot run'}).all())assert.equal(await button.isDisabled(),true);assert.equal(launches.length,2);
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'responsive-results.json'),JSON.stringify(layouts,null,2));
  console.log('PASS: feature preservation, permissions, HTML/JSON/download, report actions, empty/expired states, keyboard focus, both themes and 20 responsive layouts');
 }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
