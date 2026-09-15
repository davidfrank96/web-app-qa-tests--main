-- This file runs ONLY against a rolled-back loopback fixture. Simulated Storage deletion
-- below removes fixture rows; the production executor uses the Storage API exclusively.
create function pg_temp.reject(q text, expected text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like '%'||expected||'%' then return; end if; raise;
  end;
  raise exception 'Expected rejection: %',expected;
end $$;
do $$
declare r uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); h uuid;
  role_name text; relation_name text; f record; objects jsonb; rev text; before_run jsonb; before_audit jsonb; before_cleanup jsonb; before_monitor jsonb; result jsonb;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach relation_name in array array['retention_settings','retention_occurrences','retention_deletions','retention_audit'] loop
      if has_table_privilege(role_name,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Public retention privilege'; end if;
      if not(select relrowsecurity from pg_class where oid=('public.'||relation_name)::regclass) then raise exception 'Missing RLS'; end if;
    end loop;
    for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname like 'retention_%' loop
      if has_function_privilege(role_name,f.oid,'execute') then raise exception 'Public retention function: %',f.proname; end if;
    end loop;
  end loop;
  insert into public.campaign_runs(id,campaign_key,status,created_at,updated_at,started_at,completed_at,requested_by,command_snapshot)
    values(r,'test_inssa_safe','passed',now()-interval '31 days',now(),now()-interval '31 days',now()-interval '31 days','fixture','{}');
  insert into public.artifacts(id,run_id,artifact_type,file_path,file_size,content_type,created_at,sha256)
    values(a,r,'JSON Artifact','retention-execution/one.json',3,'application/json',now()-interval '31 days',repeat('a',64));
  insert into public.evidence_bundles(id,run_id,campaign_key,title,product,environment,bundle_type,status,retention_class,root_path,source_artifact_id,item_count,total_bytes,
    checksum_manifest,storage_backend,storage_prefix,upload_status,uploaded_at,created_at,indexed_at)
    values(b,r,'test_inssa_safe','Fixture','INSSA','staging','playwright','indexed','short-lived','retention-execution',a,2,6,
    jsonb_build_object('one.json',repeat('a',64),'two.json',repeat('a',64)),'supabase-storage','retention-execution','uploaded',now()-interval '31 days',now()-interval '31 days',now()-interval '31 days');
  insert into public.evidence_items(id,bundle_id,run_id,artifact_id,campaign_key,item_type,file_name,relative_path,content_type,size_bytes,sha256,
    retention_class,storage_backend,storage_key,upload_status,uploaded_at,created_at)
    values(e,b,r,a,'test_inssa_safe','JSON Artifact','one.json','one.json','application/json',3,repeat('a',64),'short-lived','supabase-storage','retention-execution/one.json','uploaded',now()-interval '31 days',now()-interval '31 days'),
    (gen_random_uuid(),b,r,a,'test_inssa_safe','JSON Artifact','two.json','two.json','application/json',3,repeat('a',64),'short-lived','supabase-storage','retention-execution/two.json','uploaded',now()-interval '31 days',now()-interval '31 days');
  insert into storage.objects(bucket_id,name,metadata,created_at,updated_at) values
    ('inssa-evidence','retention-execution/one.json','{"size":3}',now()-interval '31 days',now()-interval '31 days'),
    ('inssa-evidence','retention-execution/two.json','{"size":3}',now()-interval '31 days',now()-interval '31 days');
  insert into public.cleanup_ledger(id,originating_run_id,campaign_key,product,environment,object_type,object_id,object_path,status,created_at,updated_at,retention_until)
    values('unrelated-cleanup','unrelated-run','unrelated-campaign','INSSA','staging','time_capsule','unrelated-object','unrelated-path','deferred',now(),now(),now()+interval '90 days');
  insert into public.audit_events(id,event_type,metadata,created_at) values(gen_random_uuid(),'login','{"fixture":"preserve"}',now());
  select to_jsonb(t)-'updated_at' into before_run from public.campaign_runs t where id=r;
  select jsonb_agg(to_jsonb(t) order by id) into before_audit from public.audit_events t;
  select jsonb_agg(to_jsonb(t) order by id) into before_cleanup from public.cleanup_ledger t;
  select jsonb_agg(to_jsonb(t) order by id) into before_monitor from public.monitoring_definitions t;
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'sizeBytes',3,'createdAt',created_at,'updatedAt',updated_at) order by name)
    into objects from storage.objects where name like 'retention-execution/%';
  set local role service_role;
  perform pg_temp.reject('select public.retention_enable_daily()','Controlled initial execution');
  result:=public.retention_claim_occurrence('manual:initial-fixture','fixture-owner',false);
  if result->>'status'<>'RUNNING' then raise exception 'Maintenance not claimed: %',result; end if;
  if public.retention_claim_occurrence('manual:initial-fixture','different-owner',false)->>'status'<>'ALREADY_RECORDED' then raise exception 'Occurrence replayed'; end if;
  if public.retention_claim_occurrence('manual:parallel-fixture','different-owner',false)->>'status'<>'SKIPPED_ACTIVE_EXECUTION' then raise exception 'Maintenance competed'; end if;
  -- Normal QA enqueue uses this exact shared unique index.
  perform pg_temp.reject(format('insert into public.execution_jobs(id,run_id,campaign_key,idempotency_key,status,created_at,updated_at) values(gen_random_uuid(),%L,''qa'',''qa-concurrent'',''queued'',now(),now())',r),'execution_jobs_one_active');
  rev:=public.retention_read_manifest()->>'revision';
  insert into public.retention_holds(scope,reason,hold_type,created_by) values('global','Added after planning','incident','fixture') returning id into h;
  perform pg_temp.reject(format('select public.retention_reserve_bundle(''manual:initial-fixture'',''fixture-owner'',%L,%L,%L,''plan'',%L)',rev,b,repeat('a',64),objects),'snapshot changed');
  update public.retention_holds set status='released',released_at=now(),released_by='fixture' where id=h;
  rev:=public.retention_read_manifest()->>'revision';
  perform pg_temp.reject(format('select public.retention_reserve_bundle(''manual:initial-fixture'',''wrong-owner'',%L,%L,%L,''plan'',%L)',rev,b,repeat('a',64),objects),'ownership lost');
  result:=public.retention_reserve_bundle('manual:initial-fixture','fixture-owner',rev,b,repeat('a',64),'plan',objects);
  if result->>'status'<>'RESERVED' then raise exception 'Bundle not reserved'; end if;
  perform pg_temp.reject('insert into public.retention_holds(scope,reason,hold_type,created_by) values(''global'',''During irreversible step'',''manual'',''fixture'')','deletion in progress');
  perform pg_temp.reject(format('update public.campaign_runs set status=''running'' where id=%L',r),'deletion in progress');
  perform pg_temp.reject('update public.cleanup_ledger set status=''completed'' where id=''unrelated-cleanup''','deletion in progress');
  perform pg_temp.reject(format('select public.retention_settle_bundle(''manual:initial-fixture'',''fixture-owner'',%L,true,null)',b),'absence not verified');
  reset role;
  delete from storage.objects where bucket_id='inssa-evidence' and name='retention-execution/one.json'; -- FIXTURE Storage API simulation
  set local role service_role;
  perform public.retention_settle_bundle('manual:initial-fixture','fixture-owner',b,false,'Injected partial deletion');
  if (select count(*) from public.evidence_items where bundle_id=b)<>2 then raise exception 'Partial deletion pruned metadata'; end if;
  result:=public.retention_finish_occurrence('manual:initial-fixture','fixture-owner',null,3,13);
  if result->>'status'<>'PARTIAL_FAILURE' or (result->>'bytes_reclaimed')::bigint<>3 then raise exception 'Partial accounting incorrect'; end if;
  perform public.retention_claim_occurrence('manual:retry-fixture','retry-owner',false);
  update public.retention_occurrences set reserved_objects=5000 where id='manual:retry-fixture';
  rev:=public.retention_read_manifest()->>'revision';
  if public.retention_reserve_bundle('manual:retry-fixture','retry-owner',rev,b,repeat('a',64),'retry-plan',objects)->>'status'<>'BUDGET_REACHED' then raise exception 'Budget not enforced'; end if;
  update public.retention_occurrences set reserved_objects=0 where id='manual:retry-fixture';
  perform pg_temp.reject('update public.retention_occurrences set reserved_bundles=101 where id=''manual:retry-fixture''','check constraint');
  perform pg_temp.reject('update public.retention_occurrences set reserved_bytes=2000000001 where id=''manual:retry-fixture''','check constraint');
  result:=public.retention_reserve_bundle('manual:retry-fixture','retry-owner',rev,b,repeat('a',64),'retry-plan',objects);
  if jsonb_array_length(result->'remaining')<>1 or result->'remaining'->0->>'name'<>'retention-execution/two.json' then raise exception 'Retry did not isolate remaining key'; end if;
  reset role;
  delete from storage.objects where bucket_id='inssa-evidence' and name='retention-execution/two.json'; -- FIXTURE Storage API simulation
  set local role service_role;
  perform public.retention_settle_bundle('manual:retry-fixture','retry-owner',b,true,null);
  if exists(select 1 from public.evidence_items where bundle_id=b) or exists(select 1 from public.artifacts where run_id=r) then raise exception 'Heavy metadata not pruned'; end if;
  if not exists(select 1 from public.evidence_bundles where id=b and status='expired' and retention_tombstone->>'verificationStatus'='ABSENCE_VERIFIED' and
    retention_tombstone->>'originalObjectCount'='2' and retention_tombstone->>'originalByteCount'='6') then raise exception 'Tombstone missing'; end if;
  if (select expected_objects from public.retention_deletions where bundle_id=b)<>'[]'::jsonb then raise exception 'Heavy intent retained'; end if;
  perform pg_temp.reject(format('update public.evidence_bundles set status=''indexed'' where id=%L',b),'publication is forbidden');
  result:=public.retention_finish_occurrence('manual:retry-fixture','retry-owner',null,3,13);
  if result->>'status'<>'HEALTHY' or result->>'objects_deleted'<>'1' or result->>'bytes_reclaimed'<>'3' then raise exception 'Retry accounting incorrect'; end if;
  if public.retention_claim_occurrence('manual:retry-fixture','another-owner',false)->>'status'<>'ALREADY_RECORDED' then raise exception 'Completed occurrence repeated'; end if;
  perform public.retention_enable_daily();
  if public.retention_health()->>'enabled'<>'true' or public.retention_health()->>'totalReclaimed'<>'6' then raise exception 'Health accounting incorrect'; end if;
  if before_run<>(select to_jsonb(t)-'updated_at' from public.campaign_runs t where id=r) then raise exception 'Run metadata changed'; end if;
  if before_cleanup<>(select jsonb_agg(to_jsonb(t) order by id) from public.cleanup_ledger t) then raise exception 'Cleanup ledger changed'; end if;
  if before_monitor<>(select jsonb_agg(to_jsonb(t) order by id) from public.monitoring_definitions t) then raise exception 'Monitoring definitions changed'; end if;
  if not (select jsonb_agg(to_jsonb(t) order by id) from public.audit_events t) @> before_audit then raise exception 'Audit event removed'; end if;
  -- Normal QA can enqueue immediately after maintenance completes.
  insert into public.execution_jobs(id,run_id,campaign_key,idempotency_key,status,created_at,updated_at) values(gen_random_uuid(),r,'qa','qa-after-retention','queued',now(),now());
  if public.retention_claim_occurrence('manual:qa-active','another-owner',false)->>'status'<>'SKIPPED_ACTIVE_EXECUTION' then raise exception 'Active QA not respected'; end if;
  -- An expired maintenance owner is closed, never replayed, and releases normal execution.
  update public.execution_jobs set status='completed',completed_at=now() where idempotency_key='qa-after-retention';
  perform public.retention_claim_occurrence('manual:crashed','crashed-owner',false);
  update public.execution_jobs set lease_expires_at=now()-interval '5 minutes' where id=(select job_id from public.retention_occurrences where id='manual:crashed');
  if public.retention_health()->>'status' not in ('STALE','HEALTHY','SKIPPED_ACTIVE_EXECUTION','PARTIAL_FAILURE') then raise exception 'Invalid health'; end if;
  perform public.retention_recover_stale();
  if not exists(select 1 from public.retention_occurrences where id='manual:crashed' and status='FAILED') then raise exception 'Stale occurrence not recovered'; end if;
  if public.retention_claim_occurrence('manual:crashed','new-owner',false)->>'status'<>'ALREADY_RECORDED' then raise exception 'Crashed occurrence replayed'; end if;
  if exists(select 1 from public.execution_jobs where status in ('queued','claimed','running')) then raise exception 'Recovery left execution locked'; end if;
  reset role;
  raise notice 'PASS: v2 RLS, shared QA mutex, at-most-once occurrence, hold race, safety gate, ownership, verified absence before prune, partial retry, all budgets, tombstone, expiry publication block, exact accounting, run/audit/cleanup/monitoring preservation';
end $$;
