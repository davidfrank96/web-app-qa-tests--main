import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
// This test creates schema/roles only in an explicitly selected, disposable loopback database.
const url = new URL(process.env.EVIDENCE_TEST_DATABASE_URL || '');
if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/qa_evidence_test')) {
  throw new Error('Evidence SQL tests require a disposable localhost qa_evidence_test database.');
}
const dir = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(dir).filter((name) => /platform_core_persistence|execution_foundation|atomic_evidence_publication/.test(name)).sort();
let sql = `do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;\n`;
for (const migration of migrations) sql += readFileSync(new URL(migration, dir), 'utf8') + '\n';
sql += readFileSync(new URL('../tests/sql/evidence-publication.sql', import.meta.url), 'utf8');
const result = spawnSync('psql', [url.href, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
