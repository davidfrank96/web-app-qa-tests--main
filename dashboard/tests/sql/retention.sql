-- All fixtures and the tested migration are rolled back by the loopback-only runner.
insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
select 'inssa-evidence', 'retention-fixture/' || n, '{"size":3}', now(), now() from generate_series(1,1203) n;
insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
values ('other-bucket', 'never-included', '{"size":900}', now(), now());

do $$
declare role_name text; relation_name text; function_name text; hold_id uuid; manifest jsonb; after_manifest jsonb;
begin
  foreach relation_name in array array['retention_holds','retention_policies'] loop
    if not (select relrowsecurity from pg_class where oid=('public.' || relation_name)::regclass) then raise exception 'Missing retention RLS'; end if;
  end loop;
  foreach role_name in array array['anon','authenticated'] loop
    foreach relation_name in array array['retention_holds','retention_policies','retention_source_rows'] loop
      if has_table_privilege(role_name,'public.' || relation_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Public retention privilege'; end if;
    end loop;
    foreach function_name in array array['retention_read_manifest()','retention_read_page(text,integer,integer)'] loop
      if has_function_privilege(role_name,'public.' || function_name,'execute') then raise exception 'Public retention RPC'; end if;
    end loop;
  end loop;
  if has_table_privilege('service_role','public.retention_holds','DELETE') or
     has_table_privilege('service_role','public.retention_policies','INSERT,UPDATE,DELETE') then raise exception 'Excess retention write privilege'; end if;
  if exists(select 1 from pg_proc where oid in ('public.retention_read_manifest()'::regprocedure,
    'public.retention_read_page(text,integer,integer)'::regprocedure) and (provolatile <> 's' or prosecdef)) then raise exception 'Read RPC must be STABLE/invoker'; end if;

  set local role service_role;
  insert into public.retention_holds(scope,reason,hold_type,created_by)
    values('global','SQL fixture hold','manual','fixture-admin') returning id into hold_id;
  begin
    update public.retention_holds set status='released', released_by='fixture-admin' where id=hold_id;
    raise exception 'Missing release timestamp accepted';
  exception when check_violation then null; end;
  begin
    update public.retention_holds set reason='rewritten' where id=hold_id;
    raise exception 'Hold provenance was rewritable';
  exception when insufficient_privilege then null; end;
  update public.retention_holds set status='released', released_at=now(), released_by='fixture-admin' where id=hold_id;
  begin
    update public.retention_holds set status='active',released_at=null,released_by=null where id=hold_id;
    raise exception 'Released hold reactivated';
  exception when raise_exception then
    if sqlerrm <> 'Released retention holds are immutable; create a new hold' then raise; end if;
  end;
  manifest := public.retention_read_manifest();
  if jsonb_array_length(public.retention_read_page('objects',0,500)->'rows') <> 500 or
     jsonb_array_length(public.retention_read_page('objects',500,500)->'rows') <> 500 or
     jsonb_array_length(public.retention_read_page('objects',1000,500)->'rows') <> 203 then raise exception 'SQL pagination truncated'; end if;
  if (manifest->'counts'->>'objects')::integer <> 1203 then raise exception 'Other bucket included'; end if;
  if jsonb_array_length(public.retention_read_page('holds')->'rows') <> 1 then raise exception 'Durable hold missing'; end if;
  after_manifest := public.retention_read_manifest();
  if manifest <> after_manifest then raise exception 'Read changed retention metadata or Storage'; end if;
  begin
    perform public.retention_read_page('audit_events'); raise exception 'Audit event access permitted';
  exception when raise_exception then if sqlerrm <> 'Invalid retention read page' then raise; end if; end;
  reset role;
  raise notice 'PASS: durable hold lifecycle, RLS/grants, immutable policy, invoker/stable RPCs, 1203-object pagination, fixed bucket, unchanged read fingerprint';
end;
$$;
