create table if not exists public.monitoring_definitions (
  id uuid primary key,
  name text not null,
  product text not null,
  campaign_id text not null,
  environment text not null,
  trigger_type text not null check (trigger_type in ('manual', 'schedule', 'api', 'deployment', 'webhook', 'future')),
  enabled boolean not null default false,
  severity text not null check (severity in ('informational', 'low', 'medium', 'high', 'critical')),
  schedule text,
  notification_policy text not null check (notification_policy in ('critical', 'warning', 'info', 'silent')),
  retry_policy jsonb not null,
  timeout_ms integer not null check (timeout_ms > 0),
  evidence_policy text not null check (evidence_policy in ('always', 'on_failure', 'never')),
  run_policy text not null check (run_policy in ('one_active_run', 'allow_parallel', 'queue', 'skip', 'retry')),
  schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists monitoring_definitions_product_idx
  on public.monitoring_definitions (product, name);
create index if not exists monitoring_definitions_campaign_idx
  on public.monitoring_definitions (campaign_id);
create index if not exists monitoring_definitions_environment_idx
  on public.monitoring_definitions (environment, enabled);
create index if not exists monitoring_definitions_trigger_idx
  on public.monitoring_definitions (trigger_type, enabled);

alter table public.monitoring_definitions enable row level security;

revoke all on table public.monitoring_definitions from public, anon, authenticated;
grant all on table public.monitoring_definitions to service_role;

insert into public.monitoring_definitions (
  id,
  name,
  product,
  campaign_id,
  environment,
  trigger_type,
  enabled,
  severity,
  schedule,
  notification_policy,
  retry_policy,
  timeout_ms,
  evidence_policy,
  run_policy,
  schema_version,
  created_at,
  updated_at
)
values
  (
    'a94cd531-bb89-4eeb-a68e-c7f77f61d219',
    'INSSA Safe Regression Observation',
    'INSSA',
    'test_inssa_safe',
    'staging',
    'manual',
    true,
    'medium',
    null,
    'warning',
    '{"backoffMs":60000,"maxAttempts":2}'::jsonb,
    600000,
    'always',
    'one_active_run',
    1,
    '2026-07-21T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z'
  ),
  (
    'cc5edfe2-5452-4437-a532-d14101fd1c2d',
    'INSSA Security Campaign Observation',
    'INSSA',
    'test_inssa_campaign_security',
    'staging',
    'deployment',
    false,
    'high',
    null,
    'critical',
    '{"backoffMs":120000,"maxAttempts":1}'::jsonb,
    900000,
    'always',
    'queue',
    1,
    '2026-07-21T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z'
  ),
  (
    'fc38c819-f4f8-478f-bc45-67c8c9be464a',
    'INSSA Security Verification Observation',
    'INSSA',
    'test_inssa_campaign_security_verify',
    'staging',
    'api',
    false,
    'medium',
    null,
    'info',
    '{"backoffMs":60000,"maxAttempts":2}'::jsonb,
    600000,
    'on_failure',
    'skip',
    1,
    '2026-07-21T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z'
  )
on conflict (id) do nothing;
