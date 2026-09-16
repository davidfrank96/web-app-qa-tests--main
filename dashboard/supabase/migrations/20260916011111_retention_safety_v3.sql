-- Retention safety correction. This migration NEVER deletes evidence or starts cleanup.
-- Deploy with automatic execution disabled; enable monthly only after release acceptance.
update public.retention_settings set enabled=false,enabled_at=null where id;
alter table public.retention_settings drop constraint retention_settings_schedule_check;
alter table public.retention_settings alter column schedule set default 'MONTHLY DAY 1 01:30 Europe/Dublin';
update public.retention_settings set schedule='MONTHLY DAY 1 01:30 Europe/Dublin' where id;
alter table public.retention_settings add constraint retention_settings_schedule_check check(schedule='MONTHLY DAY 1 01:30 Europe/Dublin');
alter table public.retention_policies add column warning_days integer check(warning_days>=60);
insert into public.retention_policies(id,mode,effective_at,routine_days,warning_days,failure_days,security_days,post_cleanup_days,created_by,description)
values('evidence-retention-v3','enforced',now(),30,60,90,90,30,'migration:retention-safety-v3',
 'Monthly bounded execution, no catch-up. Clean pass 30 days; warning/retry/flaky 60; failure/security 90. Holds, unresolved cleanup and ambiguity remain protected.');
alter table public.retention_deletions drop constraint retention_deletions_policy_version_check;
alter table public.retention_deletions add constraint retention_deletions_policy_version_check check(policy_version in ('evidence-retention-v2','evidence-retention-v3'));
-- Preserve historical v2 tombstones and audit records without rewriting their policy.
drop function public.retention_enable_daily();
drop function public.retention_claim_occurrence(text,text,boolean);

create function public.retention_monthly_occurrence(p_now timestamptz,p_started_at timestamptz,p_enabled_at timestamptz)
returns text language sql immutable security invoker set search_path='' as $$
 select case when p_started_at < scheduled and p_enabled_at < scheduled and
   p_now >= scheduled and p_now < scheduled + interval '1 minute'
 then 'monthly:' || to_char(p_now at time zone 'Europe/Dublin','YYYY-MM') else null end
 from (select (date_trunc('month',p_now at time zone 'Europe/Dublin')+interval '1 hour 30 minutes') at time zone 'Europe/Dublin' as scheduled) x;
$$;

create or replace function public.retention_claim_occurrence(p_id text,p_owner text,p_automatic boolean,p_scheduler_started_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j uuid := gen_random_uuid(); r uuid := gen_random_uuid(); o public.retention_occurrences; total bigint;
begin
  if p_owner is null or length(p_owner)<8 or p_id is null or length(p_id)>150 or
    p_automatic is null or p_id !~ '^(monthly:[0-9]{4}-[0-9]{2}|manual:[a-zA-Z0-9_-]+)$' then raise exception 'Invalid retention occurrence'; end if;
  if p_automatic and (not coalesce((select enabled from public.retention_settings where id),false) or
    p_id is distinct from public.retention_monthly_occurrence(clock_timestamp(),p_scheduler_started_at,
      (select enabled_at from public.retention_settings where id))) then return jsonb_build_object('status','NOT_DUE'); end if;
  if not p_automatic and p_id not like 'manual:%' then raise exception 'Manual occurrence required'; end if;
  perform pg_advisory_xact_lock(9042101);
  -- Recheck after waiting for the mutex: a delayed claim must not catch up.
  if p_automatic and p_id is distinct from public.retention_monthly_occurrence(clock_timestamp(),p_scheduler_started_at,
      (select enabled_at from public.retention_settings where id and enabled)) then return jsonb_build_object('status','NOT_DUE'); end if;
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

create or replace function public.retention_assert_owner(p_occurrence text,p_owner text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.retention_occurrences o join public.execution_jobs j on j.id=o.job_id
    where o.id=p_occurrence and o.owner=p_owner and o.status='RUNNING' and j.status='running' and j.claimed_by=p_owner
    and j.lease_expires_at>clock_timestamp()+interval '45 seconds') then raise exception 'Retention ownership lost'; end if;
  if not exists(select 1 from public.retention_policies where id='evidence-retention-v3' and mode='enforced' and routine_days=30 and warning_days=60 and
    failure_days=90 and security_days=90 and post_cleanup_days=30 and effective_at<=now()) then raise exception 'Retention policy mismatch'; end if;
end;
$$;

create or replace function public.retention_reserve_bundle(p_occurrence text,p_owner text,p_revision text,p_bundle uuid,p_signature text,p_plan text,p_objects jsonb)
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
  if found and (d.policy_version<>'evidence-retention-v3' or d.status='deleted' or d.source_signature<>p_signature or d.expected_objects<>p_objects or d.occurrence_id=p_occurrence) then
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
    values(b.id,b.run_id,b.campaign_key,p_occurrence,'deleting',p_signature,p_objects,remaining,b.item_count,b.total_bytes,'evidence-retention-v3',p_plan)
    on conflict(bundle_id) do update set occurrence_id=excluded.occurrence_id,status='deleting',attempt_objects=excluded.attempt_objects,
      retention_plan_id=excluded.retention_plan_id,error=null,updated_at=now();
  return jsonb_build_object('status','RESERVED','remaining',remaining);
end;
$$;

create or replace function public.retention_health()
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('enabled',s.enabled,'schedule',s.schedule,'policyVersion','evidence-retention-v3',
    'nextScheduledAt',case when current_month.scheduled > now() then current_month.scheduled else
      (date_trunc('month',now() at time zone 'Europe/Dublin')+interval '1 month 1 hour 30 minutes') at time zone 'Europe/Dublin' end,
    'lastExecution',to_jsonb(o),
    'status',case when o.status='RUNNING' then case when j.status='running' and j.lease_expires_at>now() then 'HEALTHY' else 'STALE' end
      when s.enabled and s.enabled_at < current_month.scheduled and now() > current_month.scheduled+interval '10 minutes' and
        not exists(select 1 from public.retention_occurrences where id='monthly:'||to_char(now() at time zone 'Europe/Dublin','YYYY-MM')) then 'STALE'
      else coalesce(o.status,'HEALTHY') end,
    'totalReclaimed',(select coalesce(sum(bytes_reclaimed),0) from public.retention_occurrences))
  from public.retention_settings s
    cross join lateral(select (date_trunc('month',now() at time zone 'Europe/Dublin')+interval '1 hour 30 minutes') at time zone 'Europe/Dublin' as scheduled) current_month
    left join lateral(select * from public.retention_occurrences order by started_at desc limit 1) o on true
    left join public.execution_jobs j on j.id=o.job_id where s.id;
$$;
create function public.retention_enable_monthly(p_policy_version text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_policy_version is distinct from 'evidence-retention-v3' or not exists(select 1 from public.retention_policies where
    id=p_policy_version and mode='enforced' and routine_days=30 and warning_days=60 and failure_days=90 and security_days=90 and post_cleanup_days=30 and effective_at<=now()) then
    raise exception 'Retention v3 policy must be certified before enabling'; end if;
  -- Enabling is configuration only. Neither this function nor deployment claims an occurrence.
  update public.retention_settings set enabled_at=case when enabled then enabled_at else clock_timestamp() end,enabled=true where id;
end;
$$;
create function public.retention_disable_automatic()
returns void language sql security invoker set search_path='' as $$
  update public.retention_settings set enabled=false,enabled_at=null where id;
$$;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
    ('retention_monthly_occurrence','retention_claim_occurrence','retention_assert_owner','retention_reserve_bundle',
     'retention_health','retention_enable_monthly','retention_disable_automatic') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
