// Controlled failure for the QA platform's evidence pipeline; no product/network activity.
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.INSSA_RUN_OUTPUT_DIR;
if (!output || !/^run-output\/[a-f0-9-]{36}$/.test(path.relative(fs.realpathSync(process.cwd()), fs.realpathSync(output)).split(path.sep).join('/'))) {
  throw new Error('This fixture requires an owned QA worker output directory.');
}
fs.writeFileSync(path.join(output,'controlled-failure.json'), JSON.stringify({
  fixture: 'stabilization-wave-1-evidence', expectedExitCode: 1, productRequests: 0,
  runId: path.basename(output), timestamp: new Date().toISOString()
},null,2));
console.log('Controlled QA evidence failure: expected exit 1; no product request was made.');
process.exitCode = 1;
