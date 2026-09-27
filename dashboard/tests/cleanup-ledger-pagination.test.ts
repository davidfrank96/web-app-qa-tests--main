import assert from 'node:assert/strict';
import test from 'node:test';
import { getInssaRunStore } from '../lib/inssa-ops/run-store';
test('ledger reads preserve 1201 records across REST pages without writes', async (t) => {
  const previous = { ...process.env }, fetcher = globalThis.fetch;
  t.after(() => { process.env = previous; globalThis.fetch = fetcher; });
  Object.assign(process.env, { INSSA_OPS_METADATA_STORE: 'supabase', SUPABASE_URL: 'https://ledger-fixture.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only-role' });
  const offsets: number[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(init?.method ?? 'GET', 'GET');
    assert.equal(url.pathname, '/rest/v1/cleanup_ledger'); assert.equal(url.searchParams.get('order'), 'id.asc');
    const offset = Number(url.searchParams.get('offset')); offsets.push(offset);
    return Response.json(Array.from({ length: Math.min(500, 1201 - offset) }, (_, i) => ({ id: `record-${offset+i}`, object_id: `object-${offset+i}`, object_type: 'time_capsule', status: 'cleanup_unavailable', originating_run_id: 'run', created_at: '2025-01-01T00:00:00Z' })));
  };
  const records = await getInssaRunStore().listCleanupLedger();
  assert.equal(records.length, 1201); assert.equal(new Set(records.map(r => r.id)).size, 1201);
  assert.deepEqual(offsets, [0, 500, 1000]);
});
