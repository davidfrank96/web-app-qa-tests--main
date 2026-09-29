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
    checksum_manifest,storage_bucket,storage_backend,storage_prefix,upload_status,uploaded_at,created_at,indexed_at)
    values(b,r,'test_inssa_safe','Fixture','INSSA','staging','playwright','indexed','short-lived','retention-execution',a,2,6,
    jsonb_build_object('one.json',repeat('a',64),'two.json',repeat('a',64)),'fixture-bucket','spaces','retention-execution','uploaded',now()-interval '31 days',now()-interval '31 days',now()-interval '31 days');
  insert into public.evidence_items(id,bundle_id,run_id,artifact_id,campaign_key,item_type,file_name,relative_path,content_type,size_bytes,sha256,
    retention_class,storage_bucket,storage_backend,storage_key,upload_status,uploaded_at,created_at)
    values(e,b,r,a,'test_inssa_safe','JSON Artifact','one.json','one.json','application/json',3,repeat('a',64),'short-lived','fixture-bucket','spaces','retention-execution/one.json','uploaded',now()-interval '31 days',now()-interval '31 days'),
    (gen_random_uuid(),b,r,a,'test_inssa_safe','JSON Artifact','two.json','two.json','application/json',3,repeat('a',64),'short-lived','fixture-bucket','spaces','retention-execution/two.json','uploaded',now()-interval '31 days',now()-interval '31 days');
  select jsonb_agg(jsonb_build_object('id',id,'name',storage_key,'sizeBytes',size_bytes,'provider','spaces','bucket',storage_bucket,'etag','fixture-etag','sha256',sha256,'createdAt',created_at,'updatedAt',created_at) order by storage_key)
    into objects from public.evidence_items where bundle_id=b;
  -- A same-key Supabase object must survive every Spaces operation.
  insert into storage.objects(bucket_id,name,metadata) values('inssa-evidence','retention-execution/one.json','{"size":3}');
  set local role service_role;
  perform public.retention_claim_occurrence('manual:spaces','fixture-owner',false);
  rev:=public.retention_read_manifest()->>'revision';
  perform pg_temp.reject(format('select public.retention_reserve_bundle(''manual:spaces'',''fixture-owner'',%L,%L,%L,''plan'',%L)',rev,b,repeat('a',64),objects),'unavailable');
  perform pg_temp.reject(format('select public.retention_reserve_spaces_bundle(''manual:spaces'',''fixture-owner'',%L,%L,%L,''plan'',%L,%L,now()-interval ''1 minute'')',rev,b,repeat('a',64),objects,objects),'Fresh Spaces');
  result:=public.retention_reserve_spaces_bundle('manual:spaces','fixture-owner',rev,b,repeat('a',64),'plan',objects,objects,clock_timestamp());
  if result->>'status'<>'RESERVED' then raise exception 'Spaces not reserved'; end if;
  update public.execution_jobs set lease_expires_at=now()-interval '5 minutes' where id=(select job_id from public.retention_occurrences where id='manual:spaces');
  perform public.retention_recover_stale();
  if (select bytes_reclaimed from public.retention_occurrences where id='manual:spaces')<>0 then raise exception 'Stale Spaces owner invented absence'; end if;
  if (select expected_objects from public.retention_deletions where bundle_id=b)<>objects then raise exception 'Stale recovery lost intent'; end if;
  perform public.retention_claim_occurrence('manual:spaces-recovered','fixture-owner',false);
  rev:=public.retention_read_manifest()->>'revision';
  perform public.retention_reserve_spaces_bundle('manual:spaces-recovered','fixture-owner',rev,b,repeat('a',64),'plan',objects,objects,clock_timestamp());
  perform pg_temp.reject('insert into public.retention_holds(scope,reason,hold_type,created_by) values(''global'',''Held'',''manual'',''fixture'')','deletion in progress');
  perform pg_temp.reject(format('select public.retention_settle_bundle(''manual:spaces-recovered'',''fixture-owner'',%L,true,null)',b),'provider mismatch');
  perform pg_temp.reject(format('select public.retention_settle_spaces_bundle(''manual:spaces-recovered'',''fixture-owner'',%L,true,null,''[]'',clock_timestamp())',b),'Fresh Spaces');
  perform public.retention_settle_spaces_bundle('manual:spaces-recovered','fixture-owner',b,false,'delete failed',jsonb_build_array(objects->0),clock_timestamp());
  if (select count(*) from public.evidence_items where bundle_id=b)<>2 then raise exception 'Failure pruned evidence'; end if;
  result:=public.retention_finish_occurrence('manual:spaces-recovered','fixture-owner',null,0,0);
  if result->>'bytes_reclaimed'<>'3' then raise exception 'Partial accounting wrong'; end if;
  perform public.retention_claim_occurrence('manual:spaces-retry','fixture-owner2',false);
  rev:=public.retention_read_manifest()->>'revision';
  result:=public.retention_reserve_spaces_bundle('manual:spaces-retry','fixture-owner2',rev,b,repeat('a',64),'plan2',objects,jsonb_build_array(objects->1),clock_timestamp());
  if jsonb_array_length(result->'remaining')<>1 then raise exception 'Retry included absent object'; end if;
  perform public.retention_settle_spaces_bundle('manual:spaces-retry','fixture-owner2',b,true,null,objects,clock_timestamp());
  if not exists(select 1 from public.evidence_bundles where id=b and status='expired' and retention_tombstone->>'provider'='spaces' and retention_tombstone->>'verificationStatus'='ABSENCE_VERIFIED') then raise exception 'Missing Spaces tombstone'; end if;
  if exists(select 1 from public.evidence_items where bundle_id=b) then raise exception 'Verified pruning failed'; end if;
  result:=public.retention_finish_occurrence('manual:spaces-retry','fixture-owner2',null,0,0);
  if result->>'bytes_reclaimed'<>'3' then raise exception 'Retry double counted'; end if;
  if not exists(select 1 from storage.objects where name='retention-execution/one.json') then raise exception 'Cross-provider deletion'; end if;
  reset role;
  raise notice 'PASS: Spaces RLS, provider isolation, stale-owner intent, partial accounting, retry, verified tombstone';
end $$;
