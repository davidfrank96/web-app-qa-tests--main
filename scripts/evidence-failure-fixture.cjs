// Controlled failure for the QA platform's evidence pipeline; no product/network activity.
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.INSSA_RUN_OUTPUT_DIR;
if (!output || !/^run-output\/[a-f0-9-]{36}$/.test(path.relative(fs.realpathSync(process.cwd()), fs.realpathSync(output)).split(path.sep).join('/'))) {
  throw new Error('This fixture requires an owned QA worker output directory.');
}
const result = {
  fixture: 'stabilization-wave-1-evidence', expectedExitCode: 1, productRequests: 0,
  runId: path.basename(output), timestamp: new Date().toISOString()
};
fs.writeFileSync(path.join(output,'controlled-failure.json'), JSON.stringify(result,null,2));
const reportDir = path.join(output, 'reports/lifecycle');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'controlled-failure.html'),
  `<!doctype html><html><head><title>Controlled evidence failure fixture</title></head><body><h1>Expected QA fixture failure</h1><p>No product requests were made.</p><pre>${JSON.stringify(result,null,2)}</pre></body></html>`);
console.log('Controlled QA evidence failure: expected exit 1; no product request was made.');
process.exitCode = 1;
