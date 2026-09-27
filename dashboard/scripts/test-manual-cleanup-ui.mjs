// Real application UI against loopback fixtures; no INSSA or cloud requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(path.join(dashboard, 'package.json'))('esbuild');
const campaign = { key: 'test_inssa_campaign_text', displayName: 'Text Lifecycle', npmScript: 'test:inssa:campaign:text', commandType: 'campaign', mutatesStaging: true, adminOnly: true, approvalRequired: true, cleanupRequired: true, operatorDescription: 'Governed staging lifecycle', phase1Enabled: true, producesReports: true, producesFindings: false, riskLevel: 'live_mutation', timeoutMs: 600000, targetEnvironment: 'staging' };
const metadataBackend = { backend: 'local-json', backendLabel: 'Fixture', counts: { runs: 0, logs: 0, artifacts: 0 }, error: null, storePath: null };
const record = { id: 'ledger-1', objectId: 'capsule-1', objectPath: 'timeCapsules/capsule-1', originatingRunId: 'historical-run', campaignKey: campaign.key, createdAt: '2025-01-01T00:00:00Z', retentionUntil: '2025-04-01T00:00:00Z', status: 'cleanup_unavailable', ownerAccount: 'qa@example.test', notes: 'Manual removal needed', evidencePaths: [], safelyAccounted: true };
const checks = [{ id: 'staging-target', detail: 'Target locked to staging.inssa.us', passed: true }, { id: 'cleanup-threshold', detail: '120 unresolved objects remain advisory', passed: true, advisory: true }];
const readiness = { campaignKey: campaign.key, status: 'READY_WITH_MANUAL_CLEANUP', manualCleanupMode: true, executionAllowed: true, unresolvedCount: 120, createdObjectPaths: [record.objectPath], cleanupStatus: record.status, lastResult: 'passed_with_warnings', oldestUnresolvedAt: record.createdAt, retentionDeadline: record.retentionUntil, safelyAccounted: true, advisories: checks.filter(x => x.advisory) };
const props = { currentUser: { id: 'fixture', email: 'admin@example.test', role: 'admin' }, initialCampaignDefinitions: [campaign], initialMetadataBackend: metadataBackend, initialRuns: [] };
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {InssaOpsClient} from './inssa-ops-client'; createRoot(document.getElementById('root')).render(React.createElement(InssaOpsClient, ${JSON.stringify(props)}));`, resolveDir: path.join(dashboard, 'components'), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
let preflights = 0, launches = 0, confirmations = 0, blocked = false;
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<div id="root"></div><script src="/bundle.js"></script>'); return; }
  if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  let body = {};
  if (req.url === '/api/runs') { if (req.method === 'POST') launches++; body = { runs: [], metadataBackend }; }
  if (req.url === '/api/campaign-definitions') body = { campaignDefinitions: [campaign] };
  if (req.url === '/api/cleanup-ledger') { if (req.method === 'POST') confirmations++; body = { records: [record], readiness: [readiness] }; }
  if (req.url === '/api/lifecycle-artifacts') body = { artifacts: [] };
  if (req.url === '/api/campaign-approvals') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (input.action === 'preflight') { preflights++; body = blocked ? { error: 'Execution worker unhealthy', checks: [{ id: 'worker-health', detail: 'Worker unavailable', passed: false }] } : { ok: true, checks }; if (blocked) res.statusCode = 503; }
  }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(); const page = await browser.newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
try {
  await page.goto(origin); await page.getByRole('button', { name: 'Lifecycle', exact: true }).click();
  await page.getByText('MANUAL CLEANUP MODE', { exact: true }).waitFor();
  await page.getByText('HIGH MANUAL CLEANUP BACKLOG', { exact: true }).waitFor();
  await page.getByText('Cleanup ledger · 1 object(s)', { exact: true }).click();
  await page.getByRole('cell', { name: 'timeCapsules/capsule-1', exact: true }).waitFor();
  page.once('dialog', d => d.dismiss());
  await page.getByRole('button', { name: 'Confirm deleted object', exact: true }).click();
  assert.equal(confirmations, 0, 'cancelling confirmation never changes ledger');
  await page.getByRole('button', { name: 'Review and Run', exact: true }).click();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByLabel('Type RUN STAGING MUTATION', { exact: true }).fill('RUN STAGING MUTATION');
  await page.getByRole('button', { name: 'Run Preflight Only', exact: true }).click();
  await page.getByText('Execution allowed · preflight only does not create a run.', { exact: true }).waitFor();
  await page.getByText('MANUAL CLEANUP ADVISORY: 120 unresolved objects remain advisory', { exact: true }).waitFor();
  assert.equal(preflights, 1); assert.equal(launches, 0); assert.equal(confirmations, 0);
  blocked = true; await page.getByRole('button', { name: 'Run Preflight Only', exact: true }).click();
  await page.getByText('BLOCKING PREFLIGHT: Worker unavailable', { exact: true }).waitFor();
  assert.equal(await page.getByText('Execution allowed · preflight only does not create a run.', { exact: true }).count(), 0);
  assert.equal(launches, 0); assert.deepEqual(errors, []);
  console.log('PASS: manual mode, backlog/ledger visibility, cancelled deletion confirmation, advisory versus blocking preflight, zero live runs');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
