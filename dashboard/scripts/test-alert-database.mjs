import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const base = new URL(process.env.EVIDENCE_TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || !/^\/qa_evidence_test[a-z0-9_]*$/.test(base.pathname)) throw new Error('Quota SQL tests require a disposable localhost qa_evidence_test database');
const database = `qa_evidence_test_alerts_${process.pid}`, url = new URL(base); url.pathname = '/' + database;
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
  for (const file of readdirSync(dir).filter(name => /notification_outbox|authentication_monitoring|platform_core_persistence|execution_foundation|monitoring_framework|scheduler_trigger|admin_live_campaigns|quota_safety_background_traffic|production_auth_brevo_alerts/.test(name)).sort()) sql(readFileSync(new URL(file, dir), 'utf8'));
  let index=0;
  function run(status, requested='manual:fixture') {
    const id = `11111111-1111-4111-8111-${String(++index).padStart(12,'0')}`;
    sql(`insert into public.campaign_runs(id,campaign_key,status,created_at,updated_at,completed_at,requested_by,command_snapshot) values('${id}','monitor_inssa_auth_production','${status}',now(),now(),now()+interval '${index} seconds','${requested}','{}')`);
    return id;
  }
  function record(id, passed) { sql(`set role service_role; select public.record_production_auth_result('${id}',${passed},'${passed?'NONE':'TIMEOUT'}')`); }
  function count(event) { return Number(sql(`select count(*) from public.notification_outbox where event_type='${event}'`)); }
  const first=run('failed'); record(first,false); record(first,false);
  assert.equal(count('production_auth_failed'),1); assert.equal(count('production_auth_observation'),1);
  const duplicate=run('failed');record(duplicate,false); assert.equal(count('production_auth_failed'),1);
  const reminder=run('failed','scheduler:fixture');record(reminder,false); assert.equal(count('production_auth_failed'),2);
  // Internal observations are acknowledged separately in the application; isolate email claims here.
  sql("update public.notification_outbox set status='delivered' where event_type='production_auth_observation'");
  const claims=await Promise.all(Array.from({length:8},()=>concurrent(`set role service_role; select public.claim_brevo_notification(gen_random_uuid())`)));
  const claimed=claims.filter(Boolean).map(JSON.parse).filter(Boolean); assert.equal(claimed.length,1);
  let item=claimed[0]; assert.equal(item.attempt_count,1);
  assert.throws(()=>sql(`set role service_role; select public.finish_brevo_notification('${item.id}',gen_random_uuid(),'accepted',null,false)`),/ownership lost/);
  sql(`set role service_role; select public.finish_brevo_notification('${item.id}','${item.delivery_token}',null,'Brevo delivery HTTP 503',false)`);
  assert.equal(sql(`select status from public.notification_outbox where id='${item.id}'`),'failed');
  assert.equal(sql(`select next_attempt_at>now() from public.notification_outbox where id='${item.id}'`),'t');
  const recovery=run('passed');record(recovery,true);
  assert.equal(count('production_auth_recovered'),0); // no confirmed delivery yet
  assert.equal(sql(`select status from public.notification_outbox where id='${item.id}'`),'failed'); // uncertain acceptance must retry
  sql(`update public.notification_outbox set next_attempt_at=now()-interval '1 second' where id='${item.id}'`);
  item=JSON.parse(sql('set role service_role; select public.claim_brevo_notification(gen_random_uuid())'));
  assert.equal(item.attempt_count,2);
  sql(`set role service_role; select public.finish_brevo_notification('${item.id}','${item.delivery_token}','accepted',null,false)`);
  assert.equal(count('production_auth_recovered'),1); record(recovery,true);assert.equal(count('production_auth_recovered'),1);
  sql("update public.notification_outbox set status='delivered' where event_type='production_auth_observation'");
  item=JSON.parse(sql('set role service_role; select public.claim_brevo_notification(gen_random_uuid())'));
  assert.equal(item.event_type,'production_auth_recovered');
  sql(`update public.notification_outbox set delivery_lease_until=now()-interval '1 second' where id='${item.id}'`);
  const reclaimed=JSON.parse(sql('set role service_role; select public.claim_brevo_notification(gen_random_uuid())'));
  assert.equal(reclaimed.id,item.id);assert.notEqual(reclaimed.delivery_token,item.delivery_token);
  sql(`set role service_role; select public.finish_brevo_notification('${reclaimed.id}','${reclaimed.delivery_token}',null,'Permanent failure',true)`);
  assert.equal(sql(`select status from public.notification_outbox where id='${item.id}'`),'dead_letter');
  const clean=run('passed');record(clean,true);assert.equal(count('production_auth_recovered'),1);
  assert.throws(()=>record(first,true),/Failed run cannot recover/);
  assert.throws(()=>sql(`set role service_role; select public.activate_production_auth_schedules('${first}')`));
  assert.throws(()=>sql(`set role service_role; select public.activate_production_auth_schedules('${clean}')`),/Uploaded evidence required/);
  for(const role of ['anon','authenticated']) for(const fn of ['claim_brevo_notification(uuid)','finish_brevo_notification(uuid,uuid,text,text,boolean)','record_production_auth_result(uuid,boolean,text)','activate_production_auth_schedules(uuid)']) {
    assert.equal(sql(`select has_function_privilege('${role}','public.${fn}','EXECUTE')`),'f');
  }
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.production_auth_alert_state'::regclass"),'t');
  console.log('PASS: transactional observations, deduplication, scheduled reminder, 8 concurrent claims, fencing, backoff, recovery after uncertain acceptance, one recovery, permanent dead-letter, lease recovery, activation gates, service-only RLS');
} finally { sql(`drop database ${database}`, base); }
