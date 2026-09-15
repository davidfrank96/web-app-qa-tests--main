-- Wave 4. Storage deletion is exclusively through the Storage API, never SQL.
alter table public.retention_policies drop constraint retention_policies_mode_check;
alter table public.retention_policies add constraint retention_policies_mode_check check (mode in ('dry_run_only','enforced'));
alter table public.retention_policies drop constraint retention_policies_routine_days_check;
alter table public.retention_policies add constraint retention_policies_routine_days_check check (routine_days >= 21);
insert into public.retention_policies(id,mode,effective_at,routine_days,failure_days,security_days,post_cleanup_days,created_by,description)
values('evidence-retention-v2','enforced',now(),21,90,90,30,'migration:wave-4',
  'Daily bounded hard deletion of eligible whole bundles. Strongest protection wins. Unknown, held, active and unresolved cleanup remain preserved.');
alter table public.evidence_bundles drop constraint evidence_bundles_status_check;
alter table public.evidence_bundles add constraint evidence_bundles_status_check check(status in ('indexed','expired'));
alter table public.evidence_bundles add column retention_tombstone jsonb;

create table public.retention_settings (
  id boolean primary key default true check(id), enabled boolean not null default false,
  schedule text not null default 'DAILY 01:30 Europe/Dublin' check(schedule='DAILY 01:30 Europe/Dublin'),
  enabled_at timestamptz
);
insert into public.retention_settings(id) values(true);
create table public.retention_occurrences (
  id text primary key, owner text not null, job_id uuid references public.execution_jobs(id) on delete restrict,
  status text not null check(status in ('RUNNING','HEALTHY','SKIPPED_ACTIVE_EXECUTION','PARTIAL_FAILURE','FAILED')),
  started_at timestamptz not null default now(), completed_at timestamptz,
  storage_bytes_before bigint not null default 0, storage_bytes_after bigint,
  bytes_reclaimed bigint not null default 0, objects_deleted integer not null default 0,
  bundles_deleted integer not null default 0, protected_bundles integer not null default 0,
  review_required_bundles integer not null default 0, partial_failures integer not null default 0,
  reserved_bundles integer not null default 0 check(reserved_bundles between 0 and 100),
  reserved_objects integer not null default 0 check(reserved_objects between 0 and 5000),
  reserved_bytes bigint not null default 0 check(reserved_bytes between 0 and 2000000000),
  duration_ms bigint, error text
);
create table public.retention_deletions (
  id uuid primary key default gen_random_uuid(), bundle_id uuid not null unique references public.evidence_bundles(id) on delete restrict,
  run_id uuid not null references public.campaign_runs(id) on delete restrict, campaign_key text not null,
  occurrence_id text not null references public.retention_occurrences(id) on delete restrict,
  status text not null check(status in ('deleting','RETENTION_PARTIAL_FAILURE','deleted')),
  source_signature text not null check(source_signature ~ '^[a-f0-9]{64}$'),
  expected_objects jsonb not null, attempt_objects jsonb not null default '[]',
  original_object_count integer not null, original_byte_count bigint not null,
  policy_version text not null check(policy_version='evidence-retention-v2'), retention_plan_id text not null,
  deletion_reason text not null default 'ELIGIBLE: strongest retention rule expired',
  verification_status text, deleted_at timestamptz, error text, updated_at timestamptz not null default now()
);
create index retention_deletions_occurrence_idx on public.retention_deletions(occurrence_id);
create index retention_deletions_run_idx on public.retention_deletions(run_id);
create index retention_occurrences_started_idx on public.retention_occurrences(started_at desc);
create index retention_occurrences_job_idx on public.retention_occurrences(job_id);
create table public.retention_audit (
  id uuid primary key default gen_random_uuid(), bundle_id uuid not null references public.evidence_bundles(id) on delete restrict,
  occurrence_id text not null references public.retention_occurrences(id) on delete restrict,
  created_at timestamptz not null default now(), event jsonb not null
);
create index retention_audit_bundle_idx on public.retention_audit(bundle_id);
create index retention_audit_occurrence_idx on public.retention_audit(occurrence_id);
alter table public.retention_settings enable row level security;
alter table public.retention_occurrences enable row level security;
alter table public.retention_deletions enable row level security;
alter table public.retention_audit enable row level security;
revoke all on public.retention_settings,public.retention_occurrences,public.retention_deletions,public.retention_audit from public,anon,authenticated,service_role;
grant select,update on public.retention_settings to service_role;
grant select,insert,update on public.retention_occurrences,public.retention_deletions to service_role;
grant select,insert on public.retention_audit to service_role;

create or replace view public.retention_source_rows with (security_invoker = true) as
  select 'policies'::text as resource,t.id::text as id,to_jsonb(t) as data from public.retention_policies t
  union all select 'holds',t.id::text,to_jsonb(t) from public.retention_holds t
  union all select 'runs',t.id::text,to_jsonb(t)-'requested_by' from public.campaign_runs t
  union all select 'bundles',t.id::text,to_jsonb(t) from public.evidence_bundles t where t.status<>'expired'
  union all select 'items',t.id::text,to_jsonb(t) from public.evidence_items t join public.evidence_bundles b on b.id=t.bundle_id where b.status<>'expired'
  union all select 'cleanup',t.id::text,to_jsonb(t) from public.cleanup_ledger t
  union all select 'deletions',t.id::text,to_jsonb(t) from public.retention_deletions t where t.status<>'deleted'
  union all select 'objects',t.id::text,jsonb_build_object('id',t.id,'name',t.name,'size_bytes',t.metadata->'size','created_at',t.created_at,'updated_at',t.updated_at)
    from storage.objects t where t.bucket_id='inssa-evidence';
create or replace function public.retention_read_page(p_resource text,p_offset integer default 0,p_limit integer default 500)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_resource not in ('policies','holds','runs','bundles','items','cleanup','objects','deletions') or
    p_resource is null or p_offset is null or p_limit is null or p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'Invalid retention read page'; end if;
  select coalesce(jsonb_agg(page.data order by page.id),'[]'::jsonb) into result from (
    select id,data from public.retention_source_rows where resource=p_resource order by id limit p_limit offset p_offset) page;
  return jsonb_build_object('rows',result);
end;
$$;

-- Recover a crashed owner only after its lease plus the bounded Storage-request grace.
-- Its occurrence is closed forever. A DIFFERENT occurrence can retry remaining keys.
create function public.retention_recover_stale()
returns void language plpgsql security invoker set search_path='' as $$
declare o record; d record; n integer; bytes bigint;
begin
  perform pg_advisory_xact_lock(9042102);
  for o in select r.*,j.run_id from public.retention_occurrences r join public.execution_jobs j on j.id=r.job_id
    where r.status='RUNNING' and coalesce(j.lease_expires_at,j.updated_at)+interval '60 seconds'<clock_timestamp()
    for update of r loop
    for d in select * from public.retention_deletions where occurrence_id=o.id and status='deleting' for update loop
      select count(*),coalesce(sum((x->>'sizeBytes')::bigint),0) into n,bytes from jsonb_array_elements(d.attempt_objects) x
        where not exists(select 1 from storage.objects z where z.bucket_id='inssa-evidence' and z.name=x->>'name');
      update public.retention_deletions set status='RETENTION_PARTIAL_FAILURE',attempt_objects='[]',error='Owner expired; remaining objects require fresh eligibility.',updated_at=now() where id=d.id;
      update public.retention_occurrences set bytes_reclaimed=bytes_reclaimed+bytes,objects_deleted=objects_deleted+n,partial_failures=partial_failures+1 where id=o.id;
      insert into public.retention_audit(bundle_id,occurrence_id,event) values(d.bundle_id,o.id,
        jsonb_build_object('status','RETENTION_PARTIAL_FAILURE','reason','OWNER_EXPIRED','objectsDeleted',n,'bytesReclaimed',bytes));
    end loop;
    update public.retention_occurrences set status='FAILED',completed_at=now(),error='Owner expired; occurrence will not be replayed.',
      duration_ms=extract(epoch from(now()-started_at))*1000,
      storage_bytes_after=(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id='inssa-evidence') where id=o.id;
    update public.execution_jobs set status='abandoned',lease_expires_at=null,completed_at=now(),updated_at=now() where id=o.job_id;
    update public.campaign_runs set status='failed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=o.run_id;
  end loop;
end;
$$;

-- The global execution_jobs_one_active index also owns maintenance. A running maintenance
-- job cannot be claimed by a campaign worker; max_attempts=1 prevents crash replay.
create function public.retention_claim_occurrence(p_id text,p_owner text,p_automatic boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j uuid := gen_random_uuid(); r uuid := gen_random_uuid(); o public.retention_occurrences; total bigint;
begin
  if length(p_owner)<8 or length(p_id)>150 or p_id !~ '^(daily:[0-9]{4}-[0-9]{2}-[0-9]{2}|manual:[a-zA-Z0-9_-]+)$' then raise exception 'Invalid retention occurrence'; end if;
  if p_automatic and (not (select enabled from public.retention_settings where id) or
    (select enabled_at from public.retention_settings where id) > ((date_trunc('day',now() at time zone 'Europe/Dublin')+interval '1 hour 30 minutes') at time zone 'Europe/Dublin') or
    p_id <> 'daily:' || to_char(now() at time zone 'Europe/Dublin','YYYY-MM-DD') or
    (now() at time zone 'Europe/Dublin')::time < time '01:30') then return jsonb_build_object('status','NOT_DUE'); end if;
  if not p_automatic and p_id not like 'manual:%' then raise exception 'Manual occurrence required'; end if;
  perform pg_advisory_xact_lock(9042101);
  perform public.retention_recover_stale();
  select * into o from public.retention_occurrences where id=p_id;
  if found then return jsonb_build_object('status','ALREADY_RECORDED','occurrence',to_jsonb(o)); end if;
  select coalesce(sum((metadata->>'size')::bigint),0) into total from storage.objects where bucket_id='inssa-evidence';
  insert into public.retention_occurrences(id,owner,status,storage_bytes_before) values(p_id,p_owner,'RUNNING',total);
  begin
    if exists(select 1 from public.campaign_runs where status in ('queued','starting','running','indexing_artifacts')) or
       exists(select 1 from public.execution_jobs where status in ('queued','claimed','running')) then raise unique_violation; end if;
    insert into public.campaign_runs(id,campaign_key,status,created_at,updated_at,started_at,requested_by,command_snapshot)
      values(r,'retention_maintenance','running',now(),now(),now(),'retention-maintenance',
        '{"key":"retention_maintenance","displayName":"Evidence retention","commandType":"campaign","npmScript":"retention:execute","riskLevel":"read_only","mutatesStaging":false,"producesReports":false,"producesFindings":false,"phase1Enabled":false,"timeoutMs":1800000}');
    insert into public.execution_jobs(id,run_id,campaign_key,idempotency_key,status,attempt,max_attempts,claimed_by,claimed_at,heartbeat_at,lease_expires_at,created_at,updated_at)
      values(j,r,'retention_maintenance','retention:'||p_id,'running',1,1,p_owner,now(),now(),now()+interval '120 seconds',now(),now());
    update public.retention_occurrences set job_id=j where id=p_id;
  exception when unique_violation then
    update public.retention_occurrences set status='SKIPPED_ACTIVE_EXECUTION',completed_at=now(),duration_ms=0,storage_bytes_after=total where id=p_id;
  end;
  select * into o from public.retention_occurrences where id=p_id;
  return jsonb_build_object('status',o.status,'jobId',o.job_id,'occurrenceId',o.id);
end;
$$;

create function public.retention_assert_owner(p_occurrence text,p_owner text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.retention_occurrences o join public.execution_jobs j on j.id=o.job_id
    where o.id=p_occurrence and o.owner=p_owner and o.status='RUNNING' and j.status='running' and j.claimed_by=p_owner
    and j.lease_expires_at>clock_timestamp()+interval '45 seconds') then raise exception 'Retention ownership lost'; end if;
  if not exists(select 1 from public.retention_policies where id='evidence-retention-v2' and mode='enforced' and routine_days=21 and
    failure_days=90 and security_days=90 and post_cleanup_days=30 and effective_at<=now()) then raise exception 'Retention policy mismatch'; end if;
end;
$$;
create function public.retention_heartbeat(p_occurrence text,p_owner text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform public.retention_assert_owner(p_occurrence,p_owner);
  update public.execution_jobs set heartbeat_at=now(),lease_expires_at=now()+interval '120 seconds',updated_at=now()
    where id=(select job_id from public.retention_occurrences where id=p_occurrence);
end;
$$;

-- Safety-state changes serialize with reserve, then reject while an irreversible deletion
-- is in flight. After a failed attempt/lease expires, a new hold can protect all remaining keys.
create function public.retention_safety_gate()
returns trigger language plpgsql security invoker set search_path='' as $$
declare affected_run uuid; finalizing boolean := coalesce(current_setting('inssa.retention_finalizing',true),'')='yes';
begin
  perform pg_advisory_xact_lock(9042102);
  if finalizing then return coalesce(new,old); end if;
  if tg_table_name in ('evidence_bundles','evidence_items','artifacts') then
    affected_run := coalesce(new.run_id,old.run_id);
    if exists(select 1 from public.evidence_bundles where run_id=affected_run and status='expired') then
      raise exception 'Evidence expired under retention policy; publication is forbidden'; end if;
  elsif tg_table_name='campaign_runs' then affected_run:=coalesce(new.id,old.id); end if;
  if exists(select 1 from public.retention_deletions d join public.retention_occurrences o on o.id=d.occurrence_id
    join public.execution_jobs j on j.id=o.job_id where d.status='deleting' and
    j.lease_expires_at+interval '60 seconds'>clock_timestamp() and (affected_run is null or d.run_id=affected_run)) then
    raise exception 'Retention deletion in progress; retry safety-state change';
  end if;
  return coalesce(new,old);
end;
$$;
-- Take the advisory lock before row locks, avoiding a writer/finalizer lock-order cycle.
create function public.retention_serialize_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin perform pg_advisory_xact_lock(9042102); return null; end;
$$;
create trigger retention_serialize_holds before insert or update or delete on public.retention_holds for each statement execute function public.retention_serialize_write();
create trigger retention_serialize_cleanup before insert or update or delete on public.cleanup_ledger for each statement execute function public.retention_serialize_write();
create trigger retention_serialize_runs before update or delete on public.campaign_runs for each statement execute function public.retention_serialize_write();
create trigger retention_serialize_bundles before insert or update or delete on public.evidence_bundles for each statement execute function public.retention_serialize_write();
create trigger retention_serialize_items before insert or update or delete on public.evidence_items for each statement execute function public.retention_serialize_write();
create trigger retention_serialize_artifacts before insert or update or delete on public.artifacts for each statement execute function public.retention_serialize_write();
create trigger retention_gate_holds before insert or update or delete on public.retention_holds for each row execute function public.retention_safety_gate();
create trigger retention_gate_cleanup before insert or update or delete on public.cleanup_ledger for each row execute function public.retention_safety_gate();
create trigger retention_gate_runs before update or delete on public.campaign_runs for each row execute function public.retention_safety_gate();
create trigger retention_gate_bundles before insert or update or delete on public.evidence_bundles for each row execute function public.retention_safety_gate();
create trigger retention_gate_items before insert or update or delete on public.evidence_items for each row execute function public.retention_safety_gate();
create trigger retention_gate_artifacts before insert or update or delete on public.artifacts for each row execute function public.retention_safety_gate();

create function public.retention_reserve_bundle(p_occurrence text,p_owner text,p_revision text,p_bundle uuid,p_signature text,p_plan text,p_objects jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.evidence_bundles; d public.retention_deletions; remaining jsonb; n integer; bytes bigint; o public.retention_occurrences;
begin
  perform pg_advisory_xact_lock(9042102);
  perform public.retention_assert_owner(p_occurrence,p_owner);
  if p_revision is distinct from (public.retention_read_manifest()->>'revision') then raise exception 'Retention snapshot changed'; end if;
  select * into b from public.evidence_bundles where id=p_bundle for update;
  if not found or b.status<>'indexed' or b.upload_status<>'uploaded' then raise exception 'Retention bundle unavailable'; end if;
  if not exists(select 1 from public.campaign_runs where id=b.run_id and status in ('passed','passed_with_warnings','failed','failed_startup','timed_out','cancelled') and completed_at is not null) then
    raise exception 'Retention run is not terminal'; end if;
  select * into d from public.retention_deletions where bundle_id=p_bundle for update;
  if found and (d.status='deleted' or d.source_signature<>p_signature or d.expected_objects<>p_objects or d.occurrence_id=p_occurrence) then
    raise exception 'Retention intent changed or already attempted'; end if;
  if p_objects is null or jsonb_typeof(p_objects)<>'array' or jsonb_array_length(p_objects)<>b.item_count or b.item_count=0 or
    (select count(distinct x->>'name') from jsonb_array_elements(p_objects) x)<>b.item_count or
    exists(select 1 from jsonb_array_elements(p_objects) x where not exists(select 1 from public.evidence_items i
      where i.bundle_id=b.id and i.storage_key=x->>'name' and i.size_bytes=(x->>'sizeBytes')::bigint)) then raise exception 'Retention exact keys mismatch'; end if;
  if d.id is null and exists(select 1 from jsonb_array_elements(p_objects) x where not exists(select 1 from storage.objects s
    where s.bucket_id='inssa-evidence' and s.name=x->>'name' and s.id=(x->>'id')::uuid and (s.metadata->>'size')::bigint=(x->>'sizeBytes')::bigint)) then
    raise exception 'Unexpected absent evidence'; end if;
  select coalesce(jsonb_agg(x),'[]') into remaining from jsonb_array_elements(p_objects) x where exists(
    select 1 from storage.objects s where s.bucket_id='inssa-evidence' and s.name=x->>'name');
  n:=jsonb_array_length(remaining); select coalesce(sum((x->>'sizeBytes')::bigint),0) into bytes from jsonb_array_elements(remaining) x;
  select * into o from public.retention_occurrences where id=p_occurrence for update;
  if o.reserved_bundles+1>100 or o.reserved_objects+n>5000 or o.reserved_bytes+bytes>2000000000 then return jsonb_build_object('status','BUDGET_REACHED'); end if;
  update public.retention_occurrences set reserved_bundles=reserved_bundles+1,reserved_objects=reserved_objects+n,reserved_bytes=reserved_bytes+bytes where id=p_occurrence;
  insert into public.retention_deletions(bundle_id,run_id,campaign_key,occurrence_id,status,source_signature,expected_objects,attempt_objects,
    original_object_count,original_byte_count,policy_version,retention_plan_id)
    values(b.id,b.run_id,b.campaign_key,p_occurrence,'deleting',p_signature,p_objects,remaining,b.item_count,b.total_bytes,'evidence-retention-v2',p_plan)
    on conflict(bundle_id) do update set occurrence_id=excluded.occurrence_id,status='deleting',attempt_objects=excluded.attempt_objects,
      retention_plan_id=excluded.retention_plan_id,error=null,updated_at=now();
  return jsonb_build_object('status','RESERVED','remaining',remaining);
end;
$$;

create function public.retention_settle_bundle(p_occurrence text,p_owner text,p_bundle uuid,p_success boolean,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.retention_deletions; reclaimed bigint; deleted integer; tombstone jsonb;
begin
  perform pg_advisory_xact_lock(9042102);
  perform public.retention_assert_owner(p_occurrence,p_owner);
  select * into d from public.retention_deletions where bundle_id=p_bundle and occurrence_id=p_occurrence for update;
  if not found then raise exception 'Retention intent missing'; end if;
  if d.status<>'deleting' then return jsonb_build_object('status','ALREADY_SETTLED'); end if;
  if p_success and exists(select 1 from storage.objects s join jsonb_array_elements(d.expected_objects) x on s.name=x->>'name'
    where s.bucket_id='inssa-evidence') then raise exception 'Storage absence not verified'; end if;
  select count(*),coalesce(sum((x->>'sizeBytes')::bigint),0) into deleted,reclaimed from jsonb_array_elements(d.attempt_objects) x
    where not exists(select 1 from storage.objects s where s.bucket_id='inssa-evidence' and s.name=x->>'name');
  if p_success then
    tombstone:=jsonb_build_object('runId',d.run_id,'bundleId',d.bundle_id,'campaignKey',d.campaign_key,'originalObjectCount',d.original_object_count,
      'originalByteCount',d.original_byte_count,'deletedAt',now(),'policyVersion',d.policy_version,'retentionPlanId',d.retention_plan_id,
      'deletionReason',d.deletion_reason,'verificationStatus','ABSENCE_VERIFIED');
    tombstone := tombstone || jsonb_build_object('authenticationMonitoringResult',
      (select (i.metadata->'authenticationMonitoringResult') - 'evidenceReferences' from public.evidence_items i
        where i.bundle_id=d.bundle_id and i.metadata->'authenticationMonitoringResult'->>'runId'=d.run_id::text
        order by i.relative_path limit 1));
    perform set_config('inssa.retention_finalizing','yes',true);
    update public.evidence_bundles set status='expired',retention_tombstone=tombstone,item_count=0,total_bytes=0,checksum_manifest='{}',
      source_artifact_id=null,storage_prefix=null where id=d.bundle_id;
    -- Preserve rare item references in historical released holds; prune all unreferenced heavy rows.
    delete from public.evidence_items i where i.bundle_id=d.bundle_id and not exists(select 1 from public.retention_holds h where h.item_id=i.id);
    update public.evidence_items set metadata='{}' where bundle_id=d.bundle_id;
    delete from public.artifacts a where a.run_id=d.run_id and not exists(select 1 from public.evidence_items i where i.artifact_id=a.id)
      and not exists(select 1 from public.evidence_bundles b where b.source_artifact_id=a.id);
    update public.campaign_runs set updated_at=now() where id=d.run_id;
    perform set_config('inssa.retention_finalizing','no',true);
  end if;
  update public.retention_deletions set status=case when p_success then 'deleted' else 'RETENTION_PARTIAL_FAILURE' end,
    expected_objects=case when p_success then '[]'::jsonb else expected_objects end,attempt_objects='[]',
    deleted_at=case when p_success then now() else null end,verification_status=case when p_success then 'ABSENCE_VERIFIED' else 'PARTIAL' end,
    error=left(p_error,500),updated_at=now() where id=d.id;
  update public.retention_occurrences set bytes_reclaimed=bytes_reclaimed+reclaimed,objects_deleted=objects_deleted+deleted,
    bundles_deleted=bundles_deleted+case when p_success then 1 else 0 end,partial_failures=partial_failures+case when p_success then 0 else 1 end where id=p_occurrence;
  insert into public.retention_audit(bundle_id,occurrence_id,event) values(d.bundle_id,p_occurrence,
    coalesce(tombstone,jsonb_build_object('status','RETENTION_PARTIAL_FAILURE','policyVersion',d.policy_version,'retentionPlanId',d.retention_plan_id)) ||
    jsonb_build_object('objectsDeleted',deleted,'bytesReclaimed',reclaimed));
  return jsonb_build_object('status',case when p_success then 'deleted' else 'RETENTION_PARTIAL_FAILURE' end,'objectsDeleted',deleted,'bytesReclaimed',reclaimed);
end;
$$;

create function public.retention_finish_occurrence(p_occurrence text,p_owner text,p_error text,p_protected integer,p_review integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.retention_occurrences; run uuid; result text;
begin
  perform pg_advisory_xact_lock(9042102);
  perform public.retention_assert_owner(p_occurrence,p_owner);
  select * into o from public.retention_occurrences where id=p_occurrence for update;
  if exists(select 1 from public.retention_deletions where occurrence_id=p_occurrence and status='deleting') then raise exception 'Unsettled retention deletion'; end if;
  result:=case when o.partial_failures>0 then 'PARTIAL_FAILURE' when p_error is not null then 'FAILED' else 'HEALTHY' end;
  update public.retention_occurrences set status=result,completed_at=now(),duration_ms=extract(epoch from(now()-started_at))*1000,
    storage_bytes_after=(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id='inssa-evidence'),
    protected_bundles=p_protected,review_required_bundles=p_review,error=left(p_error,500) where id=p_occurrence returning * into o;
  update public.execution_jobs set status=case when result='HEALTHY' then 'completed' else 'failed' end,completed_at=now(),lease_expires_at=null,updated_at=now(),last_error=p_error
    where id=o.job_id returning run_id into run;
  update public.campaign_runs set status=case when result='HEALTHY' then 'passed' else 'failed' end,completed_at=now(),updated_at=now(),duration_ms=o.duration_ms,
    exit_code=case when result='HEALTHY' then 0 else 1 end where id=run;
  insert into public.audit_events(id,run_id,event_type,campaign_key,status,metadata,created_at) values(gen_random_uuid(),run,
    case when result='HEALTHY' then 'run_completed' else 'run_failed' end,'retention_maintenance',result,to_jsonb(o),now());
  return to_jsonb(o);
end;
$$;

create function public.retention_health()
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('enabled',s.enabled,'schedule',s.schedule,'lastExecution',to_jsonb(o),
    'status',case when o.status='RUNNING' then case when j.status='running' and j.lease_expires_at>now() then 'HEALTHY' else 'STALE' end
      when s.enabled and (o.id is null or o.started_at<now()-interval '26 hours') then 'STALE' else coalesce(o.status,'STALE') end,
    'totalReclaimed',(select coalesce(sum(bytes_reclaimed),0) from public.retention_occurrences))
  from public.retention_settings s left join lateral(select * from public.retention_occurrences order by started_at desc limit 1) o on true
    left join public.execution_jobs j on j.id=o.job_id where s.id;
$$;
create function public.retention_enable_daily()
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.retention_occurrences where id like 'manual:%' and status='HEALTHY') then raise exception 'Controlled initial execution must succeed first'; end if;
  update public.retention_settings set enabled=true,enabled_at=coalesce(enabled_at,now()) where id;
end;
$$;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('retention_recover_stale','retention_claim_occurrence','retention_assert_owner','retention_heartbeat','retention_safety_gate','retention_reserve_bundle',
     'retention_serialize_write','retention_settle_bundle','retention_finish_occurrence','retention_health','retention_enable_daily') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
