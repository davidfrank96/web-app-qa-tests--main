// Real, independent PostgreSQL connections. Only a newly-created loopback fixture database is touched.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = new URL(process.env.EVIDENCE_TEST_DATABASE_URL || '');
if (!['localhost','127.0.0.1'].includes(base.hostname) || !base.pathname.startsWith('/qa_evidence_test')) throw new Error('Disposable loopback database required');
const db = `qa_evidence_test_migration_${process.pid}`;
const url = new URL(base); url.pathname = `/${db}`;
function sync(sql, address=url) {
  const r=spawnSync('psql',[address.href,'-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
  if(r.status!==0) throw new Error(r.stderr || 'Fixture SQL failed'); return r.stdout.trim();
}
function session(sql) {
  const p=spawn('psql',[url.href,'-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',err=''; let announce;
  const held = new Promise(resolve => { announce=resolve; });
  p.stdout.on('data',data=>{out+=data; if(out.includes('HELD')) announce();}); p.stderr.on('data',data=>{err+=data;});
  const done = new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});
  p.stdin.end(sql); return {held,done};
}
const b='00000000-0000-4000-8000-000000000001', r='00000000-0000-4000-8000-000000000002';
const owner='00000000-0000-4000-8000-000000000003';
const proof=`(select jsonb_build_object('items',jsonb_agg(jsonb_build_object('id',x->>'id','key',x->>'storage_key','sha256',x->>'sha256','sizeBytes',(x->>'size_bytes')::bigint,'contentType',x->>'content_type','sourceBucket','inssa-evidence','destinationBucket','fixture-bucket') order by x->>'id'),'sourceVerifiedAt',clock_timestamp(),'destinationVerifiedAt',clock_timestamp(),'exactPrefix',true) from public.evidence_storage_migrations m,jsonb_array_elements(m.source_snapshot->'items') x where m.bundle_id='${b}')`;
const switchSql=`select public.evidence_migration_step('${b}','switch','${owner}',p_proof=>${proof});`;
try {
  sync(`create database ${db}`,base);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  const names=readdirSync(dir).filter(n=>/platform_core_persistence|execution_foundation|admin_live_campaigns|monitoring_framework|deferred_cleanup_ledger_version_fix|evidence_retention_dry_run|evidence_cost_control|retention_safety_v3|spaces_dual_provider|historical_evidence_migration/.test(n)).sort();
  let setup=`begin;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz,updated_at timestamptz);
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;\n`;
  setup+=names.map(n=>readFileSync(new URL(n,dir),'utf8')).join('\n');
  let fixture=readFileSync(new URL('../tests/sql/evidence-migration.sql',import.meta.url),'utf8');
  fixture=fixture.slice(0,fixture.indexOf("  if public.evidence_migration_step(b,'plan'"));
  fixture=fixture.replace('r uuid := gen_random_uuid(); b uuid := gen_random_uuid();',`r uuid := '${r}'; b uuid := '${b}';`);
  sync(setup+'\n'+fixture+'\nend; $$; commit;');
  const contenders=[owner,'00000000-0000-4000-8000-000000000004'].map(o=>session(`begin; select public.evidence_migration_step('${b}','claim','${o}'); select pg_sleep(0.15); commit;`).done);
  const claimed=await Promise.all(contenders); assert.equal(claimed.filter(x=>x.code===0).length,1);
  assert.match(claimed.find(x=>x.code!==0).err,/owned by another/);
  sync(`update public.evidence_storage_migrations set lease_until=clock_timestamp()-interval '1 second'; select public.evidence_migration_step('${b}','claim','${owner}'); select public.evidence_migration_step('${b}','copy','${owner}'); select public.evidence_migration_step('${b}','verify','${owner}',p_proof=>${proof});`);
  // A committed hold that wins the global lock MUST be seen by the waiting switch.
  const hold=session(`begin; insert into public.retention_holds(scope,run_id,reason,hold_type,created_by) values('run','${r}','Concurrent fixture','manual','test');\n\\echo HELD\nselect pg_sleep(0.3); commit;`);
  await hold.held; const blockedSwitch=session(switchSql); assert.equal((await hold.done).code,0);
  assert.match((await blockedSwitch.done).err,/BLOCKED_PROTECTION/);
  assert.equal(sync(`select storage_backend from public.evidence_bundles where id='${b}'`),'supabase-storage');
  sync(`delete from public.retention_holds where run_id='${r}'`);
  // The reservation trigger fires before constraints: even an owner bypassing the planner cannot reserve.
  const reservation=await session(`insert into public.retention_deletions(bundle_id) values('${b}');`).done;
  assert.match(reservation.err,/Migration reserves this bundle/);
  // Publication holds the run row BEFORE waiting for the global lock. CAS must not acquire that row.
  const cas=session(`begin; select pg_advisory_xact_lock(9042102);\n\\echo HELD\nselect pg_sleep(0.3); ${switchSql} commit;`);
  await cas.held;
  const publication=session(`begin; set local statement_timeout='5s'; select id from public.campaign_runs where id='${r}' for update;
    select public.publish_inssa_evidence('${r}',source_snapshot->'bundle',source_snapshot->'items') from public.evidence_storage_migrations where bundle_id='${b}'; commit;`);
  assert.equal((await cas.done).code,0); const rejected=await publication.done; assert.notEqual(rejected.code,0); assert.doesNotMatch(rejected.err,/deadlock|statement timeout/i);
  assert.equal(sync(`select state from public.evidence_storage_migrations where bundle_id='${b}'`),'METADATA_SWITCHED');
  assert.equal(sync(`select count(*) from public.evidence_items where bundle_id='${b}' and storage_backend='spaces'`),'2');
  console.log('PASS: real concurrent claims, hold-before-CAS, retention reservation exclusion, publication/CAS lock order and complete atomic switch');
} finally {
  sync(`drop database if exists ${db} with (force)`,base);
}
