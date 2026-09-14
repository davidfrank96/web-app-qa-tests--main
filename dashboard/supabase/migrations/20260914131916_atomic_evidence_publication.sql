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
  upload_fields text[] := array['storage_backend','storage_prefix','storage_key','upload_status','uploaded_at','upload_error','schema_version'];
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
  if b.upload_status = 'uploaded' and (b.storage_backend <> 'supabase-storage' or b.storage_prefix is null or b.uploaded_at is null) then
    raise exception 'Incomplete uploaded bundle';
  end if;
  if exists(select 1 from public.evidence_bundles where id=b.id and run_id<>p_run_id) then raise exception 'Bundle identity belongs to another run'; end if;
  select * into old_b from public.evidence_bundles where run_id=p_run_id;
  if found then
    if (select count(*) from public.evidence_bundles where run_id=p_run_id) <> 1 or
       (pg_catalog.to_jsonb(old_b) - upload_fields) is distinct from (pg_catalog.to_jsonb(b) - upload_fields) or
       (old_b.upload_status='uploaded' and (b.upload_status <> 'uploaded' or b.storage_prefix is distinct from old_b.storage_prefix)) or
       b.item_count <> (select count(*) from public.evidence_items where bundle_id=old_b.id) then
      raise exception 'Cannot change or downgrade existing evidence';
    end if;
  end if;
  -- All writes in this function roll back together, including a failure in a later item.
  insert into public.evidence_bundles select b.* on conflict (id) do update set
    storage_backend=excluded.storage_backend, storage_prefix=excluded.storage_prefix,
    upload_status=excluded.upload_status, uploaded_at=excluded.uploaded_at, upload_error=excluded.upload_error;
  for i in select * from pg_catalog.jsonb_populate_recordset(null::public.evidence_items,p_items) loop
    i.schema_version := 1;
    if i.bundle_id is distinct from b.id or i.run_id is distinct from p_run_id or i.campaign_key is distinct from b.campaign_key or
       i.upload_status is distinct from b.upload_status or i.storage_backend is distinct from b.storage_backend or
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
         (old_i.upload_status='uploaded' and (i.upload_status <> 'uploaded' or i.storage_key is distinct from old_i.storage_key)) then
        raise exception 'Cannot change immutable evidence item';
      end if;
    elsif old_b.id is not null then raise exception 'Cannot replace existing evidence item identities';
    end if;
    insert into public.evidence_items select i.* on conflict (id) do update set
      storage_backend=excluded.storage_backend, storage_key=excluded.storage_key,
      upload_status=excluded.upload_status, uploaded_at=excluded.uploaded_at, upload_error=excluded.upload_error;
  end loop;
  if p_job_id is not null and job.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'Execution lease expired during evidence publication';
  end if;
end;
$$;
revoke all on function public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.publish_inssa_evidence(uuid,jsonb,jsonb,uuid,text) to service_role;
