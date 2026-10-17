import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isPlaywrightReportArtifact, resolvePlaywrightEvidenceBundlePath, resolvePlaywrightEvidenceBundleFile } from '../lib/inssa-ops/evidence-serving';
import type { InssaArtifactRecord } from '../lib/inssa-ops/types';

test('lifecycle phase reports serve their own trace viewer and data within the existing canonical boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inssa-phase-report-'));
  const previous = process.env.INSSA_QA_REPO_ROOT;
  process.env.INSSA_QA_REPO_ROOT = root;
  const report = { artifactType: 'Playwright Report', sensitive: false, runId: 'fixture-run',
    filePath: 'run-output/fixture-run/playwright-report/create/index.html' } as InssaArtifactRecord;
  try {
    for (const phase of ['', 'create/', 'authenticated-discovery/', 'public-share/']) {
      const artifact = { ...report, filePath: `run-output/fixture-run/playwright-report/${phase}index.html` };
      assert.equal(isPlaywrightReportArtifact(artifact), true);
      for (const relative of ['index.html', 'trace/index.html', 'data/trace.zip']) {
        const result = resolvePlaywrightEvidenceBundlePath(artifact, relative.split('/'));
        const expected = `run-output/fixture-run/playwright-report/${phase}${relative}`;
        assert.equal(result.evidenceItemPath, expected);
        await fs.mkdir(path.dirname(path.join(root, expected)), { recursive: true });
        await fs.writeFile(path.join(root, expected), 'fixture');
        assert.equal((await resolvePlaywrightEvidenceBundleFile(artifact, relative.split('/'))).absolutePath,
          await fs.realpath(path.join(root, expected)));
      }
    }
    for (const filePath of ['run-output/wrong-run/playwright-report/create/index.html',
      'run-output/fixture-run/other/playwright-report/index.html',
      'run-output/fixture-run/playwright-report/create/../index.html',
      'run-output/fixture-run/playwright-report/unknown/index.html']) {
      assert.equal(isPlaywrightReportArtifact({ ...report, filePath }), false);
      assert.throws(() => resolvePlaywrightEvidenceBundlePath({ ...report, filePath }));
    }
    assert.equal(isPlaywrightReportArtifact({ ...report, sensitive: true }), false);
    assert.throws(() => resolvePlaywrightEvidenceBundlePath(report, ['..', 'public-share', 'index.html']));
    await fs.writeFile(path.join(root, 'outside.txt'), 'outside');
    await fs.symlink(path.join(root, 'outside.txt'), path.join(root, 'run-output/fixture-run/playwright-report/create/escape.txt'));
    await assert.rejects(resolvePlaywrightEvidenceBundleFile(report, ['escape.txt']), /canonical allowlist/);
  } finally {
    if (previous === undefined) delete process.env.INSSA_QA_REPO_ROOT; else process.env.INSSA_QA_REPO_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
