alter table public.monitoring_definitions
  add column if not exists schedule_config jsonb;

insert into public.monitoring_definitions (
  id, name, product, campaign_id, environment, trigger_type, enabled, severity,
  schedule, schedule_config, notification_policy, retry_policy, timeout_ms,
  evidence_policy, run_policy, schema_version, created_at, updated_at
)
values (
  '17ab8e2e-f129-479c-a68e-c2087c1c52d0',
  'INSSA Daily Safe Regression',
  'INSSA',
  'test_inssa_safe',
  'staging',
  'schedule',
  true,
  'medium',
  null,
  '{"frequency":"daily","hour":3,"minute":0,"timezone":"Europe/Dublin"}'::jsonb,
  'warning',
  '{"backoffMs":60000,"maxAttempts":2}'::jsonb,
  600000,
  'always',
  'one_active_run',
  1,
  '2026-07-21T00:00:00.000Z',
  '2026-07-21T00:00:00.000Z'
)
on conflict (id) do update
set schedule_config = excluded.schedule_config;

create table if not exists public.monitoring_schedule_occurrences (
  id uuid primary key,
  definition_id uuid not null references public.monitoring_definitions(id) on delete cascade,
  campaign_id text not null,
  occurrence_key text not null unique,
  scheduled_for timestamptz not null,
  status text not null check (status in ('claimed', 'queued', 'failed', 'skipped')),
  claimed_by text not null,
  run_id uuid references public.campaign_runs(id) on delete set null,
  error_message text,
  schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists monitoring_schedule_occurrences_definition_idx
  on public.monitoring_schedule_occurrences (definition_id, scheduled_for desc);
create index if not exists monitoring_schedule_occurrences_status_idx
  on public.monitoring_schedule_occurrences (status, created_at desc);

create table if not exists public.scheduler_runtime_status (
  id text primary key,
  running boolean not null default false,
  scheduler_id text,
  heartbeat_at timestamptz,
  last_evaluation_at timestamptz,
  definitions_evaluated integer not null default 0,
  jobs_queued integer not null default 0,
  definition_states jsonb not null default '[]'::jsonb,
  last_error text,
  started_at timestamptz,
  updated_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1)
);

alter table public.monitoring_schedule_occurrences enable row level security;
alter table public.scheduler_runtime_status enable row level security;

revoke all on table public.monitoring_schedule_occurrences from public, anon, authenticated;
revoke all on table public.scheduler_runtime_status from public, anon, authenticated;
grant all on table public.monitoring_schedule_occurrences to service_role;
grant all on table public.scheduler_runtime_status to service_role;

insert into public.scheduler_runtime_status (
  id, running, definitions_evaluated, jobs_queued, definition_states,
  updated_at, schema_version
)
values ('primary', false, 0, 0, '[]'::jsonb, clock_timestamp(), 1)
on conflict (id) do nothing;
