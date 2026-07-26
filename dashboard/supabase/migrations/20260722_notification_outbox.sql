create table if not exists public.notification_outbox (
  id uuid primary key,
  created_at timestamptz not null,
  run_id uuid references public.campaign_runs(id) on delete set null,
  campaign_id text,
  product text not null,
  environment text not null,
  event_type text not null check (event_type in (
    'run_queued',
    'run_started',
    'run_completed',
    'run_failed',
    'worker_restarted',
    'worker_lease_expired',
    'job_recovery',
    'evidence_upload_failed',
    'execution_failed'
  )),
  severity text not null check (severity in ('informational', 'low', 'medium', 'high', 'critical')),
  title text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  provider text,
  provider_message_id text,
  error_message text,
  correlation_id text not null,
  deduplication_key text not null unique,
  schema_version integer not null default 1 check (schema_version = 1)
);

create index if not exists notification_outbox_created_at_idx on public.notification_outbox (created_at desc);
create index if not exists notification_outbox_status_idx on public.notification_outbox (status, created_at desc);
create index if not exists notification_outbox_severity_idx on public.notification_outbox (severity, created_at desc);
create index if not exists notification_outbox_campaign_idx on public.notification_outbox (campaign_id, created_at desc);
create index if not exists notification_outbox_run_idx on public.notification_outbox (run_id, created_at desc);
create index if not exists notification_outbox_product_environment_idx
  on public.notification_outbox (product, environment, created_at desc);

alter table public.notification_outbox enable row level security;

revoke all on table public.notification_outbox from public, anon, authenticated;
grant all on table public.notification_outbox to service_role;
