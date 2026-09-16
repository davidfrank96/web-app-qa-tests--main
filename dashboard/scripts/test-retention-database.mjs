import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const url = new URL(process.env.EVIDENCE_TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/qa_evidence_test')) {
  throw new Error('Retention SQL tests require a disposable localhost qa_evidence_test database.');
}
const dir = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(dir).filter((name) => /platform_core_persistence|execution_foundation|admin_live_campaigns|monitoring_framework|deferred_cleanup_ledger_version_fix|evidence_retention_dry_run/.test(name)).sort();
let sql = `begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, created_at timestamptz, updated_at timestamptz);
grant usage on schema storage to service_role;
grant select on storage.objects to service_role;
`;
for (const migration of migrations) sql += readFileSync(new URL(migration, dir), 'utf8') + '\n';
sql += readFileSync(new URL('../tests/sql/retention.sql', import.meta.url), 'utf8') + '\n';
sql += readFileSync(new URL('20260914233531_evidence_cost_control.sql', dir), 'utf8') + '\n';
sql += 'savepoint wave4;\n' + readFileSync(new URL('../tests/sql/retention-execution.sql', import.meta.url), 'utf8') + '\nrollback to savepoint wave4;\n';
sql += readFileSync(new URL('20260916011111_retention_safety_v3.sql', dir), 'utf8') + '\n';
sql += readFileSync(new URL('../tests/sql/retention-v3.sql', import.meta.url), 'utf8') + '\nrollback;';
const result = spawnSync('psql', [url.href, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
