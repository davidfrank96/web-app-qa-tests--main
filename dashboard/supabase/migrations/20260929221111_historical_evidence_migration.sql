-- Additive infrastructure only. Ordinary publish_inssa_evidence remains unchanged.
create table public.evidence_storage_migrations (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null unique references public.evidence_bundles(id),
  run_id uuid not null references public.campaign_runs(id),
  state text not null default 'PLANNED' check (state in (
    'PLANNED','COPYING','DESTINATION_VERIFIED','METADATA_SWITCHED','SOURCE_PRESERVED',
    'FAILED_RETRYABLE','BLOCKED_CHANGED_SOURCE','BLOCKED_PROTECTION','BLOCKED_SOURCE_INTEGRITY',
    'BLOCKED_DESTINATION_CONFLICT','ROLLBACK_REQUIRED','ROLLED_BACK')),
  source_snapshot jsonb not null,
  source_signature text not null,
  destination_snapshot jsonb not null,
  destination_bucket text not null check (destination_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
  item_count integer not null check (item_count > 0),
  total_bytes bigint not null check (total_bytes >= 0),
  owner uuid, lease_until timestamptz, attempts integer not null default 0,
  check ((owner is null) = (lease_until is null)),
  proof jsonb, error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz, switched_at timestamptz, preserved_at timestamptz, rolled_back_at timestamptz,
  history jsonb not null default '[]'::jsonb
);
alter table public.evidence_storage_migrations enable row level security;
revoke all on public.evidence_storage_migrations from public,anon,authenticated;
grant select,insert,update on public.evidence_storage_migrations to service_role;
create index evidence_migrations_state_idx on public.evidence_storage_migrations(state,created_at,id);
create index evidence_migrations_run_idx on public.evidence_storage_migrations(run_id);

create function public.evidence_migration_snapshot(p_bundle uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('bundle',to_jsonb(b),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
    from public.evidence_items i where i.bundle_id=b.id),'[]'::jsonb),
    'run',(select to_jsonb(r)-'requested_by' from public.campaign_runs r where r.id=b.run_id))
  from public.evidence_bundles b where b.id=p_bundle;
$$;

-- A narrow first version: healthy, unexpired routine evidence only. Unknown protection fails closed.
create function public.evidence_migration_assert_safe(p_bundle uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.evidence_bundles; r public.campaign_runs;
begin
  select * into b from public.evidence_bundles where id=p_bundle;
  select * into r from public.campaign_runs where id=b.run_id;
  if b.id is null or b.status<>'indexed' or b.upload_status<>'uploaded' or b.upload_error is not null
    or r.id is null or r.status not in ('passed','passed_with_warnings') or r.completed_at is null
    or r.completed_at>clock_timestamp() or r.campaign_key<>b.campaign_key
    or b.retention_class not in ('default','short-lived')
    or exists(select 1 from public.evidence_items i where i.bundle_id=b.id and
      (i.retention_class not in ('default','short-lived') or i.upload_status<>'uploaded' or i.upload_error is not null))
    or r.completed_at + interval '30 days' <= clock_timestamp() + interval '10 minutes'
    or exists(select 1 from public.execution_jobs j where j.run_id=b.run_id and j.status in ('queued','claimed','running'))
    or exists(select 1 from public.cleanup_ledger c where c.originating_run_id=b.run_id::text)
    or exists(select 1 from public.retention_deletions d where d.bundle_id=b.id)
    or exists(select 1 from public.retention_holds h where h.status='active' and
      (h.scope='global' or h.run_id=b.run_id or h.bundle_id=b.id or
       h.item_id in (select i.id from public.evidence_items i where i.bundle_id=b.id)))
    or not exists(select 1 from public.retention_policies p where p.id='evidence-retention-v3' and
      p.mode='enforced' and p.routine_days=30 and p.warning_days=60 and p.failure_days=90 and p.security_days=90)
  then raise exception 'BLOCKED_PROTECTION'; end if;
end;
$$;

-- Every proof covers the exact logical set. Bytes are verified by the trusted server CLI;
create function public.evidence_migration_inspect(p_bundle uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s jsonb; reason text;
begin
  s:=public.evidence_migration_snapshot(p_bundle);
  begin perform public.evidence_migration_assert_safe(p_bundle);
  exception when others then reason:='BLOCKED_PROTECTION'; end;
  return jsonb_build_object('snapshot',s,'signature',encode(sha256(convert_to(s::text,'UTF8')),'hex'),'blocked',reason);
end;
$$;

-- PostgreSQL independently checks the proof against the frozen manifest, never a caller's new manifest.
create function public.evidence_migration_assert_proof(p_m public.evidence_storage_migrations,p_proof jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare expected jsonb;
begin
  select jsonb_agg(jsonb_build_object('id',i->>'id','key',i->>'storage_key','sha256',i->>'sha256',
    'sizeBytes',(i->>'size_bytes')::bigint,'contentType',i->>'content_type',
    'sourceBucket',coalesce(i->>'storage_bucket','inssa-evidence'),'destinationBucket',p_m.destination_bucket) order by i->>'id')
    into expected from jsonb_array_elements(p_m.source_snapshot->'items') i;
  if p_proof is null or p_proof->'items' is distinct from expected
    or p_proof->>'sourceVerifiedAt' is null or p_proof->>'destinationVerifiedAt' is null
    or (p_proof->>'sourceVerifiedAt')::timestamptz < clock_timestamp()-interval '5 minutes'
    or (p_proof->>'destinationVerifiedAt')::timestamptz < clock_timestamp()-interval '5 minutes'
    or (p_proof->>'sourceVerifiedAt')::timestamptz > clock_timestamp()
    or (p_proof->>'destinationVerifiedAt')::timestamptz > clock_timestamp()
    or p_proof->'exactPrefix' is distinct from 'true'::jsonb
  then raise exception 'Migration verification proof is incomplete or stale'; end if;
end;
$$;

-- Same lock order as retention: global safety mutex, bundle, ledger. Deliberately no run
-- FOR UPDATE: ordinary publication takes that row before acquiring the safety mutex.
create function public.evidence_migration_step(p_bundle uuid,p_action text,p_owner uuid default null,
  p_bucket text default null,p_signature text default null,p_proof jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.evidence_storage_migrations; s jsonb; dest jsonb; n integer; next_state text; i jsonb;
begin
  perform pg_advisory_xact_lock(9042102);
  perform 1 from public.evidence_bundles where id=p_bundle for update;
  if not found then raise exception 'Migration bundle missing'; end if;
  select * into m from public.evidence_storage_migrations where bundle_id=p_bundle for update;
  s:=public.evidence_migration_snapshot(p_bundle);
  if p_action='plan' then
    if m.id is not null then
      if m.destination_bucket is distinct from p_bucket then raise exception 'Migration destination changed'; end if;
      return to_jsonb(m);
    end if;
    perform public.evidence_migration_assert_safe(p_bundle);
    if p_signature is distinct from encode(sha256(convert_to(s::text,'UTF8')),'hex') then raise exception 'BLOCKED_CHANGED_SOURCE'; end if;
    if s->'bundle'->>'storage_backend'<>'supabase-storage' or coalesce(s->'bundle'->>'storage_bucket','inssa-evidence')<>'inssa-evidence'
      or nullif(s->'bundle'->>'storage_prefix','') is null or p_bucket is null
      or (s->'bundle'->>'item_count')::integer<>jsonb_array_length(s->'items') or jsonb_array_length(s->'items')=0
      or (s->'bundle'->>'total_bytes')::bigint<>(select sum((x->>'size_bytes')::bigint) from jsonb_array_elements(s->'items') x)
      or s->'bundle'->'checksum_manifest' is distinct from (select jsonb_object_agg(x->>'relative_path',x->>'sha256') from jsonb_array_elements(s->'items') x)
      or exists(select 1 from jsonb_array_elements(s->'items') x where
        x->>'storage_backend'<>'supabase-storage' or coalesce(x->>'storage_bucket','inssa-evidence')<>'inssa-evidence'
        or x->>'storage_key' is distinct from (s->'bundle'->>'storage_prefix')||'/'||(x->>'relative_path')
        or x->>'sha256' !~ '^[a-f0-9]{64}$' or (x->>'size_bytes')::bigint<0
        or x->>'run_id' is distinct from s->'bundle'->>'run_id' or x->>'campaign_key' is distinct from s->'bundle'->>'campaign_key')
      or (select count(distinct x->>'storage_key') from jsonb_array_elements(s->'items') x)<>jsonb_array_length(s->'items')
      or exists(select 1 from public.evidence_items x where x.bundle_id<>p_bundle and x.storage_backend='spaces'
        and x.storage_bucket=p_bucket and x.storage_key in (select y->>'storage_key' from jsonb_array_elements(s->'items') y))
      or exists(select 1 from public.evidence_storage_migrations z, jsonb_array_elements(z.source_snapshot->'items') x
        where z.destination_bucket=p_bucket and x->>'storage_key' in (select y->>'storage_key' from jsonb_array_elements(s->'items') y))
    then raise exception 'BLOCKED_SOURCE_INTEGRITY'; end if;
    dest:=jsonb_set(s,'{bundle}',s->'bundle'||jsonb_build_object('storage_backend','spaces','storage_bucket',p_bucket));
    dest:=jsonb_set(dest,'{items}',(select jsonb_agg(x||jsonb_build_object('storage_backend','spaces','storage_bucket',p_bucket) order by x->>'id') from jsonb_array_elements(s->'items') x));
    insert into public.evidence_storage_migrations(bundle_id,run_id,source_snapshot,source_signature,destination_snapshot,destination_bucket,item_count,total_bytes)
      values(p_bundle,(s->'bundle'->>'run_id')::uuid,s,p_signature,dest,p_bucket,(s->'bundle'->>'item_count')::integer,(s->'bundle'->>'total_bytes')::bigint)
      returning * into m;
    return to_jsonb(m);
  end if;
  if m.id is null then raise exception 'Migration is not planned'; end if;
  if p_action='claim' then
    if p_owner is null or (m.owner is not null and m.owner<>p_owner and m.lease_until>clock_timestamp()) then raise exception 'Migration owned by another operator'; end if;
    update public.evidence_storage_migrations set owner=p_owner,lease_until=clock_timestamp()+interval '120 seconds',
      attempts=attempts+1,updated_at=clock_timestamp() where id=m.id returning * into m;
    return to_jsonb(m);
  end if;
  if p_owner is null or m.owner is distinct from p_owner or m.lease_until is null or m.lease_until<=clock_timestamp() then raise exception 'Migration lease lost'; end if;
  if p_action in ('heartbeat','release') then
    update public.evidence_storage_migrations set owner=case when p_action='release' then null else owner end,
      lease_until=case when p_action='release' then null else clock_timestamp()+interval '120 seconds' end,updated_at=clock_timestamp()
      where id=m.id returning * into m;
    return to_jsonb(m);
  end if;
  if p_action='fail' then
    if p_error not in ('FAILED_RETRYABLE','BLOCKED_CHANGED_SOURCE','BLOCKED_PROTECTION','BLOCKED_SOURCE_INTEGRITY','BLOCKED_DESTINATION_CONFLICT','ROLLBACK_REQUIRED') or p_error is null then raise exception 'Invalid migration error code'; end if;
    -- Never undo a committed switch because its HTTP acknowledgement was lost.
    next_state:=case when m.switched_at is not null and m.rolled_back_at is null then 'ROLLBACK_REQUIRED' else p_error end;
    if m.state in ('SOURCE_PRESERVED','ROLLED_BACK') then return to_jsonb(m); end if;
  else
    perform public.evidence_migration_assert_safe(p_bundle);
    if s is distinct from (case when m.switched_at is not null and m.rolled_back_at is null then m.destination_snapshot else m.source_snapshot end) then raise exception 'BLOCKED_CHANGED_SOURCE'; end if;
    if p_action='copy' and m.switched_at is null then next_state:='COPYING';
    elsif p_action='verify' and m.switched_at is null then
      perform public.evidence_migration_assert_proof(m,p_proof); next_state:='DESTINATION_VERIFIED';
    elsif p_action='switch' then
      if m.state in ('METADATA_SWITCHED','SOURCE_PRESERVED') then return to_jsonb(m); end if;
      if m.state<>'DESTINATION_VERIFIED' or m.switched_at is not null then raise exception 'Destination has not been verified'; end if;
      perform public.evidence_migration_assert_proof(m,p_proof);
      perform set_config('inssa.evidence_migration',m.id::text,true);
      update public.evidence_bundles set storage_backend='spaces',storage_bucket=m.destination_bucket where id=p_bundle;
      update public.evidence_items set storage_backend='spaces',storage_bucket=m.destination_bucket where bundle_id=p_bundle;
      get diagnostics n=row_count;
      if n<>m.item_count or public.evidence_migration_snapshot(p_bundle) is distinct from m.destination_snapshot then raise exception 'Atomic migration snapshot mismatch'; end if;
      perform set_config('inssa.evidence_migration','',true);
      next_state:='METADATA_SWITCHED';
    elsif p_action='preserve' and m.switched_at is not null and m.rolled_back_at is null then
      perform public.evidence_migration_assert_proof(m,p_proof); next_state:='SOURCE_PRESERVED';
    elsif p_action='rollback' and m.switched_at is not null then
      if m.state='ROLLED_BACK' then return to_jsonb(m); end if;
      perform public.evidence_migration_assert_proof(m,p_proof);
      perform set_config('inssa.evidence_migration',m.id::text,true);
      update public.evidence_bundles set storage_backend=m.source_snapshot->'bundle'->>'storage_backend',
        storage_bucket=m.source_snapshot->'bundle'->>'storage_bucket' where id=p_bundle;
      for i in select value from jsonb_array_elements(m.source_snapshot->'items') loop
        update public.evidence_items set storage_backend=i->>'storage_backend',storage_bucket=i->>'storage_bucket' where id=(i->>'id')::uuid and bundle_id=p_bundle;
        get diagnostics n=row_count; if n<>1 then raise exception 'Rollback item missing'; end if;
      end loop;
      if public.evidence_migration_snapshot(p_bundle) is distinct from m.source_snapshot then raise exception 'Atomic rollback snapshot mismatch'; end if;
      perform set_config('inssa.evidence_migration','',true); next_state:='ROLLED_BACK';
    else raise exception 'Invalid migration transition'; end if;
  end if;
  update public.evidence_storage_migrations set state=next_state,proof=coalesce(p_proof,proof),error_code=case when p_action='fail' then p_error else null end,
    verified_at=case when next_state='DESTINATION_VERIFIED' then clock_timestamp() else verified_at end,
    switched_at=case when next_state='METADATA_SWITCHED' then clock_timestamp() else switched_at end,
    preserved_at=case when next_state='SOURCE_PRESERVED' then clock_timestamp() else preserved_at end,
    rolled_back_at=case when next_state='ROLLED_BACK' then clock_timestamp() else rolled_back_at end,
    updated_at=clock_timestamp(),history=history||jsonb_build_array(jsonb_build_object('state',next_state,'at',clock_timestamp(),'owner',p_owner))
    where id=m.id returning * into m;
  return to_jsonb(m);
end;
$$;

create function public.evidence_migration_write_gate()
returns trigger language plpgsql security invoker set search_path='' as $$
declare bid uuid; m public.evidence_storage_migrations;
begin
  perform pg_advisory_xact_lock(9042102);
  if tg_table_name='evidence_bundles' then bid:=coalesce(new.id,old.id); else bid:=coalesce(new.bundle_id,old.bundle_id); end if;
  select * into m from public.evidence_storage_migrations where bundle_id=bid;
  if m.id is null then return coalesce(new,old); end if;
  if tg_table_name='retention_deletions' then
    if m.state not in ('SOURCE_PRESERVED','ROLLED_BACK') or m.lease_until>clock_timestamp() then raise exception 'Migration reserves this bundle'; end if;
  elsif coalesce(current_setting('inssa.evidence_migration',true),'')<>m.id::text then
    if m.state not in ('SOURCE_PRESERVED','ROLLED_BACK') and (tg_op<>'UPDATE' or to_jsonb(new) is distinct from to_jsonb(old)) then raise exception 'Migration reserves immutable evidence'; end if;
    if tg_op='UPDATE' and (new.storage_backend is distinct from old.storage_backend or new.storage_bucket is distinct from old.storage_bucket) then raise exception 'Only dedicated migration may switch evidence provider'; end if;
  end if;
  return coalesce(new,old);
end;
$$;
create trigger migration_serialize_ledger before insert or update or delete on public.evidence_storage_migrations for each statement execute function public.retention_serialize_write();
create trigger migration_serialize_deletion before insert or update on public.retention_deletions for each statement execute function public.retention_serialize_write();
create trigger migration_gate_deletion before insert or update on public.retention_deletions for each row execute function public.evidence_migration_write_gate();
create trigger migration_gate_bundles before insert or update or delete on public.evidence_bundles for each row execute function public.evidence_migration_write_gate();
create trigger migration_gate_items before insert or update or delete on public.evidence_items for each row execute function public.evidence_migration_write_gate();

-- Preserve the old reader's resource names and add a ledger resource to the same revision.
create or replace view public.retention_source_rows with (security_invoker = true) as
  select 'policies'::text as resource,t.id::text as id,to_jsonb(t) as data from public.retention_policies t
  union all select 'holds',t.id::text,to_jsonb(t) from public.retention_holds t
  union all select 'runs',t.id::text,to_jsonb(t)-'requested_by' from public.campaign_runs t
  union all select 'bundles',t.id::text,to_jsonb(t) from public.evidence_bundles t where t.status<>'expired'
  union all select 'items',t.id::text,to_jsonb(t) from public.evidence_items t join public.evidence_bundles b on b.id=t.bundle_id where b.status<>'expired'
  union all select 'cleanup',t.id::text,to_jsonb(t) from public.cleanup_ledger t
  union all select 'deletions',t.id::text,to_jsonb(t) from public.retention_deletions t where t.status<>'deleted'
  union all select 'migrations',t.id::text,to_jsonb(t) from public.evidence_storage_migrations t
  union all select 'objects',t.id::text,jsonb_build_object('id',t.id,'name',t.name,'size_bytes',t.metadata->'size','created_at',t.created_at,'updated_at',t.updated_at)
    from storage.objects t where t.bucket_id='inssa-evidence';
create or replace function public.retention_read_page(p_resource text,p_offset integer default 0,p_limit integer default 500)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_resource not in ('policies','holds','runs','bundles','items','cleanup','objects','deletions','migrations') or
    p_resource is null or p_offset is null or p_limit is null or p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Invalid retention read page'; end if;
  select coalesce(jsonb_agg(page.data order by page.id),'[]'::jsonb) into result from (
    select id,data from public.retention_source_rows where resource=p_resource order by id limit p_limit offset p_offset) page;
  return jsonb_build_object('rows',result);
end;
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'evidence_migration_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
