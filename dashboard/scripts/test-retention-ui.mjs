// Real application components against loopback fixtures; no product or cloud requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(path.join(dashboard, 'package.json'))('esbuild');
const expiredRun = { id: 'expired-run', campaignKey: 'test_inssa_safe', status: 'passed', createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-09-15T00:00:00Z', completedAt: '2026-08-10T10:01:00Z', startedAt: '2026-08-10T10:00:00Z', durationMs: 60000, exitCode: 0, requestedBy: 'fixture' };
const expiredBundle = { id: 'expired-bundle', runId: expiredRun.id, campaignKey: expiredRun.campaignKey, title: 'Retained run history', bundleType: 'playwright', createdAt: expiredRun.createdAt, indexedAt: expiredRun.completedAt, environment: 'staging', status: 'expired', itemCount: 0, totalBytes: 0, checksumManifest: {}, storageBackend: 'supabase-storage', uploadStatus: 'uploaded', uploadedAt: expiredRun.completedAt, retentionClass: 'short-lived', retentionTombstone: { policyVersion: 'evidence-retention-v2', originalObjectCount: 82, originalByteCount: 15000000, deletedAt: expiredRun.updatedAt, verificationStatus: 'ABSENCE_VERIFIED' } };
// The real initial cleanup expires runs older than the default 40-run report archive.
const fixtureRuns = [...Array.from({ length: 40 }, (_, i) => ({ ...expiredRun, id: `recent-${i}`, createdAt: '2026-09-14T10:00:00Z' })), expiredRun];
const backend = { backend: 'local-json', backendLabel: 'Fixture', counts: { runs: 0, logs: 0, artifacts: 0 }, error: null, storePath: null };
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {InssaOpsClient} from './inssa-ops-client';
  createRoot(document.getElementById('root')).render(React.createElement(InssaOpsClient, {currentUser:{id:'fixture',email:'fixture@example.test',role:new URLSearchParams(location.search).get('role')},initialCampaignDefinitions:[],initialMetadataBackend:${JSON.stringify(backend)},initialRuns:${JSON.stringify(fixtureRuns)}}));`,
  resolveDir: path.join(dashboard, 'components'), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
let retentionReads = 0, executions = 0, fail = false;
const summary = { bundlesScanned: 111, eligibleBundles: 14, protectedBundles: 85, reviewRequiredBundles: 12,
  eligibleBytes: 129631709, protectedBytes: 900000000, protectedWarningEvidence: 40, protectedWarningBytes: 100000000, protectedFailureOrSecurityBytes: 80000000, totalEvidenceStorageBytes: 1209480568, storageSizeComplete: true, protectedByHolds: 0,
  activeHolds: 0, protectedFailureOrSecurity: 13, oldestEligibleBundle: { bundleId: 'oldest', createdAt: '2026-08-10T17:59:53.622Z' }, unreferencedObjects: 4 };
const server = createServer((req, res) => {
  if (req.url.startsWith('/?') || req.url === '/') { res.setHeader('content-type','text/html'); res.end('<div id="root"></div><script src="/bundle.js"></script>'); return; }
  if (req.url === '/bundle.js') { res.setHeader('content-type','text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  let body = {};
  if (req.url === '/api/retention') { assert.equal(req.method, 'GET'); retentionReads++; res.statusCode = fail ? 503 : 200;
    body = fail ? { error: 'Fixture failure' } : { mode: 'DRY RUN ONLY', policyVersion: 'evidence-retention-v3', executionPreview: { token: 'signed-fixture-token', bundles: 14, objects: 100, bytes: 129631709 }, maintenance: { status: 'HEALTHY', enabled: true, nextScheduledAt: '2026-10-01T00:30:00Z', totalReclaimed: 15000000, lastExecution: { status: 'HEALTHY', started_at: expiredRun.updatedAt, bytes_reclaimed: 15000000 } }, asOf: '2026-09-14T22:00:00Z', reviewReasons: [], summary, bundles: [] }; }
  else if (req.url === '/api/retention/execute') { assert.equal(req.method, 'POST'); let raw = ''; req.on('data', data => raw += data); req.on('end', () => { const request = JSON.parse(raw); assert.equal(request.confirmation, 'DELETE ELIGIBLE EVIDENCE'); assert.equal(request.token, 'signed-fixture-token'); executions++; res.setHeader('content-type','application/json'); res.end(JSON.stringify({ status: 'HEALTHY' })); }); return; }
  else if (req.url === '/api/runs') body = { runs: fixtureRuns, metadataBackend: backend };
  else if (req.url.startsWith('/api/runs/expired-run')) body = req.url.includes('/evidence') ? { bundles: [expiredBundle], items: [] } : req.url.includes('/artifacts') ? { artifacts: [] } : req.url.includes('/logs') ? { logs: [] } : { run: expiredRun };
  else if (req.url.startsWith('/api/runs/recent-')) body = req.url.includes('/evidence') ? { bundles: [], items: [] } : req.url.includes('/artifacts') ? { artifacts: [] } : req.url.includes('/logs') ? { logs: [] } : { run: fixtureRuns.find(r => req.url === `/api/runs/${r.id}`) };
  else if (req.url === '/api/campaign-definitions') body = { campaignDefinitions: [] };
  else if (req.url === '/api/cleanup-ledger') body = { records: [], readiness: [] };
  else if (req.url === '/api/lifecycle-artifacts') body = { artifacts: [] };
  res.setHeader('content-type','application/json'); res.end(JSON.stringify(body));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.clock.install();
  for (const role of ['viewer','operator']) {
    await page.goto(`${origin}/?role=${role}`); await page.getByRole('button',{name:'Operations',exact:true}).click();
    assert.equal(await page.getByRole('region',{name:'Evidence retention'}).count(), 0); assert.equal(retentionReads, 0);
  }
  await page.goto(`${origin}/?role=admin`); await page.getByRole('button',{name:'Operations',exact:true}).click();
  const section = page.getByRole('region',{name:'Evidence retention'}); await section.waitFor();
  await page.clock.runFor(60100); assert.equal(retentionReads,0,'no automatic retention polling');
  await section.getByRole('button',{name:'Dry Run',exact:true}).click(); await section.getByText('14 bundles / 129.6 MB',{exact:true}).waitFor();
  assert.equal(retentionReads,1); assert.equal(await section.getByRole('button').count(),2);
  await page.clock.runFor(60100); assert.equal(retentionReads,1,'completed plan does not poll');
  fail = true; await section.getByRole('button',{name:'Refresh',exact:true}).click(); await section.getByRole('alert').waitFor();
  assert.equal(await section.getByText('14 bundles / 129.6 MB',{exact:true}).count(),0,'failed refresh clears old eligibility');
  fail = false; await section.getByRole('button',{name:'Dry Run',exact:true}).click(); await section.getByText('14 bundles / 129.6 MB',{exact:true}).waitFor();
  assert.equal(retentionReads,3);
  await section.getByText('HEALTHY · Monthly cleanup enabled', { exact: true }).waitFor();
  await section.getByRole('button', { name: 'Execute Eligible…', exact: true }).click();
  const confirm = section.getByRole('region', { name: 'Confirm permanent evidence deletion' });
  assert.equal(await confirm.getByRole('button', { name: 'Confirm deletion' }).isDisabled(), true); assert.equal(executions, 0);
  await confirm.getByRole('textbox').fill('DELETE ELIGIBLE EVIDENCE');
  await confirm.getByRole('button', { name: 'Confirm deletion' }).click();
  await section.getByRole('status').waitFor(); assert.equal(executions, 1);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.getByRole('button', { name: /expired-run/ }).click();
  const runExpiry = page.getByRole('region', { name: 'Expired run evidence' });
  await runExpiry.getByRole('heading', { name: 'Evidence expired under retention policy' }).waitFor();
  assert.equal(await page.locator('.run-artifact-sidebar a').count(), 0);
  const refreshedHistoricalEvidence = page.waitForResponse(response => response.url().endsWith('/api/runs/expired-run/evidence'));
  await runExpiry.getByRole('button', { name: 'View retention details' }).click();
  await refreshedHistoricalEvidence;
  const expired = page.getByRole('region', { name: 'Expired evidence' });
  await expired.getByRole('heading', { name: 'Evidence expired under retention policy' }).waitFor();
  assert.equal(await page.locator('.evidence-detail-pane a').count(), 0, 'expired history offers no dead download links');
  await expired.getByText('ABSENCE_VERIFIED', { exact: true }).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: real Operations admin visibility, explicit GET only, no polling, summary, verified expired history beyond 40 runs without dead links, historical navigation, maintenance health, monthly schedule and deliberate admin confirmation, stale-plan clearing and retry');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
