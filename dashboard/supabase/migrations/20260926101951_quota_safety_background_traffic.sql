-- One transactional idle round trip. Running campaigns are NEVER automatically retried.
create or replace function public.poll_inssa_execution_job(worker_id text, lease_ms integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  poll_at timestamptz := pg_catalog.clock_timestamp();
  recovered jsonb := '[]'::jsonb;
  selected_job public.execution_jobs;
begin
  if worker_id is null or length(trim(worker_id)) = 0 or lease_ms is null or lease_ms <= 0 then
    raise exception 'Valid worker ownership and lease required';
  end if;
  with expired as (
    select id from public.execution_jobs
    where status in ('claimed', 'running') and lease_expires_at <= poll_at
    for update skip locked
  ), changed as (
    update public.execution_jobs j set
      claimed_by = null, lease_expires_at = null,
      completed_at = case when j.status = 'claimed' and j.attempt < j.max_attempts then null else poll_at end,
      last_error = case when j.status = 'claimed' and j.attempt < j.max_attempts
        then 'Pre-execution worker lease expired; the claim may be retried without overlapping a campaign process.'
        else 'Execution recovery blocked: a running campaign lease expired and automatic retry is unsafe.' end,
      status = case when j.status = 'claimed' and j.attempt < j.max_attempts then 'queued' else 'abandoned' end,
      updated_at = poll_at
    from expired where j.id = expired.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(changed)), '[]'::jsonb) into recovered from changed;

  select * into selected_job from public.execution_jobs
  where status = 'queued' and attempt < max_attempts order by created_at, id
  for update skip locked limit 1;
  if found then
    update public.execution_jobs set attempt = attempt + 1, claimed_at = poll_at,
      claimed_by = worker_id, heartbeat_at = poll_at,
      lease_expires_at = poll_at + pg_catalog.make_interval(secs => lease_ms / 1000.0),
      status = 'claimed', updated_at = poll_at
    where id = selected_job.id returning * into selected_job;
  end if;
  return jsonb_build_object('recovered', recovered, 'job',
    case when selected_job.id is null then null else to_jsonb(selected_job) end);
end $$;
revoke all on function public.poll_inssa_execution_job(text, integer) from public, anon, authenticated;
grant execute on function public.poll_inssa_execution_job(text, integer) to service_role;

-- Keep accumulated counts atomic and refuse a superseded scheduler owner.
create or replace function public.record_scheduler_evaluation(
  scheduler_owner text, evaluated_at timestamptz, states jsonb, evaluated_count integer,
  queued_count integer, evaluation_error text default null
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.scheduler_runtime_status set definition_states = states,
    definitions_evaluated = evaluated_count, heartbeat_at = evaluated_at,
    jobs_queued = jobs_queued + queued_count, last_error = evaluation_error,
    last_evaluation_at = evaluated_at, running = true, updated_at = evaluated_at
  where id = 'primary' and scheduler_id = scheduler_owner and running;
  if not found then raise exception 'Scheduler ownership lost'; end if;
end $$;
revoke all on function public.record_scheduler_evaluation(text, timestamptz, jsonb, integer, integer, text) from public, anon, authenticated;
grant execute on function public.record_scheduler_evaluation(text, timestamptz, jsonb, integer, integer, text) to service_role;

-- Supported database/object metadata only. No billing scraping and no destructive operation.
create or replace function public.qa_usage_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('at', now(), 'databaseBytes', pg_database_size(current_database()),
    'storageBytes', coalesce(sum(case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end), 0),
    'evidenceBytes', coalesce(sum(case when bucket_id = 'inssa-evidence' and (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end), 0),
    'unknownSizeObjects', count(*) filter (where metadata->>'size' is null or not (metadata->>'size') ~ '^[0-9]+$'))
  from storage.objects;
$$;
revoke all on function public.qa_usage_snapshot() from public, anon, authenticated;
grant execute on function public.qa_usage_snapshot() to service_role;
