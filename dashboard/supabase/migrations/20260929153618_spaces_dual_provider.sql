-- Phase 2 source only. Apply before deploying dual-provider code; no data/object migration.
-- Metadata remains in Supabase. Existing NULL bucket means inssa-evidence.
alter table public.evidence_bundles add column storage_bucket text;
alter table public.evidence_items add column storage_bucket text;
alter table public.evidence_bundles drop constraint evidence_bundles_storage_backend_check;
alter table public.evidence_items drop constraint evidence_items_storage_backend_check;
alter table public.evidence_bundles add constraint evidence_bundles_storage_backend_check check(storage_backend in ('local-filesystem','supabase-storage','spaces'));
alter table public.evidence_bundles add constraint evidence_bundles_storage_bucket_check check((storage_backend <> 'spaces' or storage_bucket is not null) and (storage_bucket is null or storage_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'));
alter table public.evidence_items add constraint evidence_items_storage_backend_check check(storage_backend in ('local-filesystem','supabase-storage','spaces'));
alter table public.evidence_items add constraint evidence_items_storage_bucket_check check((storage_backend <> 'spaces' or storage_bucket is not null) and (storage_bucket is null or storage_bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'));

-- Availability updates are atomic and preserve original evidence identities and Storage keys.
-- No retention/deletion behavior is introduced. Service-role callers only.
create or replace function public.publish_inssa_evidence(
  p_run_id uuid, p_bundle jsonb, p_items jsonb,
  p_job_id uuid default null, p_worker_id text default null
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  b public.evidence_bundles;
  old_b public.evidence_bundles;
  i public.evidence_items;
  old_i public.evidence_items;
  job public.execution_jobs;
  campaign public.campaign_runs;
  manifest jsonb;
  upload_fields text[] := array['storage_bucket','storage_backend','storage_prefix','storage_key','upload_status','uploaded_at','upload_error','schema_version'];
begin
  -- Serialize all publications for this run, including an initial publication with no bundle row yet.
  select * into strict campaign from public.campaign_runs where id = p_run_id for update;
  select * into job from public.execution_jobs where run_id = p_run_id for update;
  if p_job_id is not null then
    if job.id is distinct from p_job_id or job.claimed_by is distinct from p_worker_id or
       job.status not in ('claimed','running') or job.lease_expires_at is null or job.lease_expires_at <= pg_catalog.clock_timestamp() then
      raise exception 'Evidence publication requires a current execution lease';
    end if;
  elsif campaign.status not in ('passed','passed_with_warnings','failed','timed_out','failed_startup','cancelled') or
        job.status in ('queued','claimed','running') then
    raise exception 'Historical evidence publication requires an inactive terminal run';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then raise exception 'Invalid evidence items'; end if;
  if p_bundle is null or p_bundle = 'null'::jsonb then
    if pg_catalog.jsonb_array_length(p_items) <> 0 or exists(select 1 from public.evidence_bundles where run_id=p_run_id) then
      raise exception 'Cannot remove existing evidence';
    end if;
    return;
  end if;
  b := pg_catalog.jsonb_populate_record(null::public.evidence_bundles, '{"schema_version":1}'::jsonb || p_bundle);
  if b.run_id is distinct from p_run_id or b.campaign_key is distinct from campaign.campaign_key or
     b.item_count is distinct from pg_catalog.jsonb_array_length(p_items) then raise exception 'Evidence item count or run mismatch'; end if;
  select pg_catalog.jsonb_object_agg(x.relative_path, x.sha256) into manifest
    from pg_catalog.jsonb_populate_recordset(null::public.evidence_items, p_items) x;
  if b.checksum_manifest is distinct from coalesce(manifest,'{}'::jsonb) or b.total_bytes is distinct from
      (select coalesce(sum(x.size_bytes),0) from pg_catalog.jsonb_populate_recordset(null::public.evidence_items, p_items) x) or
     b.item_count <> (select count(distinct x.id) from pg_catalog.jsonb_populate_recordset(null::public.evidence_items, p_items) x) or
     b.item_count <> (select count(distinct x.relative_path) from pg_catalog.jsonb_populate_recordset(null::public.evidence_items, p_items) x) then
    raise exception 'Corrupt evidence manifest';
  end if;
  if b.source_artifact_id is not null and not exists(select 1 from public.artifacts where id=b.source_artifact_id and run_id=p_run_id) then
    raise exception 'Evidence source artifact mismatch';
  end if;
  if b.upload_status = 'uploaded' and (b.storage_backend not in ('supabase-storage','spaces') or b.storage_prefix is null or b.uploaded_at is null) then
    raise exception 'Incomplete uploaded bundle';
  end if;
  if exists(select 1 from public.evidence_bundles where id=b.id and run_id<>p_run_id) then raise exception 'Bundle identity belongs to another run'; end if;
  select * into old_b from public.evidence_bundles where run_id=p_run_id;
  if found then
    if (select count(*) from public.evidence_bundles where run_id=p_run_id) <> 1 or
       (pg_catalog.to_jsonb(old_b) - upload_fields) is distinct from (pg_catalog.to_jsonb(b) - upload_fields) or
       (old_b.upload_status='uploaded' and (b.upload_status <> 'uploaded' or b.storage_prefix is distinct from old_b.storage_prefix or b.storage_backend is distinct from old_b.storage_backend or b.storage_bucket is distinct from old_b.storage_bucket)) or
       b.item_count <> (select count(*) from public.evidence_items where bundle_id=old_b.id) then
      raise exception 'Cannot change or downgrade existing evidence';
    end if;
  end if;
  -- All writes in this function roll back together, including a failure in a later item.
  insert into public.evidence_bundles select b.* on conflict (id) do update set
    storage_backend=excluded.storage_backend, storage_bucket=excluded.storage_bucket, storage_prefix=excluded.storage_prefix,
    upload_status=excluded.upload_status, uploaded_at=excluded.uploaded_at, upload_error=excluded.upload_error;
  for i in select * from pg_catalog.jsonb_populate_recordset(null::public.evidence_items,p_items) loop
    i.schema_version := 1;
    if i.bundle_id is distinct from b.id or i.run_id is distinct from p_run_id or i.campaign_key is distinct from b.campaign_key or
       i.upload_status is distinct from b.upload_status or i.storage_backend is distinct from b.storage_backend or i.storage_bucket is distinct from b.storage_bucket or
       i.relative_path is null or i.relative_path = '' or i.relative_path ~ '(^/|(^|/)[.][.]?(/|$)|//|/$)' or position(chr(92) in i.relative_path)>0 or
       not exists(select 1 from public.artifacts a where a.id=i.artifact_id and a.run_id=p_run_id and
         a.file_path=i.relative_path and a.file_size=i.size_bytes and a.sha256=i.sha256) then
      raise exception 'Invalid evidence item or artifact';
    end if;
    if b.upload_status='uploaded' and (i.storage_key is distinct from b.storage_prefix || '/' || i.relative_path or i.uploaded_at is null) then
      raise exception 'Incomplete durable evidence item';
    end if;
    select * into old_i from public.evidence_items where id=i.id;
    if found then
      if (pg_catalog.to_jsonb(old_i) - upload_fields - 'metadata') is distinct from (pg_catalog.to_jsonb(i) - upload_fields - 'metadata') or
         (old_i.upload_status='uploaded' and (i.upload_status <> 'uploaded' or i.storage_key is distinct from old_i.storage_key or i.storage_backend is distinct from old_i.storage_backend or i.storage_bucket is distinct from old_i.storage_bucket)) then
        raise exception 'Cannot change immutable evidence item';
      end if;
    elsif old_b.id is not null then raise exception 'Cannot replace existing evidence item identities';
    end if;
    insert into public.evidence_items select i.* on conflict (id) do update set
      storage_backend=excluded.storage_backend, storage_bucket=excluded.storage_bucket, storage_key=excluded.storage_key,
      upload_status=excluded.upload_status, uploaded_at=excluded.uploaded_at, upload_error=excluded.upload_error;
  end loop;
  if p_job_id is not null and job.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'Execution lease expired during evidence publication';
  end if;
end;
$$;
revoke all on function public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text) to service_role;

create or replace function public.retention_reserve_bundle(p_occurrence text,p_owner text,p_revision text,p_bundle uuid,p_signature text,p_plan text,p_objects jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.evidence_bundles; d public.retention_deletions; remaining jsonb; n integer; bytes bigint; o public.retention_occurrences;
begin
  perform pg_advisory_xact_lock(9042102);
  perform public.retention_assert_owner(p_occurrence,p_owner);
  if p_revision is distinct from (public.retention_read_manifest()->>'revision') then raise exception 'Retention snapshot changed'; end if;
  select * into b from public.evidence_bundles where id=p_bundle for update;
  if not found or b.status<>'indexed' or b.upload_status<>'uploaded' or b.storage_backend<>'supabase-storage' or coalesce(b.storage_bucket,'inssa-evidence')<>'inssa-evidence' then raise exception 'Retention bundle unavailable'; end if;
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

create or replace function public.retention_settle_bundle(p_occurrence text,p_owner text,p_bundle uuid,p_success boolean,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.retention_deletions; reclaimed bigint; deleted integer; tombstone jsonb;
begin
  perform pg_advisory_xact_lock(9042102);
  perform public.retention_assert_owner(p_occurrence,p_owner);
  select * into d from public.retention_deletions where bundle_id=p_bundle and occurrence_id=p_occurrence for update;
  if not found then raise exception 'Retention intent missing'; end if;

  if exists(select 1 from public.evidence_bundles where id=p_bundle and (storage_backend<>'supabase-storage' or coalesce(storage_bucket,'inssa-evidence')<>'inssa-evidence')) then raise exception 'Retention provider mismatch'; end if;
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

create or replace function public.retention_reserve_spaces_bundle(p_occurrence text,p_owner text,p_revision text,p_bundle uuid,p_signature text,p_plan text,p_objects jsonb,p_present jsonb,p_checked_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.evidence_bundles; d public.retention_deletions; remaining jsonb; n integer; bytes bigint; o public.retention_occurrences;
begin
  perform pg_advisory_xact_lock(9042102);
  perform public.retention_assert_owner(p_occurrence,p_owner);
  if p_revision is distinct from (public.retention_read_manifest()->>'revision') then raise exception 'Retention snapshot changed'; end if;
  select * into b from public.evidence_bundles where id=p_bundle for update;
  if not found or b.status<>'indexed' or b.upload_status<>'uploaded' or b.storage_backend<>'spaces' or b.storage_bucket is null then raise exception 'Retention bundle unavailable'; end if;
  if not exists(select 1 from public.campaign_runs where id=b.run_id and status in ('passed','passed_with_warnings','failed','failed_startup','timed_out','cancelled') and completed_at is not null) then
    raise exception 'Retention run is not terminal'; end if;
  select * into d from public.retention_deletions where bundle_id=p_bundle for update;
  if found and (d.policy_version<>'evidence-retention-v3' or d.status='deleted' or d.source_signature<>p_signature or d.expected_objects<>p_objects or d.occurrence_id=p_occurrence) then
    raise exception 'Retention intent changed or already attempted'; end if;
  if p_objects is null or jsonb_typeof(p_objects)<>'array' or jsonb_array_length(p_objects)<>b.item_count or b.item_count=0 or
    (select count(distinct x->>'name') from jsonb_array_elements(p_objects) x)<>b.item_count or
    exists(select 1 from jsonb_array_elements(p_objects) x where not exists(select 1 from public.evidence_items i
      where i.bundle_id=b.id and i.storage_key=x->>'name' and i.size_bytes=(x->>'sizeBytes')::bigint)) then raise exception 'Retention exact keys mismatch'; end if;
  if p_checked_at is null or p_checked_at < clock_timestamp()-interval '30 seconds' or p_checked_at > clock_timestamp() or
     p_present is null or jsonb_typeof(p_present)<>'array' or
     exists(select 1 from jsonb_array_elements(p_present) x where not p_objects @> jsonb_build_array(x)) or
     (select count(distinct x->>'name') from jsonb_array_elements(p_present) x)<>jsonb_array_length(p_present) or
     (d.id is null and jsonb_array_length(p_present)<>b.item_count) then raise exception 'Fresh Spaces presence proof required'; end if;
  if exists(select 1 from jsonb_array_elements(p_objects) x where
     x->>'provider' is distinct from 'spaces' or x->>'bucket' is distinct from b.storage_bucket or
     coalesce(x->>'etag','')='' or coalesce(x->>'id','')='' or
     not exists(select 1 from public.evidence_items i where i.bundle_id=b.id and i.storage_key=x->>'name'
       and i.storage_backend='spaces' and i.storage_bucket=b.storage_bucket and i.sha256=x->>'sha256')) then
     raise exception 'Spaces object identity mismatch'; end if;
  remaining:=p_present;
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

create or replace function public.retention_settle_spaces_bundle(p_occurrence text,p_owner text,p_bundle uuid,p_success boolean,p_error text,p_absent jsonb,p_checked_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.retention_deletions; reclaimed bigint; deleted integer; tombstone jsonb;
begin
  perform pg_advisory_xact_lock(9042102);
  perform public.retention_assert_owner(p_occurrence,p_owner);
  select * into d from public.retention_deletions where bundle_id=p_bundle and occurrence_id=p_occurrence for update;
  if not found then raise exception 'Retention intent missing'; end if;
  if d.status<>'deleting' then return jsonb_build_object('status','ALREADY_SETTLED'); end if;
  if not exists(select 1 from public.evidence_bundles where id=p_bundle and storage_backend='spaces' and storage_bucket is not null) then raise exception 'Retention provider mismatch'; end if;
  if p_absent is null or jsonb_typeof(p_absent)<>'array' or
     exists(select 1 from jsonb_array_elements(p_absent) x where not d.expected_objects @> jsonb_build_array(x)) or
     (select count(distinct x->>'name') from jsonb_array_elements(p_absent) x)<>jsonb_array_length(p_absent) or
     (jsonb_array_length(p_absent)>0 and (p_checked_at is null or p_checked_at<clock_timestamp()-interval '30 seconds' or p_checked_at>clock_timestamp())) or
     (p_success and jsonb_array_length(p_absent)<>d.original_object_count) then raise exception 'Fresh Spaces absence proof required'; end if;
  select count(*),coalesce(sum((x->>'sizeBytes')::bigint),0) into deleted,reclaimed from jsonb_array_elements(d.attempt_objects) x
    where p_absent @> jsonb_build_array(x);
  if p_success then
    tombstone:=jsonb_build_object('provider','spaces','bucket',(select storage_bucket from public.evidence_bundles where id=p_bundle),'runId',d.run_id,'bundleId',d.bundle_id,'campaignKey',d.campaign_key,'originalObjectCount',d.original_object_count,
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
    jsonb_build_object('provider','spaces','bucket',(select storage_bucket from public.evidence_bundles where id=p_bundle),'objectsDeleted',deleted,'bytesReclaimed',reclaimed));
  return jsonb_build_object('status',case when p_success then 'deleted' else 'RETENTION_PARTIAL_FAILURE' end,'objectsDeleted',deleted,'bytesReclaimed',reclaimed);
end;
$$;

-- A crashed Spaces owner has no fresh absence proof: preserve intent; reclaim zero until reverified.
create or replace function public.retention_recover_stale()
returns void language plpgsql security invoker set search_path='' as $$
declare o record; d record; n integer; bytes bigint;
begin
  perform pg_advisory_xact_lock(9042102);
  for o in select r.*,j.run_id from public.retention_occurrences r join public.execution_jobs j on j.id=r.job_id
    where r.status='RUNNING' and coalesce(j.lease_expires_at,j.updated_at)+interval '60 seconds'<clock_timestamp()
    for update of r loop
    for d in select * from public.retention_deletions where occurrence_id=o.id and status='deleting' for update loop
      select count(*),coalesce(sum((x->>'sizeBytes')::bigint),0) into n,bytes from jsonb_array_elements(d.attempt_objects) x
        where coalesce(x->>'provider','supabase')='supabase' and not exists(select 1 from storage.objects z where z.bucket_id='inssa-evidence' and z.name=x->>'name');
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
revoke all on function public.retention_reserve_spaces_bundle(text,text,text,uuid,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.retention_reserve_spaces_bundle(text,text,text,uuid,text,text,jsonb,jsonb,timestamptz) to service_role;
revoke all on function public.retention_settle_spaces_bundle(text,text,uuid,boolean,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.retention_settle_spaces_bundle(text,text,uuid,boolean,text,jsonb,timestamptz) to service_role;
