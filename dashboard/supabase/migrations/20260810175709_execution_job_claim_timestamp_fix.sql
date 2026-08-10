create or replace function public.claim_inssa_execution_job(worker_id text, lease_ms integer)
returns setof public.execution_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  update public.execution_jobs
  set
    claimed_by = null,
    lease_expires_at = null,
    last_error = 'Worker lease expired before completion.',
    status = case when attempt < max_attempts then 'queued' else 'abandoned' end,
    updated_at = v_now
  where status in ('claimed', 'running')
    and lease_expires_at < v_now;

  select id into selected_id
  from public.execution_jobs
  where status = 'queued' and attempt < max_attempts
  order by created_at
  for update skip locked
  limit 1;

  if selected_id is null then
    return;
  end if;

  return query
  update public.execution_jobs
  set
    attempt = attempt + 1,
    claimed_at = v_now,
    claimed_by = worker_id,
    heartbeat_at = v_now,
    lease_expires_at = v_now + pg_catalog.make_interval(secs => lease_ms / 1000.0),
    status = 'claimed',
    updated_at = v_now
  where id = selected_id
  returning *;
end;
$$;

revoke all on function public.claim_inssa_execution_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_inssa_execution_job(text, integer) to service_role;
