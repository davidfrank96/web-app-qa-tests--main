import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const base = new URL(process.env.EVIDENCE_TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || !/^\/qa_evidence_test[a-z0-9_]*$/.test(base.pathname)) throw new Error('Quota SQL tests require a disposable localhost qa_evidence_test database');
const database = `qa_evidence_test_quota_${process.pid}`, url = new URL(base); url.pathname = '/' + database;
function sql(query, target = url) {
  const result = spawnSync('psql', [target.href, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-q'], { input: query, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout.trim();
}
function concurrent(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [url.href, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-q']); let output = '', errors = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errors += chunk);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    child.stdin.end(query);
  });
}
sql(`create database ${database}`, base);
try {
  sql(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema storage; create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, metadata jsonb);
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => /platform_core_persistence|execution_foundation|monitoring_framework|scheduler_trigger|admin_live_campaigns|quota_safety_background_traffic/.test(name)).sort()) sql(readFileSync(new URL(file, dir), 'utf8'));
  const run = '11111111-1111-4111-8111-111111111111', job = '22222222-2222-4222-8222-222222222222';
  sql(`insert into public.campaign_runs(id,campaign_key,status,created_at,updated_at,requested_by,command_snapshot) values('${run}','fixture','queued',now(),now(),'fixture','{}');
    insert into public.execution_jobs(id,run_id,campaign_key,idempotency_key,status,created_at,updated_at) values('${job}','${run}','fixture','fixture','queued',now(),now());`);
  const calls = await Promise.all(Array.from({ length: 8 }, (_, i) => concurrent(`begin; set local role service_role; select public.poll_inssa_execution_job('worker-${i}',120000); select pg_sleep(0.1); commit;`)));
  const jobs = calls.map(value => JSON.parse(value.split('\n')[0])).filter(value => value.job);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].job.attempt, 1);
  assert.equal(sql(`select count(*) from public.execution_jobs`), '1');
  const owner = jobs[0].job.claimed_by;
  assert.equal(JSON.parse(sql(`set role service_role; select public.poll_inssa_execution_job('${owner}',120000);`)).job, null);
  assert.equal(sql(`select extract(epoch from lease_expires_at-heartbeat_at)*1000 from public.execution_jobs`), '120000.000000');
  sql(`update public.execution_jobs set lease_expires_at=now()-interval '1 second'`);
  const recovered = JSON.parse(sql(`set role service_role; select public.poll_inssa_execution_job('replacement',120000)`));
  assert.equal(recovered.recovered[0].status, 'queued'); assert.equal(recovered.job.attempt, 2);
  sql(`update public.execution_jobs set status='running',lease_expires_at=now()-interval '1 second',max_attempts=10`);
  const running = JSON.parse(sql(`set role service_role; select public.poll_inssa_execution_job('never-retry-running',120000)`));
  assert.equal(running.job, null); assert.equal(running.recovered[0].status, 'abandoned'); assert.ok(running.recovered[0].completed_at);
  sql(`update public.execution_jobs set status='claimed',attempt=10,lease_expires_at=now()-interval '1 second'`);
  const exhausted = JSON.parse(sql(`set role service_role; select public.poll_inssa_execution_job('exhausted',120000)`));
  assert.equal(exhausted.job, null); assert.equal(exhausted.recovered[0].status, 'abandoned');
  sql(`update public.scheduler_runtime_status set running=true,scheduler_id='current',jobs_queued=0 where id='primary';
    set role service_role; select public.record_scheduler_evaluation('current',now(),'[]',3,2,null);`);
  assert.equal(sql(`select jobs_queued from public.scheduler_runtime_status`), '2');
  assert.throws(() => sql(`set role service_role; select public.record_scheduler_evaluation('old',now(),'[]',3,10,null)`), /ownership lost/);
  sql(`insert into storage.objects(bucket_id,metadata) values('inssa-evidence','{"size":950}'),('other','{"size":50}');`);
  const before = sql('select jsonb_agg(to_jsonb(o)) from storage.objects o');
  const usage = JSON.parse(sql('set role service_role; select public.qa_usage_snapshot()'));
  assert.equal(usage.storageBytes, 1000); assert.equal(usage.evidenceBytes, 950); assert.equal(usage.unknownSizeObjects, 0); assert.ok(usage.databaseBytes > 0);
  assert.equal(sql('select jsonb_agg(to_jsonb(o)) from storage.objects o'), before);
  sql(`insert into storage.objects(bucket_id,metadata) values('inssa-evidence','{}')`);
  assert.equal(JSON.parse(sql('set role service_role; select public.qa_usage_snapshot()')).unknownSizeObjects, 1);
  for (const role of ['anon', 'authenticated']) for (const fn of ['poll_inssa_execution_job(text,integer)', 'record_scheduler_evaluation(text,timestamptz,jsonb,integer,integer,text)', 'qa_usage_snapshot()']) {
    assert.equal(sql(`select has_function_privilege('${role}','public.${fn}','EXECUTE')`), 'f');
  }
  assert.equal(sql(`select count(*) from pg_proc where oid in ('public.poll_inssa_execution_job(text,integer)'::regprocedure,'public.record_scheduler_evaluation(text,timestamptz,jsonb,integer,integer,text)'::regprocedure,'public.qa_usage_snapshot()'::regprocedure) and prosecdef`), '0');
  assert.equal(sql(`select bool_and(relrowsecurity) from pg_class where oid in ('public.execution_jobs'::regclass,'public.scheduler_runtime_status'::regclass)`), 't');
  console.log('PASS: 8 concurrent workers/one claim; idempotent poll; 120s lease; pre-execution recovery; no running retry; exhausted abandonment; scheduler ownership/count; read-only usage; unknown sizes; service-only invoker RPCs/RLS');
} finally { sql(`drop database ${database}`, base); }
