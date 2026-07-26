create table if not exists public.execution_jobs (
  id uuid primary key,
  run_id uuid not null unique references public.campaign_runs(id) on delete cascade,
  campaign_key text not null,
  idempotency_key text not null unique,
  status text not null check (status in ('queued', 'claimed', 'running', 'completed', 'failed', 'abandoned')),
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 2 check (max_attempts > 0),
  claimed_by text,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  lifecycle_artifact jsonb,
  last_error text,
  schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists execution_jobs_one_active
  on public.execution_jobs ((true))
  where status in ('queued', 'claimed', 'running');

create index if not exists execution_jobs_status_created_idx
  on public.execution_jobs (status, created_at);
create index if not exists execution_jobs_lease_idx
  on public.execution_jobs (lease_expires_at)
  where status in ('claimed', 'running');

alter table public.execution_jobs enable row level security;

revoke all on table public.execution_jobs from public, anon, authenticated;
grant all on table public.execution_jobs to service_role;

create or replace function public.claim_inssa_execution_job(worker_id text, lease_ms integer)
returns setof public.execution_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_id uuid;
  current_time timestamptz := pg_catalog.clock_timestamp();
begin
  update public.execution_jobs
  set
    claimed_by = null,
    lease_expires_at = null,
    last_error = 'Worker lease expired before completion.',
    status = case when attempt < max_attempts then 'queued' else 'abandoned' end,
    updated_at = current_time
  where status in ('claimed', 'running')
    and lease_expires_at < current_time;

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
    claimed_at = current_time,
    claimed_by = worker_id,
    heartbeat_at = current_time,
    lease_expires_at = current_time + pg_catalog.make_interval(secs => lease_ms / 1000.0),
    status = 'claimed',
    updated_at = current_time
  where id = selected_id
  returning *;
end;
$$;

create or replace function public.recover_inssa_execution_job_records()
returns setof public.execution_jobs
language sql
security definer
set search_path = ''
as $$
  update public.execution_jobs
  set
    claimed_by = null,
    lease_expires_at = null,
    last_error = 'Worker lease expired before completion.',
    status = case when attempt < max_attempts then 'queued' else 'abandoned' end,
    updated_at = pg_catalog.clock_timestamp()
  where status in ('claimed', 'running')
    and lease_expires_at < pg_catalog.clock_timestamp()
  returning *;
$$;

revoke all on function public.claim_inssa_execution_job(text, integer) from public, anon, authenticated;
revoke all on function public.recover_inssa_execution_job_records() from public, anon, authenticated;
grant execute on function public.claim_inssa_execution_job(text, integer) to service_role;
grant execute on function public.recover_inssa_execution_job_records() to service_role;
