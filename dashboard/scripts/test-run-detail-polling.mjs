// Exercises the real client component with isolated HTTP fixtures, never a product backend.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(path.join(dashboard, 'package.json'))('esbuild');
const sourceRef = process.argv.find(x => x.startsWith('--source-ref='))?.split('=')[1];
const measure = process.argv.includes('--measure');
const makeRun = id => ({ id, campaignKey: 'test_inssa_safe', status: 'passed', createdAt: '2026-09-14T10:00:00Z', updatedAt: '2026-09-14T10:01:00Z', completedAt: '2026-09-14T10:01:00Z', startedAt: '2026-09-14T10:00:00Z', durationMs: 60000, exitCode: 0, requestedBy: 'fixture' });
let runs = [makeRun('run-a'), makeRun('run-b')];
const metadataBackend = { backend: 'local-json', backendLabel: 'Fixture', counts: { runs: 2, logs: 2, artifacts: 0 }, error: null, storePath: null };
const props = { currentUser: { id: 'fixture', email: 'viewer@example.test', role: 'viewer' }, initialCampaignDefinitions: [], initialMetadataBackend: metadataBackend, initialRuns: runs };
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {InssaOpsClient} from './inssa-ops-client'; createRoot(document.getElementById('root')).render(React.createElement(InssaOpsClient, ${JSON.stringify(props)}));`, resolveDir: path.join(dashboard, 'components'), loader: 'tsx' },
  write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: sourceRef ? [{ name: 'baseline', setup(b) { b.onLoad({ filter: /inssa-ops-client\.tsx$/ }, () => ({ contents: execFileSync('git', ['show', `${sourceRef}:dashboard/components/inssa-ops-client.tsx`], { cwd: dashboard, encoding: 'utf8' }), loader: 'tsx', resolveDir: path.join(dashboard, 'components') })); } }] : []
});
let requests = []; let failEvidence = false; let holdA = false; let releaseA;
const server = createServer(async (req, res) => {
  const url = req.url;
  if (url === '/') { res.setHeader('content-type', 'text/html'); res.end('<div id="root"></div><script src="/bundle.js"></script>'); return; }
  if (url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  requests.push(url);
  let body = {};
  if (url === '/api/runs') body = { runs, metadataBackend };
  else if (url === '/api/campaign-definitions') body = { campaignDefinitions: [] };
  else if (url === '/api/lifecycle-artifacts') body = { artifacts: [] };
  else if (url === '/api/cleanup-ledger') body = { records: [], readiness: [] };
  else if (url.startsWith('/api/runs/')) {
    const [, , , id, kind] = url.split('/');
    const run = structuredClone(runs.find(x => x.id === id));
    if (id === 'run-a' && !kind && holdA) await new Promise(resolve => { releaseA = resolve; });
    if (kind === 'evidence' && failEvidence) { res.statusCode = 503; body = { error: 'Fixture evidence unavailable' }; }
    else body = kind === 'logs' ? { logs: [{ id: `log-${id}`, message: `Evidence log for ${id}`, sequence: 1, stream: 'stdout', createdAt: run.createdAt }] }
      : kind === 'artifacts' ? { artifacts: [] } : kind === 'evidence' ? { bundles: [], items: [] } : { run };
  }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
const detailCount = () => requests.filter(x => x.startsWith('/api/runs/')).length;
const log = id => page.locator('.run-detail-pane').getByText(`Evidence log for ${id}`, { exact: true });
const waitFor = async fn => { const until = Date.now() + 5000; while (!fn()) { assert.ok(Date.now() < until, 'Condition timed out'); await delay(20); } };
const select = async id => { await page.locator('.run-history-list').getByRole('button', { name: new RegExp(id) }).click(); await log(id).waitFor(); };
try {
  if (!measure) await page.clock.install();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await log('run-a').waitFor();
  requests = [];
  const started = Date.now();
  if (measure) await delay(60_100);
  else { await page.clock.runFor(60_100); await delay(100); }
  const observation = { source: sourceRef ?? 'working-tree', method: measure ? 'real Chromium, 60.1 seconds wall clock' : 'real Chromium, 60.1 seconds controlled clock', elapsedMs: Date.now() - started, detailRequests: detailCount(), listRequests: requests.filter(x => x === '/api/runs').length };
  console.log(JSON.stringify(observation));
  assert.equal(observation.detailRequests, sourceRef ? 16 : 0);
  assert.equal(observation.listRequests, 4);
  if (sourceRef || measure) { assert.deepEqual(errors, []); }
  else {
    await select('run-b'); assert.equal(detailCount(), 4);
    await select('run-a'); assert.equal(detailCount(), 4, 'terminal revisit uses cached payload');
    await page.getByRole('button', { name: 'Refresh run details', exact: true }).click();
    await waitFor(() => detailCount() === 8); await log('run-a').waitFor();
    // Same terminal status, newer durable version must reload all details.
    runs[0].updatedAt = '2026-09-14T10:02:00Z';
    await page.clock.runFor(15_100); await waitFor(() => detailCount() === 12);
    await log('run-a').waitFor();
    // Active selection retains the original 3-second polling cadence.
    runs[0] = { ...runs[0], status: 'running', completedAt: null };
    await page.clock.runFor(15_100); await delay(100);
    const activeStart = detailCount();
    await page.clock.runFor(3_100); await delay(100);
    await page.clock.runFor(3_100); await delay(100);
    assert.ok(detailCount() >= activeStart + 8, 'active run keeps polling');
    runs[0] = { ...makeRun('run-a'), updatedAt: '2026-09-14T10:03:00Z' };
    await page.clock.runFor(3_100); await delay(100); await log('run-a').waitFor();
    const terminalStart = detailCount();
    await page.clock.runFor(30_100); await delay(100);
    assert.equal(detailCount(), terminalStart, 'terminal transition stops detail polling');
    // A delayed response from the previous selection cannot overwrite the next selection.
    holdA = true;
    await page.getByRole('button', { name: 'Refresh run details', exact: true }).click();
    await waitFor(() => Boolean(releaseA));
    await select('run-b'); releaseA(); holdA = false; await delay(100);
    assert.equal(await log('run-a').count(), 0); await log('run-b').waitFor();
    // A failed evidence fetch is visible, not retained as successful terminal data.
    failEvidence = true; await select('run-a');
    await page.getByRole('button', { name: 'Refresh run details', exact: true }).click();
    await page.getByText('Fixture evidence unavailable', { exact: true }).first().waitFor();
    failEvidence = false; await select('run-b'); await select('run-a');
    assert.deepEqual(errors, []);
    console.log('PASS: terminal cache, explicit refresh, version invalidation, active polling, terminal transition, selection race, failed evidence retry');
  }
} finally { releaseA?.(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
