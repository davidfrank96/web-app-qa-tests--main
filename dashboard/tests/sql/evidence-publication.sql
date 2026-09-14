begin;
create or replace function pg_temp.expect_rejection(run_id uuid, bundle jsonb, items jsonb) returns void
language plpgsql as $$
begin
  begin
    perform public.publish_inssa_evidence(run_id,bundle,items);
  exception when others then return;
  end;
  raise exception 'Expected publication rejection';
end;
$$;
do $$
declare
  r uuid := gen_random_uuid(); b uuid := gen_random_uuid(); a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); bundle jsonb; items jsonb; corrupted jsonb; saved jsonb;
  stamp timestamptz := now(); hash text := repeat('a',64);
begin
  if has_function_privilege('anon','public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text)','execute') or
     has_function_privilege('authenticated','public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text)','execute') then
    raise exception 'Public evidence RPC access';
  end if;
  insert into public.campaign_runs(id,campaign_key,status,created_at,updated_at,requested_by,command_snapshot)
    values(r,'fixture','failed',stamp,stamp,'qa-owned-fixture','{}');
  insert into public.artifacts(id,run_id,artifact_type,file_path,file_size,content_type,created_at,sha256)
    values(a1,r,'JSON Artifact','run-output/fixture/one.json',3,'application/json',stamp,hash),
          (a2,r,'JSON Artifact','run-output/fixture/two.json',3,'application/json',stamp,hash);
  bundle := jsonb_build_object('id',b,'run_id',r,'campaign_key','fixture','title','QA owned transaction fixture',
    'product','INSSA','environment','staging','bundle_type','mixed','status','indexed','retention_class','default',
    'root_path','run-output/fixture','source_artifact_id',a1,'item_count',2,'total_bytes',6,
    'checksum_manifest',jsonb_build_object('run-output/fixture/one.json',hash,'run-output/fixture/two.json',hash),
    'sensitive',true,'storage_backend','supabase-storage','storage_prefix','immutable-fixture-prefix',
    'upload_status','uploaded','uploaded_at',stamp,'upload_error',null,'created_at',stamp,'indexed_at',stamp);
  items := jsonb_build_array(jsonb_build_object('id',e1,'bundle_id',b,'run_id',r,'artifact_id',a1,'campaign_key','fixture',
    'item_type','JSON Artifact','file_name','one.json','relative_path','run-output/fixture/one.json',
    'content_type','application/json','size_bytes',3,'sha256',hash,'sensitive',true,'render_inline',false,'retention_class','default',
    'storage_backend','supabase-storage','storage_key','immutable-fixture-prefix/run-output/fixture/one.json',
    'upload_status','uploaded','uploaded_at',stamp,'upload_error',null,'metadata','{}'::jsonb,'created_at',stamp));
  items := items || jsonb_build_array(items->0 || jsonb_build_object('id',e2,'artifact_id',a2,'file_name','two.json',
    'relative_path','run-output/fixture/two.json','storage_key','immutable-fixture-prefix/run-output/fixture/two.json'));
  -- Rejected before the first write.
  perform pg_temp.expect_rejection(r,bundle || '{"item_count":3}',items);
  if exists(select 1 from public.evidence_bundles where run_id=r) then raise exception 'Pre-publication left metadata'; end if;
  -- Second item fails after bundle + first item writes; the whole RPC must roll back.
  corrupted := jsonb_set(items,'{1,artifact_id}',to_jsonb(gen_random_uuid()));
  perform pg_temp.expect_rejection(r,bundle,corrupted);
  if exists(select 1 from public.evidence_bundles where run_id=r) or exists(select 1 from public.evidence_items where run_id=r) then
    raise exception 'Half-published evidence after injected failure';
  end if;
  perform public.publish_inssa_evidence(r,bundle,items);
  select jsonb_agg(to_jsonb(i) order by id) into saved from public.evidence_items i where run_id=r;
  -- A committed write whose acknowledgement was lost is safe to repeat.
  perform public.publish_inssa_evidence(r,bundle,items);
  perform public.publish_inssa_evidence(r,bundle,items);
  perform pg_temp.expect_rejection(r,bundle || '{"item_count":1}',items);
  perform pg_temp.expect_rejection(r,bundle,jsonb_set(items,'{0,sha256}',to_jsonb(repeat('b',64))));
  perform pg_temp.expect_rejection(r,bundle,jsonb_set(items,'{0,storage_key}','"different-immutable-key"'));
  perform pg_temp.expect_rejection(r,bundle || '{"upload_status":"failed"}',items);
  perform pg_temp.expect_rejection(r,null,'[]');
  if (select count(*) from public.evidence_bundles where run_id=r) <> 1 or
     (select jsonb_agg(to_jsonb(i) order by id) from public.evidence_items i where run_id=r) is distinct from saved then
    raise exception 'Retry or failed update destroyed valid evidence';
  end if;
  raise notice 'PASS: before/during publication faults, lost acknowledgement retry, checksum/count/key mismatch, downgrade, private RPC';
end;
$$;
rollback;
