create or replace function pg_temp.expect_rejection(run_id uuid, bundle jsonb, items jsonb) returns void
language plpgsql as $$ begin
  begin perform public.publish_inssa_evidence(run_id,bundle,items); exception when others then return; end;
  raise exception 'Expected publication rejection';
end; $$;
do $$
declare
  r uuid := gen_random_uuid(); b uuid := gen_random_uuid(); a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); bundle jsonb; items jsonb; corrupted jsonb; saved jsonb;
  m jsonb; proof jsonb; source jsonb; o uuid:=gen_random_uuid(); sig text;
  stamp timestamptz := now()-interval '1 hour'; hash text := repeat('a',64);
begin
  if has_function_privilege('anon','public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text)','execute') or
     has_function_privilege('authenticated','public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text)','execute') then
    raise exception 'Public evidence RPC access';
  end if;
  insert into public.campaign_runs(id,campaign_key,status,created_at,updated_at,requested_by,command_snapshot)
    values(r,'fixture','passed',stamp,stamp,'qa-owned-fixture','{}');
  update public.campaign_runs set completed_at=stamp where id=r;
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
  perform public.publish_inssa_evidence(r,bundle,items);
  source:=public.evidence_migration_snapshot(b);
  sig:=public.evidence_migration_inspect(b)->>'signature';
  if has_function_privilege('anon','public.evidence_migration_step(uuid,text,uuid,text,text,jsonb,text)','execute') or
    has_table_privilege('authenticated','public.evidence_storage_migrations','select') then raise exception 'Migration publicly exposed'; end if;
  m:=public.evidence_migration_step(b,'plan',p_bucket=>'fixture-bucket',p_signature=>sig);
  if public.evidence_migration_step(b,'plan',p_bucket=>'fixture-bucket',p_signature=>sig)->>'id'<>m->>'id' then raise exception 'Unstable migration identity'; end if;
  m:=public.evidence_migration_step(b,'claim',o);
  begin perform public.evidence_migration_step(b,'claim',gen_random_uuid()); raise exception 'TEST_FAIL competing claim';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  begin perform public.evidence_migration_step(b,'switch',o); raise exception 'TEST_FAIL unverified switch';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  begin update public.evidence_items set sha256=repeat('f',64) where id=e1; raise exception 'TEST_FAIL mutation during migration';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  perform public.evidence_migration_step(b,'copy',o);
  select jsonb_build_object('items',jsonb_agg(jsonb_build_object('id',x->>'id','key',x->>'storage_key','sha256',x->>'sha256',
    'sizeBytes',(x->>'size_bytes')::bigint,'contentType',x->>'content_type','sourceBucket','inssa-evidence','destinationBucket','fixture-bucket') order by x->>'id'),
    'sourceVerifiedAt',clock_timestamp(),'destinationVerifiedAt',clock_timestamp(),'exactPrefix',true)
    into proof from jsonb_array_elements(source->'items') x;
  begin perform public.evidence_migration_step(b,'verify',o,p_proof=>jsonb_set(proof,'{items,0,sha256}',to_jsonb(repeat('b',64)))); raise exception 'TEST_FAIL bad proof';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  m:=public.evidence_migration_step(b,'verify',o,p_proof=>proof);
  if public.evidence_migration_snapshot(b) is distinct from source then raise exception 'Copy-only switched metadata'; end if;
  insert into public.retention_holds(scope,run_id,reason,hold_type,created_by) values('run',r,'Fixture hold','manual','test');
  begin perform public.evidence_migration_step(b,'switch',o,p_proof=>proof); raise exception 'TEST_FAIL hold ignored';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  delete from public.retention_holds where run_id=r;
  update public.campaign_runs set updated_at=clock_timestamp() where id=r;
  begin perform public.evidence_migration_step(b,'switch',o,p_proof=>proof); raise exception 'TEST_FAIL changed run ignored';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  update public.campaign_runs set updated_at=stamp where id=r;
  update public.evidence_storage_migrations set lease_until=clock_timestamp()-interval '1 second' where bundle_id=b;
  begin perform public.evidence_migration_step(b,'switch',o,p_proof=>proof); raise exception 'TEST_FAIL expired owner';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  o:=gen_random_uuid(); perform public.evidence_migration_step(b,'claim',o);
  perform public.evidence_migration_step(b,'switch',o,p_proof=>proof);
  -- Lost committed response: a repeated CAS is a read of the exact committed result.
  m:=public.evidence_migration_step(b,'switch',o,p_proof=>proof);
  if m->>'state'<>'METADATA_SWITCHED' or public.evidence_migration_snapshot(b) is distinct from m->'destination_snapshot' then raise exception 'CAS failed'; end if;
  perform pg_temp.expect_rejection(r,bundle,items);
  perform public.evidence_migration_step(b,'preserve',o,p_proof=>proof);
  begin update public.evidence_bundles set storage_backend='supabase-storage' where id=b; raise exception 'TEST_FAIL ordinary provider switch';
  exception when others then if sqlerrm like 'TEST_FAIL%' then raise; end if; end;
  m:=public.evidence_migration_step(b,'rollback',o,p_proof=>proof);
  if m->>'state'<>'ROLLED_BACK' or public.evidence_migration_snapshot(b) is distinct from source then raise exception 'Rollback did not restore exact snapshot'; end if;
  perform public.evidence_migration_step(b,'rollback',o,p_proof=>proof);
  if (select count(*) from public.evidence_storage_migrations where bundle_id=b)<>1 then raise exception 'Duplicate ledger'; end if;
  raise notice 'PASS: migration stable identity, lease fencing, exact proof, hold/run CAS, copy-only, atomic switch, lost response, immutable publication and exact rollback';
end;
$$;
