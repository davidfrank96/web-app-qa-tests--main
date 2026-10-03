// Real client with delayed loopback responses: no product requests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const dashboard=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {build}=createRequire(path.join(dashboard,'package.json'))('esbuild');
const sourceRef=process.argv[2];
const run=(environment,status)=>({id:environment,campaignKey:'monitor_inssa_auth_'+environment,status,createdAt:'2026-10-03T10:00:00Z',updatedAt:'2026-10-03T10:01:00Z',completedAt:'2026-10-03T10:01:00Z',startedAt:'2026-10-03T10:00:00Z',durationMs:60000,exitCode:status==='failed'?1:0});
const runs=[run('staging','failed'),run('production','passed')];
const metadataBackend={backend:'local-json',backendLabel:'Fixture',counts:{runs:2,logs:0,artifacts:0}};
const props={currentUser:{id:'fixture',email:'viewer@example.test',role:'viewer'},initialCampaignDefinitions:[],initialMetadataBackend:metadataBackend,initialRuns:runs};
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {InssaOpsClient} from './inssa-ops-client';createRoot(document.getElementById('root')).render(React.createElement(InssaOpsClient,${JSON.stringify(props)}));`,resolveDir:path.join(dashboard,'components'),loader:'tsx'},write:false,bundle:true,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:sourceRef?[{name:'baseline',setup(b){b.onLoad({filter:/inssa-ops-client\.tsx$/},()=>({contents:execFileSync('git',['show',sourceRef+':dashboard/components/inssa-ops-client.tsx'],{cwd:dashboard,encoding:'utf8'}),loader:'tsx',resolveDir:path.join(dashboard,'components')}));}}]:[]});
let releaseProduction,releaseLogs;let productionHeld=false;
const summary=env=>({state:'available',source:'evidence_metadata',reason:null,evidence:{bundleId:env,reportArtifactId:env,summaryEvidenceItemId:env,uploadStatus:'uploaded'},result:{runId:env,environment:env,targetHost:env==='staging'?'staging.inssa.us':'inssa.us',overallStatus:env==='staging'?'failed':'passed',durationMs:60000,checks:Object.fromEntries(['username-password','google-oauth','apple-sign-in'].map(method=>[method,{method,status:method==='username-password'?(env==='staging'?'timed_out':'passed'):'disabled',durationMs:10,error:null}]))}});
const server=createServer(async(req,res)=>{const url=req.url;res.setHeader('content-type','application/json');
 if(url==='/'){res.setHeader('content-type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');return;}
 if(url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 let body={};
 if(url==='/api/runs')body={runs,metadataBackend};
 else if(url==='/api/campaign-definitions')body={campaignDefinitions:[]};
 else if(url==='/api/monitoring-definitions')body={definitions:[]};
 else if(url==='/api/scheduler/status')body={definitionStates:[]};
 else if(url==='/api/runs/staging/logs'){await new Promise(resolve=>releaseLogs=resolve);body={logs:[]};}
 else if(url==='/api/runs/staging/authentication-monitoring-result')body=summary('staging');
 else if(url==='/api/runs/production/authentication-monitoring-result'){productionHeld=true;await new Promise(resolve=>releaseProduction=resolve);body=summary('production');}
 res.end(JSON.stringify(body));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();const page=await browser.newPage();
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'Authentication Monitoring',exact:true}).click();
 await page.getByText('staging.inssa.us',{exact:true}).waitFor();
 releaseLogs?.();await page.waitForTimeout(150);
 assert.equal(await page.getByText('Authentication monitor did not complete provider results.',{exact:true}).count(),0,'late diagnostic response must not override available provider results');
 await page.getByRole('combobox',{name:'Environment',exact:true}).selectOption('production');
 await page.waitForTimeout(100);assert.ok(productionHeld);
 assert.equal(await page.getByText('staging.inssa.us',{exact:true}).count(),0,'previous environment must not remain visible while loading');
 assert.equal(await page.getByText('TIMED OUT',{exact:true}).count(),0,'previous method result must not remain visible');
 await page.getByRole('combobox',{name:'Environment',exact:true}).selectOption('staging');
 await page.getByText('staging.inssa.us',{exact:true}).waitFor();releaseProduction();await page.waitForTimeout(100);
 assert.equal(await page.getByText('inssa.us',{exact:true}).count(),0,'late production response must not overwrite staging');
 assert.equal(await page.getByText('TIMED OUT',{exact:true}).count(),1);
 console.log('PASS: environment-bound authentication results and late incomplete-log response cannot display false status');
}finally{releaseLogs?.();releaseProduction?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
